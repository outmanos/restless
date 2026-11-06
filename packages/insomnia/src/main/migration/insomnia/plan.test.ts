import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { database, models, services } from 'insomnia-data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DetectedSource, MigrationPlan, ReportReason } from '../types';
import { ENCRYPTED, READABLE, writeFixture, writeLog } from './make-fixture';
import { dbFileName, IMPORTED_TYPES, QUIET_TYPES } from './models';
import { buildInsomniaPlan, planInsomnia, type PlanOptions, RESERVED_IDS } from './plan';
import { readFolder } from './read-log';
import { expectUntouched, makeTempDir } from './test-support';

type Doc = Record<string, any>;

function sourceAt(dir: string, kind: DetectedSource['kind'] = 'insomnia'): DetectedSource {
  return {
    id: `${kind}:${dir}`,
    kind,
    path: dir,
    counts: { projects: 0, collections: 0, requests: 0, environments: 0 },
    running: false,
  };
}

// Plans a data folder, and checks the folder was left exactly as it was. Every test that reads a source goes through
// here. restless's database is not looked at unless existingProjects is passed as undefined.
function build(dir: string, options: PlanOptions = {}, kind?: DetectedSource['kind']) {
  return expectUntouched(dir, () => buildInsomniaPlan(sourceAt(dir, kind), { existingProjects: [], ...options }));
}

// A generated data folder and the plan for it
async function planFor(options: PlanOptions & { tornTail?: boolean; kind?: DetectedSource['kind'] } = {}) {
  const dir = path.join(makeTempDir(), 'Insomnia');
  writeFixture(dir, { tornTail: options.tornTail });
  const { tornTail: _tornTail, kind, ...planOptions } = options;
  return { dir, plan: await build(dir, planOptions, kind) };
}

const find = (plan: MigrationPlan, id: string) => plan.items.find(item => item.doc._id === id);
const docOf = (plan: MigrationPlan, id: string) => find(plan, id)!.doc as Doc;
const issues = (plan: MigrationPlan, reason: ReportReason) => plan.issues.filter(issue => issue.reason === reason);
const named = (plan: MigrationPlan, type: string, name: string) =>
  plan.items.find(item => item.type === type && item.name === name)!;

beforeEach(async () => {
  await database.init({ inMemoryOnly: true }, true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('what moves', () => {
  it('moves every model the design lists and the three it missed, and nothing else', async () => {
    const { plan } = await planFor();

    expect(new Set(plan.items.map(item => item.type))).toEqual(new Set(IMPORTED_TYPES));
  });

  it('keeps ids, and only the latest version of each document', async () => {
    const { plan } = await planFor();

    expect(docOf(plan, 'req_get_users').name).toBe('Get users');
    expect(docOf(plan, 'env_main_dev').name).toBe('Dev renamed');
    expect(find(plan, 'proj_local')?.name).toBe('My Project');
    for (const removed of ['req_gone', 'wrk_removed', 'proj_removed']) {
      expect(find(plan, removed)).toBeUndefined();
    }
    expect(new Set(plan.items.map(item => item.doc._id)).size).toBe(plan.items.length);
  });

  it('does not move, or mention, settings, statistics, sessions, responses or history', async () => {
    const { plan } = await planFor();
    const quiet: readonly string[] = QUIET_TYPES;

    expect(plan.items.filter(item => quiet.includes(item.type))).toEqual([]);
    expect(plan.issues.filter(issue => quiet.includes(issue.type))).toEqual([]);
    expect(JSON.stringify(plan)).not.toContain('res_1');
  });

  it('accounts for every document: each is planned, or is under something that is reported', async () => {
    const { dir, plan } = await planFor();

    const { documents } = await readFolder(dir, IMPORTED_TYPES);
    const live = [...documents.values()].flat().map(document => document._id);
    const planned = new Set(plan.items.map(item => item.doc._id));
    const left = live.filter(id => !planned.has(id)).sort();

    expect(left).toEqual([
      'proj_cloud_only',
      'proj_git_custom',
      'proj_git_empty',
      'proj_git_managed',
      'req_in_git',
      'req_lost',
      'req_under_orphan',
      'wrk_git_a',
      'wrk_orphan',
    ]);
    // One certificate comes from the old list on a workspace
    expect(plan.items).toHaveLength(live.length - left.length + 1);
  });

  it('puts parents before children', async () => {
    const { plan } = await planFor();

    const position = new Map(plan.items.map((item, index) => [item.doc._id as string, index]));
    for (const [index, item] of plan.items.entries()) {
      const parent = item.doc.parentId as string | null;
      if (parent && parent !== models.organization.LOCAL_ORGANIZATION_ID) {
        expect(position.has(parent), `${item.type} ${item.doc._id} has its parent in the plan`).toBe(true);
        expect(position.get(parent)!, `${item.doc._id} comes after ${parent}`).toBeLessThan(index);
      }
    }
  });

  it('gives the same plan every time', async () => {
    const dir = path.join(makeTempDir(), 'Insomnia');
    writeFixture(dir, { tornTail: true });
    const again = () => build(dir, { existingProjects: [{ _id: 'x', name: 'Shared Name' }] });

    expect(await again()).toEqual(await again());
  });

  it('keeps dates as dates', async () => {
    const { plan } = await planFor();

    const [cookie] = docOf(plan, 'jar_main').cookies;
    expect(cookie.expires).toBeInstanceOf(Date);
    expect(cookie.creation.getTime()).toBe(1_700_000_000_000);
  });

  it('produces documents the database accepts, in the order they are listed', async () => {
    const { plan } = await planFor();

    for (const item of plan.items) {
      await database.insert(item.doc as never);
    }

    expect(await database.count('Project')).toBe(plan.items.filter(item => item.type === 'Project').length);
    expect(await database.count('Request')).toBe(plan.items.filter(item => item.type === 'Request').length);
    const request = (await database.findOne('Request', { _id: 'req_create_user' })) as Doc | undefined;
    expect(request?.authentication.password).toBe(READABLE.basicPassword);
  });

  it('lists the plugins in the plugins folder, with scoped ones, and nothing that is not a plugin', async () => {
    const { plan } = await planFor();

    expect(plan.plugins).toEqual(['@acme/insomnia-plugin-acme', 'insomnia-plugin-broken', 'insomnia-plugin-faker']);
  });

  it('has no plugins when there is no plugins folder', async () => {
    const dir = path.join(makeTempDir(), 'Insomnia');
    writeLog(dir, 'Workspace', [{ _id: 'wrk_1' }]);

    const plan = await build(dir);

    expect(plan.plugins).toEqual([]);
  });
});

describe('projects', () => {
  it('makes every project a local project of the local organization', async () => {
    const { plan } = await planFor();

    const projects = plan.items.filter(item => item.type === 'Project');
    expect(projects.map(project => project.doc._id)).toEqual([
      'proj_local',
      'proj_team',
      'proj_dup_a',
      'proj_dup_b',
      'proj_shared',
      'proj_scratchpad',
    ]);
    for (const { doc } of projects) {
      expect(doc.parentId).toBe('org_local');
      expect(doc.remoteId).toBeNull();
    }
  });

  it('moves a cloud project that has collections on this machine, as a local one', async () => {
    const { plan } = await planFor();

    expect(docOf(plan, 'proj_team')).toMatchObject({ name: 'Team API', remoteId: null, parentId: 'org_local' });
    expect(docOf(plan, 'wrk_team').parentId).toBe('proj_team');
    expect(find(plan, 'req_team')).toBeDefined();
    expect(issues(plan, 'cloud-only').map(issue => issue.name)).not.toContain('Team API');
  });

  it('reports a cloud project with nothing on this machine as cloud-only, and leaves it out', async () => {
    const { plan } = await planFor();

    expect(find(plan, 'proj_cloud_only')).toBeUndefined();
    expect(issues(plan, 'cloud-only')).toEqual([
      {
        reason: 'cloud-only',
        type: 'Project',
        name: 'Cloud only',
        detail: expect.stringContaining('no collections on this machine'),
      },
    ]);
  });

  it('leaves Git projects, and everything in them, out, and points at the folder', async () => {
    const { dir, plan } = await planFor();

    for (const id of ['proj_git_managed', 'proj_git_custom', 'proj_git_empty', 'wrk_git_a', 'req_in_git']) {
      expect(find(plan, id)).toBeUndefined();
    }
    const managed = path.join(
      dir,
      'version-control',
      'git',
      models.gitRepository.getGitRepoFolderName({ _id: 'git_managed', folderSlug: 'git-managed' }),
    );
    const gitProjects = issues(plan, 'git-project').filter(issue => issue.type === 'Project');
    expect(gitProjects).toEqual([
      {
        reason: 'git-project',
        type: 'Project',
        name: 'Git managed',
        detail: `Use File > Open Folder… to open ${managed}. It is inside the Insomnia data folder.`,
      },
      {
        reason: 'git-project',
        type: 'Project',
        name: 'Git custom',
        detail: 'Use File > Open Folder… to open /home/tester/api-repo.',
      },
      {
        reason: 'git-project',
        type: 'Project',
        name: 'Git empty',
        detail: 'It is not connected to a repository, so there is no folder to open.',
      },
    ]);
  });

  it('does not report what is inside a Git project a second time', async () => {
    const { plan } = await planFor();

    expect(plan.issues.map(issue => issue.name)).not.toContain('Git request');
    expect(JSON.stringify(plan.issues)).not.toContain('oa2_in_git');
    // Its token is under a request in the Git project, so only the one in the main collection is reported
    expect(issues(plan, 'secret-not-readable').filter(issue => issue.type === 'OAuth2Token')).toHaveLength(1);
  });

  it('moves the Git sync state off a workspace and reports its repository', async () => {
    const { dir, plan } = await planFor();

    expect(docOf(plan, 'wrkm_legacy_git')).toMatchObject({
      gitRepositoryId: null,
      gitFilePath: null,
      gitFileLastSyncTime: null,
    });
    expect(docOf(plan, 'wrkm_main')).toMatchObject({
      hasUncommittedChanges: false,
      hasUnpushedChanges: false,
      pushSnapshotOnInitialize: false,
      // Where the user was in the collection is kept
      activeRequestId: 'req_get_users',
      activeEnvironmentId: 'env_main_prod',
    });
    expect(issues(plan, 'git-project').filter(issue => issue.type === 'GitRepository')).toEqual([
      {
        reason: 'git-project',
        type: 'GitRepository',
        name: 'Old git sync',
        detail: expect.stringContaining(path.join(dir, 'version-control', 'git', 'git_legacy')),
      },
    ]);
  });

  it('does not report a repository that nothing uses', async () => {
    const { plan } = await planFor();

    expect(JSON.stringify(plan.issues)).not.toContain('git_unused');
  });

  it('never puts the address or token of a repository in the report', async () => {
    const { plan } = await planFor();

    const reported = JSON.stringify(plan.issues);
    expect(reported).not.toContain(READABLE.repoToken);
    expect(reported).not.toContain(READABLE.repoPassword);
    expect(reported).not.toContain('managed.git');
  });

  it('moves a project that has no collections, and a project lint ruleset with its project', async () => {
    const { plan } = await planFor();

    expect(find(plan, 'proj_shared')).toBeDefined();
    expect(docOf(plan, 'plr_main')).toMatchObject({ parentId: 'proj_local', rulesetContent: 'extends: spectral:oas' });
  });

  describe('names', () => {
    const projectNames = (plan: MigrationPlan) =>
      Object.fromEntries(plan.items.filter(item => item.type === 'Project').map(item => [item.doc._id, item.name]));

    it('adds the product name to a project whose name restless already has, whatever the case', async () => {
      const { plan } = await planFor({
        existingProjects: [
          { _id: 'proj_mine', name: 'Shared Name' },
          { _id: 'proj_mine_2', name: 'my project' },
        ],
      });

      expect(projectNames(plan)).toEqual({
        proj_local: 'My Project (Insomnia)',
        proj_team: 'Team API',
        proj_dup_a: 'Dup',
        proj_dup_b: 'Dup (Insomnia)',
        proj_shared: 'Shared Name (Insomnia)',
        proj_scratchpad: 'Insomnia',
      });
      // The name on the project is the name in the plan
      expect(docOf(plan, 'proj_shared').name).toBe('Shared Name (Insomnia)');
    });

    it('says Insomnium for an Insomnium source', async () => {
      const { plan } = await planFor({ kind: 'insomnium', existingProjects: [{ _id: 'x', name: 'Shared Name' }] });

      expect(projectNames(plan).proj_shared).toBe('Shared Name (Insomnium)');
    });

    it('numbers the name when the suffixed one is taken too', async () => {
      const { plan } = await planFor({
        existingProjects: [
          { _id: 'a', name: 'Dup' },
          { _id: 'b', name: 'Dup (Insomnia)' },
        ],
      });

      expect(projectNames(plan).proj_dup_a).toBe('Dup (Insomnia 2)');
      expect(projectNames(plan).proj_dup_b).toBe('Dup (Insomnia 3)');
    });

    it('does not count a project that is already in restless as a clash with itself', async () => {
      const { plan } = await planFor({ existingProjects: [{ _id: 'proj_shared', name: 'Shared Name' }] });

      expect(projectNames(plan).proj_shared).toBe('Shared Name');
    });

    it('reads the names restless has from its database when none are given', async () => {
      await services.project.create({ name: 'Shared Name', parentId: models.organization.LOCAL_ORGANIZATION_ID });
      const dir = path.join(makeTempDir(), 'Insomnia');
      writeFixture(dir);

      const plan = await build(dir, { existingProjects: undefined });

      expect(projectNames(plan).proj_shared).toBe('Shared Name (Insomnia)');
    });
  });
});

describe('secrets', () => {
  it('empties vault values and secret entries, and keeps their names, types and the rest', async () => {
    const { plan } = await planFor();

    const base = docOf(plan, 'env_main_base');
    expect(base.data).toEqual({ baseUrl: 'https://api.example.com', __insomnia_vault: { API_KEY: '', TOKEN: '' } });
    expect(base.kvPairData.map((pair: Doc) => [pair.name, pair.type, pair.value])).toEqual([
      ['baseUrl', 'str', 'https://api.example.com'],
      ['API_KEY', 'secret', ''],
      ['TOKEN', 'secret', ''],
      ['note', 'str', 'kept'],
    ]);
    // Confidential values are only hidden on screen, not encrypted, so they move
    expect(base.kvPairData[3].isConfidential).toBe(true);
    expect(docOf(plan, 'env_main_prod').data.__insomnia_vault).toEqual({ DB_PASSWORD: '' });
    expect(docOf(plan, 'env_main_dev').data).toEqual({ host: 'dev' });
  });

  it('does the same for folders and MCP servers', async () => {
    const { plan } = await planFor();

    const folder = docOf(plan, 'fld_users');
    expect(folder.environment).toEqual({ folderVar: 'x', __insomnia_vault: { FOLDER_SECRET: '' } });
    expect(folder.kvPairData.map((pair: Doc) => pair.value)).toEqual(['x', '']);
    expect(docOf(plan, 'mcp-req_tools').env.map((pair: Doc) => [pair.name, pair.value])).toEqual([
      ['MODE', 'dev'],
      ['MCP_SECRET', ''],
    ]);
  });

  it('reports each one with the names that were emptied, and says where they are', async () => {
    const { plan } = await planFor();

    const entries = issues(plan, 'secret-not-readable').filter(issue =>
      ['Environment', 'RequestGroup', 'McpRequest'].includes(issue.type),
    );
    expect(entries.map(entry => [entry.type, entry.name])).toEqual([
      ['Environment', 'Base Environment in Main API'],
      ['Environment', 'Prod in Main API'],
      ['RequestGroup', 'Users in Main API'],
      ['McpRequest', 'Tools in MCP'],
    ]);
    expect(entries[0].detail).toContain('API_KEY, TOKEN');
    expect(entries[1].detail).toContain('DB_PASSWORD');
    expect(entries[0].detail).toContain('Preferences > Security');
  });

  it('shortens a long list of names', async () => {
    const dir = path.join(makeTempDir(), 'Insomnia');
    const vault = Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`SECRET_${index}`, 'cipher']));
    writeLog(dir, 'Project', [{ _id: 'proj_1', name: 'P', remoteId: null }]);
    writeLog(dir, 'Workspace', [{ _id: 'wrk_1', parentId: 'proj_1', name: 'W' }]);
    writeLog(dir, 'Environment', [
      { _id: 'env_1', parentId: 'wrk_1', name: 'Many', data: { __insomnia_vault: vault } },
    ]);

    const plan = await build(dir);

    const [entry] = issues(plan, 'secret-not-readable');
    expect(entry.detail).toContain('SECRET_9 and 3 more');
    expect(entry.detail).not.toContain('SECRET_10');
  });

  it('never writes a secret into a report entry, and does not move encrypted values', async () => {
    const { plan } = await planFor();

    const reported = JSON.stringify(plan.issues);
    const moved = JSON.stringify(plan.items);
    for (const value of [...Object.values(ENCRYPTED), ...Object.values(READABLE)]) {
      expect(reported, `the report contains ${value}`).not.toContain(value);
    }
    for (const value of Object.values(ENCRYPTED)) {
      expect(moved, `the plan contains ${value}`).not.toContain(value);
    }
  });

  it('moves values the app stores in plain text, since they can be read', async () => {
    const { plan } = await planFor();

    expect(docOf(plan, 'req_create_user').authentication.password).toBe(READABLE.basicPassword);
    expect(docOf(plan, 'crt_client_ok').passphrase).toBe(READABLE.certPassphrase);
  });

  it('does not move credentials or tokens, and reports each by name', async () => {
    const { plan } = await planFor();

    const moved = JSON.stringify(plan.items);
    for (const value of [READABLE.gitToken, READABLE.oauthAccess, READABLE.oauthRefresh, READABLE.vaultKey]) {
      expect(moved).not.toContain(value);
    }
    expect(plan.items.some(item => ['GitCredentials', 'CloudCredential', 'OAuth2Token'].includes(item.type))).toBe(
      false,
    );
    const entries = issues(plan, 'secret-not-readable').filter(issue =>
      ['GitCredentials', 'CloudCredential', 'OAuth2Token'].includes(issue.type),
    );
    expect(entries.map(entry => [entry.type, entry.name])).toEqual([
      ['GitCredentials', 'Work GitHub'],
      ['CloudCredential', 'AWS dev'],
      ['OAuth2Token', 'Get users in Main API'],
    ]);
  });
});

describe('certificates', () => {
  it('keeps certificate paths, and reports the files that are not there', async () => {
    const { dir, plan } = await planFor();

    expect(docOf(plan, 'crt_client_ok')).toMatchObject({
      cert: path.join(dir, 'certs', 'client.pem'),
      key: path.join(dir, 'certs', 'client.key'),
    });
    expect(issues(plan, 'file-missing')).toEqual([
      {
        reason: 'file-missing',
        type: 'ClientCertificate',
        name: 'missing.example.com',
        detail: `Not found: cert ${path.join(dir, 'certs', 'gone.pem')}, key ${path.join(dir, 'certs', 'gone.key')}. The certificate was moved with these paths.`,
      },
      {
        reason: 'file-missing',
        type: 'CaCertificate',
        name: path.join(dir, 'certs', 'gone-ca.pem'),
        detail: `Not found: path ${path.join(dir, 'certs', 'gone-ca.pem')}. The certificate was moved with these paths.`,
      },
      {
        reason: 'file-missing',
        type: 'ClientCertificate',
        name: 'old.example.com',
        detail: expect.stringContaining('old.pem'),
      },
    ]);
    expect(find(plan, 'crt_client_missing')).toBeDefined();
    expect(find(plan, 'crt_ca_missing')).toBeDefined();
  });

  it('turns the old list of certificates on a workspace into certificates, with the same ids each time', async () => {
    const first = await planFor();
    const second = await planFor();

    const certificate = first.plan.items.find(item => item.doc.parentId === 'wrk_old_certs')!;
    expect(certificate.type).toBe('ClientCertificate');
    expect(certificate.doc._id).toMatch(/^crt_[0-9a-f]{40}$/);
    expect(certificate.doc).toMatchObject({ host: 'old.example.com', passphrase: READABLE.legacyPassphrase });
    // Left in place, opening the workspace would make the model layer create the certificate itself
    expect(docOf(first.plan, 'wrk_old_certs')).not.toHaveProperty('certificates');
    expect(second.plan.items.find(item => item.doc.parentId === 'wrk_old_certs')!.doc._id).toBe(certificate.doc._id);
  });
});

describe('other changes', () => {
  it('turns local MCP server access off and says so', async () => {
    const { plan } = await planFor();
    expect(docOf(plan, 'proj_local').mcpStdioAccess).toBe(false);
    expect(issues(plan, 'not-supported').some(issue => issue.detail?.includes('Local MCP server access'))).toBe(true);
  });

  it('clears the response a request was showing, since responses are not moved', async () => {
    const { plan } = await planFor();

    expect(docOf(plan, 'reqm_get_users')).toMatchObject({ activeResponseId: null, pinned: true });
  });

  it('keeps the routes of a mock server that Insomnia hosted, and says it needs setting up again', async () => {
    const { plan } = await planFor();

    expect(find(plan, 'mock-route_1')).toBeDefined();
    expect(docOf(plan, 'mock_1').useInsomniaCloud).toBe(true);
    expect(issues(plan, 'not-supported').filter(issue => issue.type === 'MockServer')).toEqual([
      {
        reason: 'not-supported',
        type: 'MockServer',
        name: 'Mock',
        detail: expect.stringContaining('self-hosted'),
      },
    ]);
  });

  it('names items by what they belong to, so a report can be read', async () => {
    const { plan } = await planFor();

    expect(find(plan, 'reqm_get_users')?.name).toBe('Get users');
    expect(find(plan, 'spc_petstore')?.name).toBe('Petstore');
    expect(find(plan, 'plg_1')?.name).toBe('insomnia-plugin-faker: seed');
    expect(find(plan, 'mcp-payload_1')?.name).toBe('tools/list');
    expect(find(plan, 'crt_ca_ok')?.name).toContain('ca.pem');
  });
});

describe('documents that cannot be placed or read', () => {
  it('reports a document whose parent is missing once, with how much was under it', async () => {
    const { plan } = await planFor();

    expect(find(plan, 'wrk_orphan')).toBeUndefined();
    expect(find(plan, 'req_under_orphan')).toBeUndefined();
    expect(find(plan, 'req_lost')).toBeUndefined();
    expect(
      issues(plan, 'not-supported').filter(
        issue => issue.type !== 'MockServer' && !issue.detail?.includes('Local MCP server access'),
      ),
    ).toEqual([
      {
        reason: 'not-supported',
        type: 'Workspace',
        name: 'Lost',
        detail: 'Its parent was not found in Insomnia, so it was left out. 1 item inside it was left out too.',
      },
      {
        reason: 'not-supported',
        type: 'Request',
        name: 'Lost request',
        detail: 'Its parent was not found in Insomnia, so it was left out.',
      },
    ]);
  });

  it('reports documents that are each other parents, instead of looping or dropping them quietly', async () => {
    const dir = path.join(makeTempDir(), 'Insomnia');
    writeLog(dir, 'RequestGroup', [
      { _id: 'fld_a', parentId: 'fld_b', name: 'A' },
      { _id: 'fld_b', parentId: 'fld_a', name: 'B' },
    ]);
    writeLog(dir, 'Workspace', []);

    const plan = await build(dir);

    expect(plan.items).toEqual([]);
    expect(issues(plan, 'not-supported').map(issue => issue.name)).toEqual(['A']);
    expect(issues(plan, 'not-supported')[0].detail).toContain('1 item inside it was left out too');
  });

  it('copes with metadata documents that name each other as their owner', async () => {
    const dir = path.join(makeTempDir(), 'Insomnia');
    writeLog(dir, 'Workspace', []);
    writeLog(dir, 'RequestMeta', [
      { _id: 'reqm_a', parentId: 'reqm_b' },
      { _id: 'reqm_b', parentId: 'reqm_a' },
    ]);

    const plan = await build(dir);

    expect(plan.items).toEqual([]);
    expect(issues(plan, 'not-supported').map(issue => issue.type)).toEqual(['RequestMeta']);
  });

  it('reports a document whose id another file already used', async () => {
    const dir = path.join(makeTempDir(), 'Insomnia');
    writeLog(dir, 'Workspace', []);
    writeLog(dir, 'Request', [{ _id: 'same', parentId: 'nowhere', name: 'A request' }]);
    writeLog(dir, 'GrpcRequest', [{ _id: 'same', parentId: 'nowhere', name: 'A gRPC request' }]);

    const plan = await build(dir);

    expect(issues(plan, 'parse-error')).toEqual([
      {
        reason: 'parse-error',
        type: 'GrpcRequest',
        name: 'A gRPC request',
        detail: 'A Request with the same id was read first, so this one was left out.',
      },
    ]);
  });

  it('reports a last line that was cut short, and moves everything else', async () => {
    const { plan } = await planFor({ tornTail: true });

    expect(issues(plan, 'parse-error')).toEqual([
      {
        reason: 'parse-error',
        type: 'Request',
        name: 'insomnia.Request.db',
        detail: 'The last line was unfinished, so it was left out. Insomnia may have been open.',
      },
    ]);
    expect(find(plan, 'req_cut_short')).toBeUndefined();
    expect(find(plan, 'req_get_users')).toBeDefined();
  });

  it('reports damaged lines in the middle of a file with their line numbers', async () => {
    const dir = path.join(makeTempDir(), 'Insomnia');
    mkdirSync(dir, { recursive: true });
    writeLog(dir, 'Workspace', [{ _id: 'wrk_1', parentId: 'proj_1', name: 'W' }]);
    writeLog(dir, 'Project', [
      { _id: 'proj_1', name: 'P', remoteId: null },
      'broken {',
      { _id: 'proj_2', name: 'Q' },
      'also broken',
    ]);

    const plan = await build(dir);

    expect(issues(plan, 'parse-error')).toEqual([
      {
        reason: 'parse-error',
        type: 'Project',
        name: 'insomnia.Project.db',
        detail: '2 damaged lines were left out (line 2, 4).',
      },
    ]);
    expect(plan.items.map(item => item.doc._id)).toEqual(['proj_1', 'wrk_1', 'proj_2']);
  });

  it('reports a data file that cannot be read', async () => {
    const dir = path.join(makeTempDir(), 'Insomnia');
    writeLog(dir, 'Workspace', []);
    mkdirSync(path.join(dir, dbFileName('Request')));

    const plan = await build(dir);

    expect(issues(plan, 'parse-error')).toEqual([
      {
        reason: 'parse-error',
        type: 'Request',
        name: 'insomnia.Request.db',
        detail: 'The file could not be read (ENOTFILE).',
      },
    ]);
  });

  it('reports a type this version of restless does not have, with how many documents are in it', async () => {
    const { plan } = await planFor();

    expect(issues(plan, 'unknown-model')).toEqual([
      {
        reason: 'unknown-model',
        type: 'FutureThing',
        name: 'FutureThing',
        detail: '1 document in insomnia.FutureThing.db. This version of restless has no FutureThing model.',
      },
    ]);
  });

  it('says nothing about an unknown type with no documents left in it', async () => {
    const dir = path.join(makeTempDir(), 'Insomnia');
    writeLog(dir, 'Workspace', []);
    writeLog(dir, 'FutureThing', [{ _id: 'ft_1' }, { $$deleted: true, _id: 'ft_1' }]);

    const plan = await build(dir);

    expect(plan.issues).toEqual([]);
  });

  it('refuses a document that says it is another type than the file it is in', async () => {
    const dir = path.join(makeTempDir(), 'Insomnia');
    writeLog(dir, 'Workspace', []);
    writeLog(dir, 'Request', [{ _id: 'x', type: 'Workspace', name: 'Odd', parentId: 'y' }]);

    const plan = await build(dir);

    expect(plan.items).toEqual([]);
    expect(issues(plan, 'parse-error')).toEqual([
      {
        reason: 'parse-error',
        type: 'Request',
        name: 'Odd',
        detail: 'It is marked as Workspace but is stored with the Request documents, so it was left out.',
      },
    ]);
  });
});

describe('reserved ids', () => {
  it('reserves none today, because restless has no scratch pad or any other fixed id', () => {
    expect(RESERVED_IDS.size).toBe(0);
    // If these ever start to return true for a fixed id, list that id in RESERVED_IDS
    expect(models.project.isScratchpadProject({ _id: 'proj_scratchpad' })).toBe(false);
    expect(models.workspace.isScratchpad({ _id: 'wrk_scratchpad' } as never)).toBe(false);
  });

  it("keeps the ids Insomnia's scratch pad used, as it does any other id", async () => {
    const { plan } = await planFor();

    expect(docOf(plan, 'proj_scratchpad')).toMatchObject({ name: 'Insomnia', parentId: 'org_local' });
    expect(docOf(plan, 'wrk_scratchpad').parentId).toBe('proj_scratchpad');
  });

  it('gives a reserved id a new one, and updates everything that points at it', async () => {
    const { plan } = await planFor({ reservedIds: new Set(['wrk_main', 'req_get_users', 'pf_users']) });

    const workspace = named(plan, 'Workspace', 'Main API').doc as Doc;
    const request = named(plan, 'Request', 'Get users').doc as Doc;
    const proto = named(plan, 'ProtoFile', 'users.proto').doc as Doc;
    expect(workspace._id).toMatch(/^wrk_[0-9a-f]{32}$/);
    expect(request._id).toMatch(/^req_[0-9a-f]{32}$/);
    expect(proto._id).toMatch(/^pf_[0-9a-f]{32}$/);
    for (const id of ['wrk_main', 'req_get_users', 'pf_users']) {
      expect(find(plan, id)).toBeUndefined();
    }

    // Children
    for (const id of ['wrkm_main', 'env_main_base', 'fld_users', 'req_root', 'jar_main']) {
      expect(docOf(plan, id).parentId).toBe(workspace._id);
    }
    expect(docOf(plan, 'reqm_get_users').parentId).toBe(request._id);
    expect(docOf(plan, 'pd_root').parentId).toBe(workspace._id);

    // References written inside other documents
    const create = docOf(plan, 'req_create_user');
    expect(create.url).toContain(request._id);
    expect(create.url).not.toContain('req_get_users');
    expect(docOf(plan, 'wrkm_main').activeRequestId).toBe(request._id);
    expect(docOf(plan, 'ut_one').requestId).toBe(request._id);
    expect(docOf(plan, 'greq_users').protoFileId).toBe(proto._id);

    // Nothing else moved, and the order is still parents first
    const baseline = (await planFor()).plan;
    expect(plan.items).toHaveLength(baseline.items.length);
    expect(plan.items.map(item => item.type)).toEqual(baseline.items.map(item => item.type));
    const position = new Map(plan.items.map((item, index) => [item.doc._id as string, index]));
    expect(position.get(workspace._id)!).toBeLessThan(position.get(docOf(plan, 'wrkm_main')._id)!);
  });

  it('keeps the proto file of a gRPC request when only another id is reserved', async () => {
    const { plan } = await planFor({ reservedIds: new Set(['wrk_main']) });

    // The model layer's own rewrite would clear it, since pf_users is not in the mapping
    expect(docOf(plan, 'greq_users').protoFileId).toBe('pf_users');
    expect(docOf(plan, 'greq_users').parentId).toMatch(/^wrk_[0-9a-f]{32}$/);
  });

  it('gives the same new id each time, and a different one for each id', async () => {
    const options = { reservedIds: new Set(['wrk_main', 'wrk_design']) };
    const first = (await planFor(options)).plan;
    const second = (await planFor(options)).plan;

    const ids = (plan: MigrationPlan) => plan.items.filter(item => item.type === 'Workspace').map(item => item.doc._id);
    expect(ids(first)).toEqual(ids(second));
    const [main, design] = [
      named(first, 'Workspace', 'Main API').doc._id,
      named(first, 'Workspace', 'Petstore').doc._id,
    ];
    expect(main).not.toBe(design);
  });
});

describe('planInsomnia()', () => {
  async function folder() {
    const dir = path.join(makeTempDir(), 'Insomnia');
    writeFixture(dir);
    return dir;
  }

  it('describes the folder again instead of believing the counts it was given', async () => {
    const dir = await folder();
    const claimed: DetectedSource = {
      ...sourceAt(dir),
      counts: { projects: 999, collections: 999, requests: 999, environments: 999 },
      running: true,
    };

    const plan = await expectUntouched(dir, () => planInsomnia(claimed));

    expect(plan.source).toEqual({
      id: `insomnia:${dir}`,
      kind: 'insomnia',
      path: dir,
      counts: { projects: 10, collections: 11, requests: 13, environments: 4 },
      running: false,
    });
    expect(plan.items.length).toBeGreaterThan(0);
  });

  it('refuses a folder that is not an Insomnia data folder', async () => {
    const empty = makeTempDir();

    await expect(planInsomnia(sourceAt(empty))).rejects.toThrow('not an Insomnia or Insomnium data folder');
    await expect(planInsomnia(sourceAt(path.join(empty, 'missing')))).rejects.toThrow('not an Insomnia');
  });

  it('refuses a Bruno source', async () => {
    const dir = await folder();

    await expect(planInsomnia(sourceAt(dir, 'bruno'))).rejects.toThrow('bruno source');
  });

  it("refuses restless's own data folder", async () => {
    const dir = await folder();
    vi.stubEnv('INSOMNIA_DATA_PATH', dir);

    await expect(planInsomnia(sourceAt(dir))).rejects.toThrow('not an Insomnia or Insomnium data folder');
  });
});
