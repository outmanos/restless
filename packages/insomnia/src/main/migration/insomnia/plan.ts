// Turns the documents in an Insomnia or Insomnium data folder into a plan. Nothing here writes to the source,
// and nothing is written to restless: the plan only says what a later step should insert.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { BaseModel, GitProject } from 'insomnia-data';
import { models } from 'insomnia-data';

import { describeSource } from '../detect';
import { listExistingProjects, takenNames, uniqueName } from '../project-names';
import type { DetectedSource, MigrationPlan, PlanItem, ReportEntry } from '../types';
import {
  dbFileName,
  GIT_TYPES,
  IMPORTED_TYPES,
  isImportedType,
  isKnownType,
  isSecretType,
  SECRET_TYPES,
  typeRank,
} from './models';
import { countLog, type FileProblem, listLogTypes, type LogDocument, readFolder } from './read-log';

// Ids restless keeps for itself, which a kept id must not take. There are none: the Scratch Pad was removed along
// with the account code, and isScratchpadProject() and isScratchpad() now always return false. Anything that
// reserves an id later belongs here, and the plan will give those documents new ids.
export const RESERVED_IDS: ReadonlySet<string> = new Set();

export interface PlanOptions {
  // Projects restless already has, so a name stays unique. Read from the database when left out.
  existingProjects?: { _id: string; name: string }[];
  reservedIds?: ReadonlySet<string>;
}

interface Entry {
  type: string;
  doc: LogDocument;
  // Position in the source, so equal siblings keep the order they were written in
  order: number;
}

interface Context {
  product: string;
  sourcePath: string;
  byId: Map<string, Entry>;
  issues: ReportEntry[];
  // Git repositories that workspaces were synced with, by repository id, and the workspace that used each
  repositoryLinks: Map<string, string>;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const isRecord = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const metaTypes = new Set([
  'WorkspaceMeta',
  'RequestGroupMeta',
  'RequestMeta',
  'GrpcRequestMeta',
  'WebSocketRequestMeta',
  'SocketIORequestMeta',
  'ProjectLintRuleset',
]);

// What a document is called by itself
function ownName({ type, doc }: Entry): string {
  if (type === 'ApiSpec') {
    return text(doc.fileName) || text(doc.name) || doc._id;
  }
  if (type === 'PluginData') {
    return `${text(doc.plugin)}: ${text(doc.key)}`;
  }
  if (type === 'McpPayload') {
    return text(doc.url) || doc._id;
  }
  if (type === 'ClientCertificate') {
    return text(doc.host) || doc._id;
  }
  if (type === 'CaCertificate') {
    return text(doc.path) || doc._id;
  }
  return text(doc.name) || doc._id;
}

// What a document is called in the plan. Documents that belong to another one, such as a request's metadata, are
// called by the name of their owner.
function displayName(entry: Entry, byId: Map<string, Entry>): string {
  if (metaTypes.has(entry.type)) {
    const owner = byId.get(text(entry.doc.parentId));
    return owner ? ownName(owner) : entry.doc._id;
  }
  return ownName(entry);
}

// The name with the workspace it is in, so two "Base Environment"s in a report can be told apart
function locatedName(entry: Entry, byId: Map<string, Entry>) {
  const name = displayName(entry, byId);
  const seen = new Set<string>();
  let above = byId.get(text(entry.doc.parentId));
  while (above && !seen.has(above.doc._id)) {
    if (above.type === 'Workspace') {
      return `${name} in ${ownName(above)}`;
    }
    seen.add(above.doc._id);
    above = byId.get(text(above.doc.parentId));
  }
  return name;
}

// ~~~~~~~~ //
// Projects //
// ~~~~~~~~ //

const isGitProject = (project: LogDocument) => text(project.gitRepositoryId) !== '';
const isCloudProject = (project: LogDocument) => text(project.remoteId) !== '';

// Where a repository's files are: a folder the user chose, or the one the app keeps in its own data folder
function gitFolder(sourcePath: string, repository: LogDocument) {
  const directory = text(repository.directory);
  if (directory) {
    return { folder: directory, managed: false };
  }
  const name = models.gitRepository.getGitRepoFolderName({
    _id: repository._id,
    folderSlug: text(repository.folderSlug) || null,
  });
  return { folder: path.join(sourcePath, 'version-control', 'git', name), managed: true };
}

function openFolderAdvice(ctx: Context, repository: Entry | undefined) {
  if (!repository || repository.type !== 'GitRepository') {
    return 'The repository record is missing, so its folder is not known.';
  }
  const { folder, managed } = gitFolder(ctx.sourcePath, repository.doc);
  const where = managed ? ` It is inside the ${ctx.product} data folder.` : '';
  return `Use File > Open Folder… to open ${folder}.${where}`;
}

function gitProjectIssue(project: Entry, name: string, ctx: Context): ReportEntry {
  const repositoryId = models.project.getEffectiveRepoId(project.doc as unknown as GitProject);
  const detail =
    repositoryId === null
      ? 'It is not connected to a repository, so there is no folder to open.'
      : openFolderAdvice(ctx, ctx.byId.get(repositoryId));
  return { reason: 'git-project', type: 'Project', name, detail };
}

// ~~~~~~~ //
// Secrets //
// ~~~~~~~ //

// Where each model keeps its environment data and its list of variables
const SECRET_FIELDS = new Map<string, { dataKey: string | null; pairsKey: string }>([
  ['Environment', { dataKey: 'data', pairsKey: 'kvPairData' }],
  ['RequestGroup', { dataKey: 'environment', pairsKey: 'kvPairData' }],
  ['McpRequest', { dataKey: null, pairsKey: 'env' }],
]);

// Vault values and `secret` entries are encrypted with a key that belongs to the Insomnia account, which restless
// does not have. The name stays and the value is emptied. Returns the names.
function clearSecrets(doc: LogDocument, { dataKey, pairsKey }: { dataKey: string | null; pairsKey: string }) {
  const names: string[] = [];
  const vault = dataKey ? doc[dataKey]?.[models.environment.vaultEnvironmentPath] : undefined;
  if (isRecord(vault)) {
    for (const name of Object.keys(vault)) {
      names.push(name);
      vault[name] = '';
    }
  }
  const pairs = doc[pairsKey];
  if (Array.isArray(pairs)) {
    for (const pair of pairs) {
      if (isRecord(pair) && pair.type === models.environment.EnvironmentKvPairDataType.SECRET) {
        names.push(text(pair.name) || '(unnamed)');
        pair.value = '';
      }
    }
  }
  return [...new Set(names)];
}

// Only the names of the values are reported, never the values
function secretsIssue(entry: Entry, name: string, names: string[]): ReportEntry {
  const shown = names.slice(0, 10).join(', ');
  const more = names.length > 10 ? ` and ${names.length - 10} more` : '';
  return {
    reason: 'secret-not-readable',
    type: entry.type,
    name,
    detail:
      `These values are encrypted with a key restless does not have, so they were left empty: ${shown}${more}. ` +
      'Generate a vault key in Preferences > General, then enter them again.',
  };
}

// ~~~~~~~~~~~~ //
// Certificates //
// ~~~~~~~~~~~~ //

async function missingFiles(files: Record<string, unknown>) {
  const missing: string[] = [];
  for (const [kind, file] of Object.entries(files)) {
    if (typeof file !== 'string' || file === '') {
      continue;
    }
    try {
      await access(file, constants.R_OK);
    } catch {
      missing.push(`${kind} ${file}`);
    }
  }
  return missing;
}

async function checkCertificateFiles(entry: Entry, name: string, ctx: Context) {
  const { doc } = entry;
  const missing = await missingFiles(
    entry.type === 'CaCertificate' ? { path: doc.path } : { cert: doc.cert, key: doc.key, pfx: doc.pfx },
  );
  if (missing.length) {
    ctx.issues.push({
      reason: 'file-missing',
      type: entry.type,
      name,
      detail: `Not found: ${missing.join(', ')}. The certificate was moved with these paths.`,
    });
  }
}

// Very old workspaces kept client certificates in a list. Opening one makes the model layer create a certificate
// from each, so they become certificates here, with ids that come out the same every time.
function takeLegacyCertificates(workspace: LogDocument): Entry[] {
  const certificates = workspace.certificates;
  if (!Array.isArray(certificates)) {
    return [];
  }
  delete workspace.certificates;
  return certificates.filter(isRecord).map((certificate, index) => ({
    type: 'ClientCertificate',
    order: -1,
    doc: {
      _id: `${models.clientCertificate.prefix}_${createHash('sha1').update(`${workspace._id}:${index}`).digest('hex')}`,
      type: 'ClientCertificate',
      parentId: workspace._id,
      created: workspace.created,
      modified: workspace.modified,
      host: text(certificate.host),
      passphrase: certificate.passphrase ?? null,
      cert: certificate.cert ?? null,
      key: certificate.key ?? null,
      pfx: certificate.pfx ?? null,
      disabled: false,
      isPrivate: false,
    },
  }));
}

// ~~~~~~~~~~~~~ //
// Item handling //
// ~~~~~~~~~~~~~ //

// Changes a document so it makes sense in restless, and notes anything the user needs to know about. Returns the
// documents that go in the plan after it. Documents are changed in place: the plan owns them.
async function prepare(entry: Entry, ctx: Context): Promise<PlanItem[]> {
  const { type, doc } = entry;
  const name = displayName(entry, ctx.byId);
  if (doc.type === undefined) {
    doc.type = type;
  }
  const items: PlanItem[] = [{ type, name, doc }];

  // Permission to start local programs is not carried over from another app
  if (doc.mcpStdioAccess === true) {
    doc.mcpStdioAccess = false;
    ctx.issues.push({
      reason: 'not-supported',
      type,
      name: locatedName(entry, ctx.byId),
      detail: 'Local MCP server access was turned off. Grant it again if you trust this item.',
    });
  }

  if (type === 'Project') {
    // Every project becomes a local project of the one organization restless has
    doc.parentId = models.organization.LOCAL_ORGANIZATION_ID;
    doc.remoteId = null;
    if ('gitRepositoryId' in doc) {
      doc.gitRepositoryId = null;
    }
  } else if (type === 'Workspace') {
    for (const certificate of takeLegacyCertificates(doc)) {
      await checkCertificateFiles(certificate, certificate.doc.host || certificate.doc._id, ctx);
      items.push({ type: certificate.type, name: certificate.doc.host || certificate.doc._id, doc: certificate.doc });
    }
  } else if (type === 'WorkspaceMeta') {
    // Cloud and Git sync state means nothing here, and the repository it points at is not moved
    const repositoryId = text(doc.gitRepositoryId) && models.project.decodeRepoId(text(doc.gitRepositoryId));
    if (repositoryId && !ctx.repositoryLinks.has(repositoryId)) {
      ctx.repositoryLinks.set(repositoryId, name);
    }
    Object.assign(doc, {
      gitRepositoryId: null,
      gitFilePath: null,
      gitFileLastSyncTime: null,
      hasUncommittedChanges: false,
      hasUnpushedChanges: false,
      pushSnapshotOnInitialize: false,
    });
  } else if (type === 'RequestMeta') {
    // Responses are not moved
    if (doc.activeResponseId) {
      doc.activeResponseId = null;
    }
  } else if (SECRET_FIELDS.has(type)) {
    const names = clearSecrets(doc, SECRET_FIELDS.get(type)!);
    if (names.length) {
      ctx.issues.push(secretsIssue(entry, locatedName(entry, ctx.byId), names));
    }
  } else if (type === 'ClientCertificate' || type === 'CaCertificate') {
    await checkCertificateFiles(entry, name, ctx);
  } else if (type === 'MockServer' && doc.useInsomniaCloud === true) {
    // The routes are moved as they are. The server itself was hosted by Insomnia.
    ctx.issues.push({
      reason: 'not-supported',
      type,
      name,
      detail:
        'This mock server was hosted by Insomnia Cloud. Its routes were moved. Switch it to self-hosted in the collection settings to use it.',
    });
  }

  return items;
}

// A reserved id gets a new one that comes out the same every time, so running the migration again finds the
// document it made before
function replacementId(type: string, id: string) {
  const prefix = models.getModel(type)?.prefix ?? type.toLowerCase();
  return `${prefix}_${createHash('sha256').update(`restless-migration:${id}`).digest('hex').slice(0, 32)}`;
}

function replaceReservedIds(items: PlanItem[], reserved: ReadonlySet<string>): PlanItem[] {
  const mapping = new Map<string, string>();
  for (const item of items) {
    const { _id } = item.doc as LogDocument;
    if (reserved.has(_id)) {
      mapping.set(_id, replacementId(item.type, _id));
    }
  }
  if (mapping.size === 0) {
    return items;
  }

  const remap = (id: string) => mapping.get(id) ?? id;
  return items.map(item => {
    const doc = item.doc as LogDocument;
    const moved: LogDocument = { ...doc, _id: remap(doc._id) };
    if (typeof doc.parentId === 'string') {
      moved.parentId = remap(doc.parentId);
    }
    // Rewrites ids that are written inside a document, such as a request that points at another one's response
    const rewritten = models.rewriteReferences(moved as unknown as BaseModel, mapping) as unknown as LogDocument;
    // The gRPC model drops protoFileId unless it is in the mapping, which only has the reserved ids
    if (item.type === 'GrpcRequest' && typeof doc.protoFileId === 'string') {
      rewritten.protoFileId = remap(doc.protoFileId);
    }
    return { ...item, doc: rewritten };
  });
}

// ~~~~~~~~~~~~~~~~~~ //
// Source file issues //
// ~~~~~~~~~~~~~~~~~~ //

function problemIssue(problem: FileProblem, product: string): ReportEntry {
  const base = { reason: 'parse-error' as const, type: problem.type, name: problem.file };
  if (problem.error) {
    return { ...base, detail: `The file could not be read (${problem.error}).` };
  }
  const torn = problem.lines.filter(line => line.torn).length;
  const damaged = problem.lines.filter(line => !line.torn).map(line => line.line);
  const parts: string[] = [];
  if (torn) {
    parts.push(`The last line was unfinished, so it was left out. ${product} may have been open.`);
  }
  if (damaged.length) {
    const where = damaged.slice(0, 5).join(', ');
    parts.push(`${plural(damaged.length, 'damaged line was', 'damaged lines were')} left out (line ${where}).`);
  }
  return { ...base, detail: parts.join(' ') };
}

async function unknownTypeIssues(dir: string, types: string[]) {
  const issues: ReportEntry[] = [];
  for (const type of types.filter(type => !isKnownType(type))) {
    const file = dbFileName(type);
    try {
      const { count } = await countLog(path.join(dir, file));
      if (count > 0) {
        issues.push({
          reason: 'unknown-model',
          type,
          name: type,
          detail: `${plural(count, 'document', 'documents')} in ${file}. This version of restless has no ${type} model.`,
        });
      }
    } catch {
      issues.push({ reason: 'unknown-model', type, name: type, detail: `${file} could not be read.` });
    }
  }
  return issues;
}

// ~~~~~~~ //
// Plugins //
// ~~~~~~~ //

// Mirrors how the app finds plugins: folders of the plugins folder, one level into @scope folders, each with a
// package.json that has an `insomnia` key. Only names are read.
async function pluginName(folder: string, fallback: string) {
  let raw: string;
  try {
    raw = await readFile(path.join(folder, 'package.json'), 'utf8');
  } catch {
    return null;
  }
  try {
    const manifest = JSON.parse(raw);
    return isRecord(manifest) && 'insomnia' in manifest && text(manifest.name) !== '' ? manifest.name : null;
  } catch {
    // A package.json that cannot be read: go by the folder name, but only if it looks like a plugin
    return /^(@[^/]+\/)?insomnia-plugin-/.test(fallback) ? fallback : null;
  }
}

async function listPlugins(sourcePath: string) {
  const names = new Set<string>();

  const visit = async (folder: string, scope: string | null) => {
    let entries: string[];
    try {
      entries = await readdir(folder);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(folder, entry);
      try {
        if (!(await stat(full)).isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }
      if (scope === null && entry.startsWith('@')) {
        await visit(full, entry);
        continue;
      }
      const name = await pluginName(full, scope === null ? entry : `${scope}/${entry}`);
      if (name) {
        names.add(name);
      }
    }
  };

  await visit(path.join(sourcePath, 'plugins'), null);
  return [...names].sort();
}

// ~~~~ //
// Plan //
// ~~~~ //

export async function buildInsomniaPlan(source: DetectedSource, options: PlanOptions = {}): Promise<MigrationPlan> {
  const product = source.kind === 'insomnium' ? 'Insomnium' : 'Insomnia';
  const reserved = options.reservedIds ?? RESERVED_IDS;
  const existingProjects = options.existingProjects ?? (await listExistingProjects());

  const readTypes = [...IMPORTED_TYPES, ...GIT_TYPES, ...SECRET_TYPES];
  const [{ documents, problems }, present, plugins] = await Promise.all([
    readFolder(source.path, readTypes),
    listLogTypes(source.path),
    listPlugins(source.path),
  ]);

  const issues: ReportEntry[] = problems.map(problem => problemIssue(problem, product));
  issues.push(...(await unknownTypeIssues(source.path, present)));

  // Every document that could matter, by id
  const byId = new Map<string, Entry>();
  let order = 0;
  for (const type of readTypes) {
    for (const doc of documents.get(type) ?? []) {
      if (doc.type !== undefined && doc.type !== type) {
        issues.push({
          reason: 'parse-error',
          type,
          name: text(doc.name) || doc._id,
          detail: `It is marked as ${text(doc.type)} but is stored with the ${type} documents, so it was left out.`,
        });
      } else if (byId.has(doc._id)) {
        issues.push({
          reason: 'parse-error',
          type,
          name: text(doc.name) || doc._id,
          detail: `A ${byId.get(doc._id)!.type} with the same id was read first, so this one was left out.`,
        });
      } else {
        byId.set(doc._id, { type, doc, order });
        order += 1;
      }
    }
  }

  const ctx: Context = { product, sourcePath: source.path, byId, issues, repositoryLinks: new Map() };

  // Who belongs to whom. Siblings come out grouped by type and then in the order they were written.
  const children = new Map<string, Entry[]>();
  for (const entry of byId.values()) {
    const parentId = text(entry.doc.parentId);
    if (isImportedType(entry.type) && parentId !== '') {
      const siblings = children.get(parentId);
      if (siblings) {
        siblings.push(entry);
      } else {
        children.set(parentId, [entry]);
      }
    }
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.order - b.order);
  }

  // The entry and everything below it that has not been seen yet, parents first
  const walk = (root: Entry, seen: Set<string>) => {
    const found: Entry[] = [];
    const stack = [root];
    while (stack.length) {
      const entry = stack.pop()!;
      if (!seen.has(entry.doc._id)) {
        seen.add(entry.doc._id);
        found.push(entry);
        stack.push(...(children.get(entry.doc._id) ?? []).toReversed());
      }
    }
    return found;
  };

  // Which projects move. A Git project stays where it is and a cloud project with nothing stored here has nothing
  // to move. Everything below those is covered by their entry.
  const moving: Entry[] = [];
  const left: Entry[] = [];
  for (const entry of byId.values()) {
    if (entry.type !== 'Project') {
      continue;
    }
    const name = displayName(entry, byId);
    if (isGitProject(entry.doc)) {
      issues.push(gitProjectIssue(entry, name, ctx));
      left.push(entry);
    } else if (isCloudProject(entry.doc) && !children.get(entry.doc._id)?.length) {
      issues.push({
        reason: 'cloud-only',
        type: 'Project',
        name,
        detail: `This cloud project has no collections on this machine. Export it from ${product}, then import the file.`,
      });
      left.push(entry);
    } else {
      moving.push(entry);
    }
  }

  // One project in restless for each project that moves, with a name nothing else has
  const claimed = new Set<string>();
  for (const entry of moving) {
    const taken = takenNames(existingProjects, claimed, entry.doc._id);
    entry.doc.name = uniqueName(text(entry.doc.name).trim() || product, taken, product);
    claimed.add(entry.doc.name);
  }

  const reached = new Set<string>();
  const ordered: Entry[] = moving.flatMap(project => walk(project, reached));
  // Plugin data belongs to no project
  for (const entry of byId.values()) {
    if (entry.type === 'PluginData') {
      reached.add(entry.doc._id);
      ordered.push(entry);
    }
  }
  const covered = new Set<string>();
  for (const project of left) {
    walk(project, covered);
  }

  // Documents whose parent is not in the source cannot be shown in the app, so they are not moved. They are listed
  // by the first one of each group.
  const loose = [...byId.values()].filter(
    entry => isImportedType(entry.type) && !reached.has(entry.doc._id) && !covered.has(entry.doc._id),
  );
  const looseIds = new Set(loose.map(entry => entry.doc._id));
  const handled = new Set<string>();
  const reportLoose = (entry: Entry) => {
    const below = walk(entry, handled).length - 1;
    issues.push({
      reason: 'not-supported',
      type: entry.type,
      name: displayName(entry, byId),
      detail:
        `Its parent was not found in ${product}, so it was left out.` +
        (below ? ` ${plural(below, 'item', 'items')} inside it ${below === 1 ? 'was' : 'were'} left out too.` : ''),
    });
  };
  for (const entry of loose) {
    if (!looseIds.has(text(entry.doc.parentId))) {
      reportLoose(entry);
    }
  }
  // What is left belongs to a loop of parents
  for (const entry of loose) {
    if (!handled.has(entry.doc._id)) {
      reportLoose(entry);
    }
  }

  const items: PlanItem[] = [];
  for (const entry of ordered) {
    items.push(...(await prepare(entry, ctx)));
  }

  for (const [repositoryId, workspaceName] of ctx.repositoryLinks) {
    issues.push({
      reason: 'git-project',
      type: 'GitRepository',
      name: workspaceName,
      detail: `This collection was synced with Git. It was moved without the sync. ${openFolderAdvice(ctx, byId.get(repositoryId))}`,
    });
  }

  // Credentials and tokens are not moved
  for (const entry of byId.values()) {
    if (!isSecretType(entry.type)) {
      continue;
    }
    if (entry.type === 'OAuth2Token') {
      // A token is named after what it signs in, and those inside a project that was left out are covered by it
      const owner = byId.get(text(entry.doc.parentId));
      if (!covered.has(text(entry.doc.parentId))) {
        issues.push({
          reason: 'secret-not-readable',
          type: entry.type,
          name: owner ? locatedName(owner, byId) : entry.doc._id,
          detail: 'Tokens are not moved. Sign in again from the Auth tab.',
        });
      }
    } else {
      issues.push({
        reason: 'secret-not-readable',
        type: entry.type,
        name: text(entry.doc.name) || text(entry.doc.provider) || entry.doc._id,
        detail: 'Credentials are not moved. Add it again in Preferences > Credentials.',
      });
    }
  }

  return { source, items: replaceReservedIds(items, reserved), issues, plugins };
}

// `source` comes back from the renderer, so it is described again from the folder itself: that makes the counts
// current, and refuses a folder that is not an Insomnia data folder or is restless's own
export async function planInsomnia(source: DetectedSource): Promise<MigrationPlan> {
  if (source.kind !== 'insomnia' && source.kind !== 'insomnium') {
    throw new Error(`A ${source.kind} source is not an Insomnia data folder`);
  }
  const described = await describeSource(source.kind, source.path);
  if (!described) {
    throw new Error(`${source.path} is not an Insomnia or Insomnium data folder`);
  }
  return buildInsomniaPlan(described);
}
