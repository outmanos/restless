import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import electron from 'electron';
import type { BaseModel } from 'insomnia-data';
import { database, models } from 'insomnia-data';

import type { DetectedSource, MigrationPlan, MigrationReport, ReportEntry, ReportReason } from './types';

const getDataPath = () => process.env['INSOMNIA_DATA_PATH'] || electron.app.getPath('userData');

// The plan comes back over IPC, so the report copies named fields only. Anything else
// attached to a plan, a source or an issue never reaches the saved file.
const makeEntry = (reason: ReportReason, type: string, name: string, detail?: string): ReportEntry =>
  detail === undefined ? { reason, type, name } : { reason, type, name, detail };

const copySource = (source: DetectedSource): DetectedSource => ({
  id: source.id,
  kind: source.kind,
  path: source.path,
  counts: {
    projects: source.counts.projects,
    collections: source.counts.collections,
    requests: source.counts.requests,
    environments: source.counts.environments,
  },
  running: source.running,
});

const isDoc = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Error text can quote document values, secrets included. The report only gets text known to
// carry none: NeDB's field name errors and the code of a file system error. The full error
// goes to the application log instead.
const VALUE_FREE_MESSAGE = /^Field names (?:cannot begin with the \$ character|cannot contain a \.)$/;

const describeError = (error: unknown) => {
  if (error instanceof Error && VALUE_FREE_MESSAGE.test(error.message)) {
    return error.message;
  }
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && /^E[A-Z]+$/.test(code)
    ? `File system error ${code}`
    : 'Unexpected error, see the application log';
};

// Appends -1, -2 and so on when the name is taken, so an earlier backup or report is never overwritten
async function createUnique(
  dir: string,
  base: string,
  extension: string,
  create: (target: string) => Promise<unknown>,
) {
  for (let attempt = 0; ; attempt++) {
    const target = path.join(dir, `${base}${attempt === 0 ? '' : `-${attempt}`}${extension}`);
    try {
      await create(target);
      return target;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }
}

// backup() in main/backup.ts is keyed by app version and does nothing once that version has a
// backup, and it hides failures. Neither fits a restore point taken right before a write.
async function backupDatabaseFiles(dataPath: string, stamp: string) {
  const backupsDir = path.join(dataPath, 'backups');
  await mkdir(backupsDir, { recursive: true });
  const target = await createUnique(backupsDir, `pre-migration-${stamp}`, '', dir => mkdir(dir));
  try {
    for (const entry of await readdir(dataPath, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.db')) {
        await copyFile(path.join(dataPath, entry.name), path.join(target, entry.name));
      }
    }
  } catch (error) {
    // A half-written backup would look like a real one
    await rm(target, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  console.log('[migration] Backed up the database files to', target);
}

async function saveReport(dataPath: string, stamp: string, report: MigrationReport) {
  const dir = path.join(dataPath, 'migrations');
  await mkdir(dir, { recursive: true });
  const json = JSON.stringify(report, null, 2);
  const target = await createUnique(dir, stamp, '.json', file => writeFile(file, json, { flag: 'wx' }));
  console.log('[migration] Saved the report to', target);
}

async function commit(plan: MigrationPlan): Promise<MigrationReport> {
  const startedAt = new Date().toISOString();
  const dataPath = getDataPath();
  // Colons are not allowed in Windows file names
  const stamp = startedAt.replaceAll(/[:.]/g, '-');
  const source = copySource(plan.source);
  const entries = plan.issues.map(issue => makeEntry(issue.reason, issue.type, issue.name, issue.detail));
  const imported: Record<string, number> = {};
  // Ids of documents that were not written. Their children are skipped too, since a child
  // without its parent would be written but never shown.
  const unwritten = new Set<string>();
  let backedUp = false;

  const flushId = await database.bufferChangesIndefinitely();
  try {
    for (const item of plan.items) {
      const type = typeof item?.type === 'string' ? item.type : '';
      const name = typeof item?.name === 'string' ? item.name : '';
      const doc = item?.doc;
      const id = isDoc(doc) ? doc._id : undefined;

      // Without an _id a second run could not tell the document is already there
      if (!isDoc(doc) || typeof id !== 'string' || id === '') {
        entries.push(makeEntry('parse-error', type, name, 'The document has no _id'));
        continue;
      }

      if (!models.isValidType(type)) {
        entries.push(makeEntry('unknown-model', type, name));
        unwritten.add(id);
        continue;
      }

      if ((await database.count(type, { _id: id })) > 0) {
        entries.push(makeEntry('already-imported', type, name));
        continue;
      }

      if (typeof doc.parentId === 'string' && unwritten.has(doc.parentId)) {
        entries.push(makeEntry('parse-error', type, name, 'Its parent was not imported'));
        unwritten.add(id);
        continue;
      }

      if (!backedUp) {
        await backupDatabaseFiles(dataPath, stamp);
        backedUp = true;
      }

      try {
        // insert keeps the _id, runs initModel for the schema migrations and creates no child documents
        await database.insert({ ...doc, type } as unknown as BaseModel);
        imported[type] = (imported[type] ?? 0) + 1;
      } catch (error) {
        console.error(`[migration] Could not import ${type} ${id}`, error);
        entries.push(makeEntry('parse-error', type, name, describeError(error)));
        unwritten.add(id);
      }
    }
  } finally {
    try {
      await database.flushChanges(flushId);
    } catch (error) {
      // Whatever was written stays written, so a failing listener must not hide the result
      console.error('[migration] Could not flush the database changes', error);
    }
  }

  const report: MigrationReport = { source, startedAt, finishedAt: new Date().toISOString(), imported, entries };
  try {
    await saveReport(dataPath, stamp, report);
  } catch (error) {
    console.error('[migration] Could not save the report', error);
  }
  return report;
}

// One commit at a time, so a double click cannot run two writers over the same plan
let queue: Promise<unknown> = Promise.resolve();

export function commitPlan(plan: MigrationPlan): Promise<MigrationReport> {
  const run = queue.then(() => commit(plan));
  queue = run.catch(() => {});
  return run;
}
