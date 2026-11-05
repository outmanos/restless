import { createHash } from 'node:crypto';
import type * as FsPromises from 'node:fs/promises';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { AllTypes, BaseModel } from 'insomnia-data';
import { database as db, models, services } from 'insomnia-data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line no-restricted-imports
import { resetV4Counter } from '../../../../insomnia-data/__mocks__/uuid';
import { commitPlan } from './commit';
import type { DetectedSource, MigrationPlan, PlanItem, ReportEntry } from './types';

// Lets one test make a single file copy fail. Every other call goes to the real copyFile.
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, copyFile: vi.fn(actual.copyFile) };
});

const NOW = 1_700_000_000_000;
const SECRET = 'hunter2-not-for-reports';

const sha1 = (value: string) => createHash('sha1').update(value).digest('hex');

const item = (type: string, fields: Record<string, unknown>): PlanItem => ({
  type,
  name: String(fields.name ?? fields._id),
  doc: { type, created: NOW, modified: NOW, ...fields },
});

const source: DetectedSource = {
  id: 'insomnia:/home/user/.config/Insomnia',
  kind: 'insomnia',
  path: '/home/user/.config/Insomnia',
  counts: { projects: 1, collections: 1, requests: 2, environments: 2 },
  running: false,
};

const WORKSPACE_ID = 'wrk_pets';
// The ids restless gives a workspace's base environment and cookie jar
const BASE_ENV_ID = `env_${sha1(WORKSPACE_ID)}`;
const JAR_ID = `jar_${sha1(WORKSPACE_ID)}`;

// Parents come before their children, as a plan guarantees
const petsItems = (): PlanItem[] => [
  item('Project', {
    _id: 'proj_imported',
    parentId: 'org_local',
    name: 'Imported',
    remoteId: null,
    gitRepositoryId: null,
  }),
  item('Workspace', { _id: WORKSPACE_ID, parentId: 'proj_imported', name: 'Pets API', scope: 'collection' }),
  item('Environment', {
    _id: BASE_ENV_ID,
    parentId: WORKSPACE_ID,
    name: 'Base Environment',
    data: { baseUrl: 'https://pets.example.com', apiKey: SECRET },
  }),
  item('Environment', { _id: 'env_production', parentId: BASE_ENV_ID, name: 'Production', data: { token: SECRET } }),
  item('CookieJar', {
    _id: JAR_ID,
    parentId: WORKSPACE_ID,
    name: 'Default Jar',
    cookies: [{ id: 'ck_1', key: 'session', value: SECRET, domain: 'pets.example.com', path: '/', source: 'response' }],
  }),
  item('WorkspaceMeta', { _id: 'wrkm_pets', parentId: WORKSPACE_ID, activeEnvironmentId: 'env_production' }),
  item('RequestGroup', { _id: 'fld_pets', parentId: WORKSPACE_ID, name: 'Pets', metaSortKey: -2 }),
  item('Request', {
    _id: 'req_list',
    parentId: 'fld_pets',
    name: 'List pets',
    method: 'GET',
    url: '{{ _.baseUrl }}/pets',
    headers: [{ name: 'Authorization', value: `Bearer ${SECRET}` }],
    authentication: { type: 'bearer', token: SECRET },
    metaSortKey: -2,
  }),
  item('Request', {
    _id: 'req_create',
    parentId: WORKSPACE_ID,
    name: 'Create pet',
    method: 'POST',
    url: '{{ _.baseUrl }}/pets',
    metaSortKey: -1,
  }),
  item('RequestMeta', { _id: 'reqm_list', parentId: 'req_list' }),
];

const PETS_IMPORTED = {
  Project: 1,
  Workspace: 1,
  Environment: 2,
  CookieJar: 1,
  WorkspaceMeta: 1,
  RequestGroup: 1,
  Request: 2,
  RequestMeta: 1,
};

const planOf = (items: PlanItem[] = petsItems(), issues: ReportEntry[] = []): MigrationPlan => ({
  source,
  items,
  issues,
  plugins: [],
});

// Every document in the database, by type
const snapshot = async () => {
  const all: Record<string, unknown[]> = {};
  for (const type of models.types()) {
    const docs = await db.find(type, {}, { _id: 1 });
    if (docs.length > 0) {
      all[type] = docs;
    }
  }
  return all;
};

const findOne = (type: string, _id: string) => db.findOne(type as AllTypes, { _id });

describe('commitPlan', () => {
  let dataDir: string;
  let previousDataPath: string | undefined;

  const migrationsDir = () => path.join(dataDir, 'migrations');
  const backupsDir = () => path.join(dataDir, 'backups');

  beforeEach(async () => {
    await db.init({ inMemoryOnly: true }, true);
    resetV4Counter();
    dataDir = await mkdtemp(path.join(tmpdir(), 'restless-commit-'));
    previousDataPath = process.env['INSOMNIA_DATA_PATH'];
    process.env['INSOMNIA_DATA_PATH'] = dataDir;
    // Stand-ins for the NeDB files of a live install
    await writeFile(path.join(dataDir, 'insomnia.Request.db'), 'request lines\n');
    await writeFile(path.join(dataDir, 'insomnia.Workspace.db'), 'workspace lines\n');
    await writeFile(path.join(dataDir, 'notes.txt'), 'not a database file');
    await mkdir(path.join(dataDir, 'folder.db'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(copyFile).mockReset();
    if (previousDataPath === undefined) {
      delete process.env['INSOMNIA_DATA_PATH'];
    } else {
      process.env['INSOMNIA_DATA_PATH'] = previousDataPath;
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  describe('a first import', () => {
    it('writes every document under its original _id and counts them by type', async () => {
      const plan = planOf();

      const report = await commitPlan(plan);

      expect(report.imported).toEqual(PETS_IMPORTED);
      expect(report.entries).toEqual([]);
      for (const { type, doc } of plan.items) {
        expect(await findOne(type, doc._id as string)).toMatchObject({ _id: doc._id, parentId: doc.parentId });
      }
    });

    it('keeps the parent and child links intact', async () => {
      const plan = planOf();

      await commitPlan(plan);

      const project = await findOne('Project', 'proj_imported');
      const tree = await db.getWithDescendants(project as BaseModel);
      const ids = new Set(tree.map(doc => doc._id));
      // Every document is reachable from its project, and every parent is one of the imported documents
      expect([...ids].sort()).toEqual(plan.items.map(i => i.doc._id as string).sort());
      for (const doc of tree) {
        if (doc._id !== 'proj_imported') {
          expect(ids.has(doc.parentId)).toBe(true);
        }
      }
    });

    it('applies the schema migrations to old documents', async () => {
      const stored: BaseModel[] = [];
      const realInsert = db.insert.bind(db);
      vi.spyOn(db, 'insert').mockImplementation(async doc => {
        const result = await realInsert(doc);
        stored.push(result);
        return result;
      });
      const plan = planOf([
        item('Project', { _id: 'proj_imported', parentId: 'org_local', name: 'Imported', remoteId: null }),
        item('Workspace', {
          _id: 'wrk_legacy',
          parentId: 'proj_imported',
          name: 'Legacy',
          scope: 'spec',
          certificates: [{ host: 'mtls.example.com', passphrase: null, cert: 'CERT', key: 'KEY' }],
        }),
        item('CookieJar', {
          _id: 'jar_legacy',
          parentId: 'wrk_legacy',
          cookies: [{ key: 'a', value: 'b', domain: 'x.test' }],
        }),
        item('Request', {
          _id: 'req_legacy',
          parentId: 'wrk_legacy',
          name: 'Old',
          url: 'https://x.test',
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          body: '{"a":1}',
        }),
      ]);

      await commitPlan(plan);

      const written = (id: string) => stored.find(doc => doc._id === id) as Record<string, any>;
      expect(written('wrk_legacy').scope).toBe('design');
      expect(written('wrk_legacy')).not.toHaveProperty('certificates');
      expect(written('jar_legacy').cookies[0]).toMatchObject({ source: 'manual', id: expect.any(String) });
      expect(written('req_legacy').body).toEqual({ mimeType: 'application/json', text: '{"a":1}' });
      // The workspace's old certificates became documents of their own, once
      const certificates = await services.clientCertificate.findByParentId('wrk_legacy');
      expect(certificates).toHaveLength(1);
      expect(certificates[0]).toMatchObject({ host: 'mtls.example.com' });
      await commitPlan(plan);
      expect(await services.clientCertificate.findByParentId('wrk_legacy')).toHaveLength(1);
    });

    it('stores a document under the type of its plan item', async () => {
      const plan = planOf([
        item('Request', { _id: 'req_odd', type: 'Workspace', parentId: WORKSPACE_ID, name: 'Odd' }),
      ]);

      await commitPlan(plan);

      expect(await db.count('Request', { _id: 'req_odd' })).toBe(1);
      expect(await db.count('Workspace', { _id: 'req_odd' })).toBe(0);
    });
  });

  describe('base environments and cookie jars', () => {
    it('adds none of its own and leaves nothing for the app to duplicate', async () => {
      const legacyWorkspace = item('Workspace', {
        _id: 'wrk_old',
        parentId: 'proj_imported',
        name: 'Old',
        scope: 'collection',
      });
      const plan = planOf([
        ...petsItems(),
        legacyWorkspace,
        // Installs from before the fixed ids have base environments and jars with random ids
        item('Environment', { _id: 'env_0123abcd', parentId: 'wrk_old', name: 'Base Environment' }),
        item('CookieJar', { _id: 'jar_0123abcd', parentId: 'wrk_old', name: 'Default Jar' }),
        item('Workspace', { _id: 'wrk_bare', parentId: 'proj_imported', name: 'Bare', scope: 'collection' }),
      ]);

      await commitPlan(plan);

      // Only what the plan holds
      expect(await db.count('Environment', { parentId: WORKSPACE_ID })).toBe(1);
      expect(await db.count('CookieJar', { parentId: WORKSPACE_ID })).toBe(1);
      expect(await db.count('Environment', { parentId: 'wrk_old' })).toBe(1);
      expect(await db.count('CookieJar', { parentId: 'wrk_old' })).toBe(1);
      // A workspace the plan gave no children gets none from the commit
      expect(await db.count('Environment', { parentId: 'wrk_bare' })).toBe(0);
      expect(await db.count('CookieJar', { parentId: 'wrk_bare' })).toBe(0);
      expect(await db.count('WorkspaceMeta', { parentId: 'wrk_bare' })).toBe(0);
      // Opening an imported workspace finds the imported documents instead of creating new ones
      expect((await services.environment.getOrCreateForParentId(WORKSPACE_ID))._id).toBe(BASE_ENV_ID);
      expect((await services.cookieJar.getOrCreateForParentId(WORKSPACE_ID))._id).toBe(JAR_ID);
      expect((await services.environment.getOrCreateForParentId('wrk_old'))._id).toBe('env_0123abcd');
      expect((await services.cookieJar.getOrCreateForParentId('wrk_old'))._id).toBe('jar_0123abcd');
      expect(await db.count('Environment', { parentId: WORKSPACE_ID })).toBe(1);
      expect(await db.count('CookieJar', { parentId: 'wrk_old' })).toBe(1);
    });
  });

  describe('running the same plan again', () => {
    it('imports nothing, reports every document as already imported and changes nothing', async () => {
      const plan = planOf();
      await commitPlan(plan);
      const before = await snapshot();

      const second = await commitPlan(plan);

      expect(second.imported).toEqual({});
      expect(second.entries).toEqual(plan.items.map(({ type, name }) => ({ reason: 'already-imported', type, name })));
      expect(await snapshot()).toEqual(before);
    });

    it('leaves a document that already exists untouched', async () => {
      await db.insert({
        _id: 'req_list',
        type: 'Request',
        parentId: 'fld_mine',
        name: 'Mine',
        url: 'https://mine.example.com',
        created: 1,
        modified: 2,
      } as unknown as BaseModel);
      const before = await findOne('Request', 'req_list');

      const report = await commitPlan(planOf());

      expect(await findOne('Request', 'req_list')).toEqual(before);
      expect(report.entries).toContainEqual({ reason: 'already-imported', type: 'Request', name: 'List pets' });
      // Only the other request was new
      expect(report.imported.Request).toBe(1);
    });

    it('treats a repeated _id inside one plan as already imported', async () => {
      const first = item('Request', { _id: 'req_twice', parentId: WORKSPACE_ID, name: 'First' });
      const second = item('Request', { _id: 'req_twice', parentId: WORKSPACE_ID, name: 'Second' });

      const report = await commitPlan(planOf([first, second]));

      expect(report.imported).toEqual({ Request: 1 });
      expect(report.entries).toEqual([{ reason: 'already-imported', type: 'Request', name: 'Second' }]);
      expect((await findOne('Request', 'req_twice')) as Record<string, any>).toMatchObject({ name: 'First' });
    });

    it('finishes an import that was cut short', async () => {
      const plan = planOf();
      let calls = 0;
      const realCount = db.count.bind(db);
      const countSpy = vi.spyOn(db, 'count').mockImplementation(async (type, query) => {
        if (++calls === 4) {
          throw new Error('database closed');
        }
        return realCount(type, query);
      });
      await expect(commitPlan(plan)).rejects.toThrow('database closed');
      countSpy.mockRestore();
      expect(await db.count('Environment', {})).toBe(1);

      const report = await commitPlan(plan);

      expect(report.entries).toHaveLength(3);
      expect(report.entries.every(entry => entry.reason === 'already-imported')).toBe(true);
      expect(Object.values(report.imported).reduce((sum, count) => sum + count, 0)).toBe(plan.items.length - 3);
      for (const { type, doc } of plan.items) {
        expect(await findOne(type, doc._id as string)).toBeDefined();
      }
    });

    it('runs two commits started together one after the other', async () => {
      const plan = planOf();

      const [first, second] = await Promise.all([commitPlan(plan), commitPlan(plan)]);

      expect(first.imported).toEqual(PETS_IMPORTED);
      expect(first.entries).toEqual([]);
      expect(second.imported).toEqual({});
      expect(second.entries.map(entry => entry.reason)).toEqual(plan.items.map(() => 'already-imported'));
      expect(await db.count('Request', {})).toBe(2);
    });
  });

  describe('documents that cannot be imported', () => {
    it('records a rejected document and carries on with the rest', async () => {
      const plan = planOf([
        item('Project', { _id: 'proj_imported', parentId: 'org_local', name: 'Imported', remoteId: null }),
        item('Workspace', { _id: WORKSPACE_ID, parentId: 'proj_imported', name: 'Pets API', scope: 'collection' }),
        // NeDB refuses field names that contain a dot
        item('Environment', { _id: 'env_broken', parentId: WORKSPACE_ID, name: 'Broken', data: { 'api.url': SECRET } }),
        item('Request', { _id: 'req_after', parentId: WORKSPACE_ID, name: 'After the failure' }),
      ]);

      const report = await commitPlan(plan);

      expect(report.entries).toEqual([
        { reason: 'parse-error', type: 'Environment', name: 'Broken', detail: 'Field names cannot contain a .' },
      ]);
      expect(report.imported).toEqual({ Project: 1, Workspace: 1, Request: 1 });
      expect(await findOne('Environment', 'env_broken')).toBeUndefined();
      expect(await findOne('Request', 'req_after')).toBeDefined();
    });

    it('skips the children of a document that was not imported', async () => {
      const plan = planOf([
        item('Environment', { _id: 'env_broken', parentId: WORKSPACE_ID, name: 'Broken', data: { $bad: 1 } }),
        item('Environment', { _id: 'env_child', parentId: 'env_broken', name: 'Child' }),
        item('Environment', { _id: 'env_grandchild', parentId: 'env_child', name: 'Grandchild' }),
        item('Environment', { _id: 'env_other', parentId: WORKSPACE_ID, name: 'Other' }),
      ]);

      const report = await commitPlan(plan);

      expect(report.entries).toEqual([
        {
          reason: 'parse-error',
          type: 'Environment',
          name: 'Broken',
          detail: 'Field names cannot begin with the $ character',
        },
        { reason: 'parse-error', type: 'Environment', name: 'Child', detail: 'Its parent was not imported' },
        { reason: 'parse-error', type: 'Environment', name: 'Grandchild', detail: 'Its parent was not imported' },
      ]);
      expect(report.imported).toEqual({ Environment: 1 });
      expect(await db.count('Environment', {})).toBe(1);
    });

    it('records an unknown model type and writes nothing for it', async () => {
      const plan = planOf([
        item('Spaceship', { _id: 'ship_1', parentId: 'proj_imported', name: 'Enterprise' }),
        item('Request', { _id: 'req_aboard', parentId: 'ship_1', name: 'Aboard' }),
        item('Request', { _id: 'req_fine', parentId: WORKSPACE_ID, name: 'Fine' }),
      ]);

      const report = await commitPlan(plan);

      expect(report.entries).toEqual([
        { reason: 'unknown-model', type: 'Spaceship', name: 'Enterprise' },
        { reason: 'parse-error', type: 'Request', name: 'Aboard', detail: 'Its parent was not imported' },
      ]);
      expect(report.imported).toEqual({ Request: 1 });
    });

    it('records a document without an _id', async () => {
      const plan = planOf([
        item('Request', { _id: undefined, parentId: WORKSPACE_ID, name: 'No id' }),
        item('Request', { _id: 'req_fine', parentId: WORKSPACE_ID, name: 'Fine' }),
      ]);

      const report = await commitPlan(plan);

      expect(report.entries).toEqual([
        { reason: 'parse-error', type: 'Request', name: 'No id', detail: 'The document has no _id' },
      ]);
      expect(report.imported).toEqual({ Request: 1 });
    });

    it('records a plan item that is not a document at all', async () => {
      const plan = planOf([
        null as unknown as PlanItem,
        { type: 'Request', name: 'No document' } as PlanItem,
        item('Request', { _id: 'req_fine', parentId: WORKSPACE_ID, name: 'Fine' }),
      ]);

      const report = await commitPlan(plan);

      expect(report.entries).toEqual([
        { reason: 'parse-error', type: '', name: '', detail: 'The document has no _id' },
        { reason: 'parse-error', type: 'Request', name: 'No document', detail: 'The document has no _id' },
      ]);
      expect(report.imported).toEqual({ Request: 1 });
    });
  });

  describe('the backup', () => {
    it('copies the .db files before the first write and nothing else', async () => {
      let backupsAtFirstWrite: string[] | undefined;
      const realInsert = db.insert.bind(db);
      vi.spyOn(db, 'insert').mockImplementation(async doc => {
        backupsAtFirstWrite ??= await readdir(backupsDir(), { recursive: true });
        return realInsert(doc);
      });

      await commitPlan(planOf());

      const [backup] = await readdir(backupsDir());
      expect(backup).toMatch(/^pre-migration-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
      expect((backupsAtFirstWrite ?? []).sort()).toEqual(
        [backup!, path.join(backup!, 'insomnia.Request.db'), path.join(backup!, 'insomnia.Workspace.db')].sort(),
      );
      expect((await readdir(path.join(backupsDir(), backup!))).sort()).toEqual([
        'insomnia.Request.db',
        'insomnia.Workspace.db',
      ]);
      expect(await readFile(path.join(backupsDir(), backup!, 'insomnia.Request.db'), 'utf8')).toBe('request lines\n');
    });

    it('takes none when nothing is written', async () => {
      const plan = planOf();
      await commitPlan(plan);
      expect(await readdir(backupsDir())).toHaveLength(1);

      await commitPlan(plan);
      await commitPlan(planOf([], []));

      expect(await readdir(backupsDir())).toHaveLength(1);
    });

    it('takes a new one for each run that writes, even within the same millisecond', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-03-04T05:06:07.089Z'));

      await commitPlan(planOf());
      await commitPlan(
        planOf([...petsItems(), item('Request', { _id: 'req_more', parentId: WORKSPACE_ID, name: 'More' })]),
      );

      expect((await readdir(backupsDir())).sort()).toEqual([
        'pre-migration-2026-03-04T05-06-07-089Z',
        'pre-migration-2026-03-04T05-06-07-089Z-1',
      ]);
      expect((await readdir(migrationsDir())).sort()).toEqual([
        '2026-03-04T05-06-07-089Z-1.json',
        '2026-03-04T05-06-07-089Z.json',
      ]);
    });

    it('removes a half-written backup and writes nothing when a copy fails', async () => {
      vi.mocked(copyFile).mockRejectedValueOnce(
        Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }),
      );

      await expect(commitPlan(planOf())).rejects.toThrow('ENOSPC');

      expect(await readdir(backupsDir())).toEqual([]);
      expect(await snapshot()).toEqual({});
    });
  });

  describe('flushing the database changes', () => {
    it('delivers the changes in one flush, with the id it was given', async () => {
      const plan = planOf();
      const listener = vi.fn();
      db.onChange(listener);
      const buffer = vi.spyOn(db, 'bufferChangesIndefinitely');
      const flush = vi.spyOn(db, 'flushChanges');

      await commitPlan(plan);

      expect(flush).toHaveBeenCalledTimes(1);
      expect(flush).toHaveBeenCalledWith(await buffer.mock.results[0]!.value);
      expect(listener).toHaveBeenCalledTimes(1);
      const changes = listener.mock.calls[0]![0] as [string, BaseModel][];
      expect(changes).toHaveLength(plan.items.length);
      expect(changes.every(([event]) => event === 'insert')).toBe(true);
    });

    it('flushes when the backup fails', async () => {
      await writeFile(backupsDir(), 'a file where the folder should be');
      const listener = vi.fn();
      db.onChange(listener);
      const buffer = vi.spyOn(db, 'bufferChangesIndefinitely');
      const flush = vi.spyOn(db, 'flushChanges');

      await expect(commitPlan(planOf())).rejects.toThrow();

      expect(flush).toHaveBeenCalledWith(await buffer.mock.results[0]!.value);
      expect(await snapshot()).toEqual({});
      // Buffering has ended, so the next change is delivered straight away
      await services.project.create({ _id: 'proj_next', parentId: 'org_local' });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('flushes what was written when the run stops half way', async () => {
      const listener = vi.fn();
      db.onChange(listener);
      let calls = 0;
      const realCount = db.count.bind(db);
      vi.spyOn(db, 'count').mockImplementation(async (type, query) => {
        if (++calls === 4) {
          throw new Error('database closed');
        }
        return realCount(type, query);
      });

      await expect(commitPlan(planOf())).rejects.toThrow('database closed');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]![0]).toHaveLength(3);
    });

    it('still returns the report when the flush fails', async () => {
      const realFlush = db.flushChanges.bind(db);
      vi.spyOn(db, 'flushChanges').mockImplementationOnce(async id => {
        await realFlush(id);
        throw new Error('a listener failed');
      });

      const report = await commitPlan(planOf());

      expect(report.imported).toEqual(PETS_IMPORTED);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('flush'), expect.any(Error));
    });
  });

  describe('the report', () => {
    it('is saved under migrations and matches what is returned', async () => {
      const report = await commitPlan(planOf());

      const files = await readdir(migrationsDir());
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/);
      expect(JSON.parse(await readFile(path.join(migrationsDir(), files[0]!), 'utf8'))).toEqual(report);
      expect(report.source).toEqual(source);
      expect(new Date(report.startedAt).toISOString()).toBe(report.startedAt);
      expect(new Date(report.finishedAt).getTime()).toBeGreaterThanOrEqual(new Date(report.startedAt).getTime());
    });

    it('lists the issues from the plan first, then what the commit found', async () => {
      const issues: ReportEntry[] = [
        { reason: 'git-project', type: 'Project', name: 'Infra', detail: 'Use File > Open Folder' },
        { reason: 'cloud-only', type: 'Project', name: 'Team' },
      ];
      const items = [
        item('Request', { _id: 'req_fine', parentId: WORKSPACE_ID, name: 'Fine' }),
        item('Spaceship', { _id: 'ship_1', name: 'Enterprise' }),
      ];

      const report = await commitPlan(planOf(items, issues));

      expect(report.entries).toEqual([...issues, { reason: 'unknown-model', type: 'Spaceship', name: 'Enterprise' }]);
    });

    it('is still returned when it cannot be saved', async () => {
      await writeFile(migrationsDir(), 'a file where the folder should be');

      const report = await commitPlan(planOf());

      expect(report.imported).toEqual(PETS_IMPORTED);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('save the report'), expect.any(Error));
    });

    it('holds no document contents and no secret values', async () => {
      const issues: ReportEntry[] = [
        {
          reason: 'secret-not-readable',
          type: 'Environment',
          name: 'Production',
          detail: 'Variable apiKey was encrypted',
        },
      ];

      const report = await commitPlan(planOf(petsItems(), issues));

      const [file] = await readdir(migrationsDir());
      const saved = await readFile(path.join(migrationsDir(), file!), 'utf8');
      for (const text of [JSON.stringify(report), saved]) {
        expect(text).not.toContain(SECRET);
        expect(text).not.toContain('pets.example.com');
        expect(text).not.toContain('Authorization');
      }
      expect(Object.keys(JSON.parse(saved)).sort()).toEqual([
        'entries',
        'finishedAt',
        'imported',
        'source',
        'startedAt',
      ]);
    });

    it('keeps values out of the error details', async () => {
      const realInsert = db.insert.bind(db);
      vi.spyOn(db, 'insert').mockImplementation(async doc => {
        if (doc._id === 'req_list') {
          throw new Error(`Unexpected token 'h', "${SECRET}" is not valid JSON`);
        }
        return realInsert(doc);
      });

      const report = await commitPlan(planOf());

      expect(report.entries).toEqual([
        {
          reason: 'parse-error',
          type: 'Request',
          name: 'List pets',
          detail: 'Unexpected error, see the application log',
        },
        { reason: 'parse-error', type: 'RequestMeta', name: 'reqm_list', detail: 'Its parent was not imported' },
      ]);
      expect(JSON.stringify(report)).not.toContain(SECRET);
      // The application log has the whole error
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('req_list'),
        expect.objectContaining({ message: expect.stringContaining(SECRET) }),
      );
    });

    it('names a file system error by its code only', async () => {
      const realInsert = db.insert.bind(db);
      vi.spyOn(db, 'insert').mockImplementation(async doc => {
        if (doc._id === 'req_create') {
          throw Object.assign(new Error(`ENOSPC: no space left on device, write ${SECRET}`), { code: 'ENOSPC' });
        }
        return realInsert(doc);
      });

      const report = await commitPlan(planOf());

      expect(report.entries).toEqual([
        { reason: 'parse-error', type: 'Request', name: 'Create pet', detail: 'File system error ENOSPC' },
      ]);
      expect(JSON.stringify(report)).not.toContain(SECRET);
    });

    it('copies only the known fields of the source and of each issue', async () => {
      const plan = planOf(
        [],
        [
          {
            reason: 'git-project',
            type: 'Project',
            name: 'Infra',
            detail: 'Use File > Open Folder',
            value: SECRET,
          } as ReportEntry,
        ],
      );
      plan.source = { ...source, counts: { ...source.counts, token: SECRET }, apiToken: SECRET } as DetectedSource;

      const report = await commitPlan(plan);

      expect(report.source).toEqual(source);
      expect(report.entries).toEqual([
        { reason: 'git-project', type: 'Project', name: 'Infra', detail: 'Use File > Open Folder' },
      ]);
      expect(JSON.stringify(report)).not.toContain(SECRET);
    });
  });
});
