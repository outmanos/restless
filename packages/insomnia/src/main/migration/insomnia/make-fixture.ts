// Writes a fake Insomnia data folder for the migration tests. Everything in it is invented here, nothing is copied
// from a real install, and every secret is a recognisable placeholder so a test can look for it.
//
// To get a folder to look at:  npx esr src/main/migration/insomnia/make-fixture.ts /tmp/Insomnia
import { mkdirSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { dbFileName } from './models';

type Doc = Record<string, any>;

const T = 1_700_000_000_000;

// Written to every file, so nothing in a fixture looks like an app that is still running
const LONG_AGO = new Date('2020-01-01T00:00:00Z');

// Values that were encrypted or are tokens. They must never appear in a plan's report entries, and a plan must
// not carry the encrypted ones over.
export const ENCRYPTED = {
  apiKey: 'ENCRYPTED-API-KEY',
  token: 'ENCRYPTED-TOKEN',
  dbPassword: 'ENCRYPTED-DB-PASSWORD',
  folderSecret: 'ENCRYPTED-FOLDER-SECRET',
  mcpSecret: 'ENCRYPTED-MCP-SECRET',
};

// Values the app stores in plain text. They are moved as they are, but still must not appear in the report.
export const READABLE = {
  basicPassword: 'BASIC-PASSWORD',
  certPassphrase: 'CERT-PASSPHRASE',
  legacyPassphrase: 'LEGACY-PASSPHRASE',
  repoToken: 'REPO-TOKEN',
  repoPassword: 'REPO-PASSWORD',
  gitToken: 'GIT-TOKEN',
  oauthAccess: 'OAUTH-ACCESS',
  oauthRefresh: 'OAUTH-REFRESH',
  vaultKey: 'VAULT-KEY',
};

// What NeDB writes for a Date
export function serialize(value: unknown): string {
  return JSON.stringify(value, function (this: any, key, replaced) {
    const original = this[key];
    return original instanceof Date ? { $$date: original.getTime() } : replaced;
  });
}

export const deleted = (_id: string) => ({ $$deleted: true, _id });

// Entries are documents, or lines that are written as they are
export function writeLog(dir: string, type: string, entries: unknown[], tail = '') {
  mkdirSync(dir, { recursive: true });
  const lines = entries.map(entry => `${typeof entry === 'string' ? entry : serialize(entry)}\n`);
  writeFileSync(path.join(dir, dbFileName(type)), lines.join('') + tail);
}

export function writeFile(dir: string, relative: string, content: string) {
  const file = path.join(dir, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

// Sets every modification time below `dir`, files first so a directory is not touched again afterwards
export function setTimes(dir: string, date = LONG_AGO) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      setTimes(full, date);
    } else {
      utimesSync(full, date, date);
    }
  }
  utimesSync(dir, date, date);
}

const doc = (type: string, _id: string, parentId: string | null, fields: Doc = {}): Doc => ({
  _id,
  type,
  parentId,
  modified: T,
  created: T,
  ...fields,
});

const TORN_TAIL = '{"_id":"req_cut_short","type":"Request","parentId":"wrk_main","name":"Cut sho';

export interface FixtureOptions {
  // Leave the Request file ending in half a line, as if the app was writing when it was read
  tornTail?: boolean;
}

// Documents by model type. Some are written twice and some removed, as the app's own appends would leave them.
function buildLogs(dir: string): Record<string, unknown[]> {
  const certs = (name: string) => path.join(dir, 'certs', name);

  return {
    Project: [
      { $$indexCreated: { fieldName: 'name', unique: false, sparse: false } },
      doc('Project', 'proj_local', null, { name: 'Untitled', remoteId: null, mcpStdioAccess: true }),
      doc('Project', 'proj_removed', null, { name: 'Removed project', remoteId: null }),
      doc('Project', 'proj_team', 'org_team', { name: 'Team API', remoteId: 'proj_org_team' }),
      doc('Project', 'proj_cloud_only', 'org_team', { name: 'Cloud only', remoteId: 'proj_org_cloud' }),
      doc('Project', 'proj_git_managed', 'org_team', {
        name: 'Git managed',
        remoteId: null,
        gitRepositoryId: 'gr_managed',
      }),
      doc('Project', 'proj_git_custom', 'org_team', {
        name: 'Git custom',
        remoteId: null,
        gitRepositoryId: 'git_custom',
      }),
      doc('Project', 'proj_git_empty', 'org_team', { name: 'Git empty', remoteId: null, gitRepositoryId: 'empty' }),
      doc('Project', 'proj_dup_a', 'org_team', { name: 'Dup', remoteId: null }),
      doc('Project', 'proj_dup_b', 'org_team', { name: 'Dup', remoteId: null }),
      doc('Project', 'proj_shared', 'org_team', { name: 'Shared Name', remoteId: null }),
      doc('Project', 'proj_scratchpad', 'org_scratchpad', { name: 'Insomnia', remoteId: null }),
      {
        ...doc('Project', 'proj_local', null, { name: 'My Project', remoteId: null, mcpStdioAccess: true }),
        modified: T + 5000,
      },
      deleted('proj_removed'),
    ],

    ProjectLintRuleset: [
      doc('ProjectLintRuleset', 'plr_main', 'proj_local', { rulesetContent: 'extends: spectral:oas' }),
    ],

    Workspace: [
      doc('Workspace', 'wrk_main', 'proj_local', { name: 'Main API', scope: 'collection', description: 'Main' }),
      doc('Workspace', 'wrk_design', 'proj_local', { name: 'Petstore', scope: 'design' }),
      doc('Workspace', 'wrk_mock', 'proj_local', { name: 'Mock', scope: 'mock-server' }),
      doc('Workspace', 'wrk_globals', 'proj_local', { name: 'Globals', scope: 'environment' }),
      doc('Workspace', 'wrk_mcp', 'proj_local', { name: 'MCP', scope: 'mcp' }),
      doc('Workspace', 'wrk_legacy_git', 'proj_local', { name: 'Old git sync', scope: 'collection' }),
      doc('Workspace', 'wrk_old_certs', 'proj_local', {
        name: 'Old certs',
        scope: 'collection',
        certificates: [
          {
            host: 'old.example.com',
            cert: certs('old.pem'),
            key: certs('old.key'),
            passphrase: READABLE.legacyPassphrase,
          },
        ],
      }),
      doc('Workspace', 'wrk_team', 'proj_team', { name: 'Team collection', scope: 'collection' }),
      doc('Workspace', 'wrk_git_a', 'proj_git_managed', { name: 'In git', scope: 'collection' }),
      doc('Workspace', 'wrk_scratchpad', 'proj_scratchpad', { name: 'Scratch Pad', scope: 'collection' }),
      doc('Workspace', 'wrk_orphan', 'proj_missing', { name: 'Lost', scope: 'collection' }),
      doc('Workspace', 'wrk_removed', 'proj_local', { name: 'Removed', scope: 'collection' }),
      deleted('wrk_removed'),
    ],

    WorkspaceMeta: [
      doc('WorkspaceMeta', 'wrkm_main', 'wrk_main', {
        activeRequestId: 'req_get_users',
        activeEnvironmentId: 'env_main_prod',
        gitRepositoryId: null,
        hasUncommittedChanges: true,
        hasUnpushedChanges: true,
        pushSnapshotOnInitialize: true,
      }),
      doc('WorkspaceMeta', 'wrkm_legacy_git', 'wrk_legacy_git', {
        gitRepositoryId: 'git_legacy',
        gitFilePath: 'legacy.yaml',
        gitFileLastSyncTime: T,
        cachedGitLastAuthor: 'Someone',
      }),
    ],

    GitRepository: [
      doc('GitRepository', 'git_managed', null, {
        uri: `https://user:${READABLE.repoToken}@example.com/org/managed.git`,
        folderSlug: 'git-managed',
        directory: null,
        credentials: { username: 'user', password: READABLE.repoPassword },
      }),
      doc('GitRepository', 'git_custom', null, {
        uri: 'https://example.com/org/custom.git',
        directory: '/home/tester/api-repo',
        folderSlug: null,
      }),
      doc('GitRepository', 'git_legacy', null, { uri: 'https://example.com/org/legacy.git', directory: null }),
      doc('GitRepository', 'git_unused', null, { uri: 'https://example.com/org/unused.git' }),
    ],

    Environment: [
      doc('Environment', 'env_main_base', 'wrk_main', {
        name: 'Base Environment',
        isPrivate: true,
        environmentType: 'kv',
        metaSortKey: 1,
        data: {
          baseUrl: 'https://api.example.com',
          __insomnia_vault: { API_KEY: ENCRYPTED.apiKey, TOKEN: ENCRYPTED.token },
        },
        kvPairData: [
          { id: 'envPair_1', name: 'baseUrl', value: 'https://api.example.com', type: 'str', enabled: true },
          { id: 'envPair_2', name: 'API_KEY', value: ENCRYPTED.apiKey, type: 'secret', enabled: true },
          { id: 'envPair_3', name: 'TOKEN', value: ENCRYPTED.token, type: 'secret', enabled: true },
          { id: 'envPair_4', name: 'note', value: 'kept', type: 'str', enabled: true, isConfidential: true },
        ],
      }),
      doc('Environment', 'env_main_prod', 'env_main_base', {
        name: 'Prod',
        isPrivate: true,
        metaSortKey: 2,
        data: { host: 'prod.example.com', __insomnia_vault: { DB_PASSWORD: ENCRYPTED.dbPassword } },
        kvPairData: [
          { id: 'envPair_5', name: 'host', value: 'prod.example.com', type: 'str', enabled: true },
          { id: 'envPair_6', name: 'DB_PASSWORD', value: ENCRYPTED.dbPassword, type: 'secret', enabled: true },
        ],
      }),
      doc('Environment', 'env_main_dev', 'env_main_base', { name: 'Dev', metaSortKey: 3, data: { host: 'dev' } }),
      doc('Environment', 'env_globals_base', 'wrk_globals', { name: 'Base Environment', data: { shared: 'yes' } }),
      doc('Environment', 'env_main_dev', 'env_main_base', {
        name: 'Dev renamed',
        metaSortKey: 3,
        data: { host: 'dev' },
      }),
    ],

    CookieJar: [
      doc('CookieJar', 'jar_main', 'wrk_main', {
        name: 'Default Jar',
        cookies: [
          {
            id: 'cookie_1',
            key: 'session',
            value: 'abc',
            domain: 'example.com',
            path: '/',
            httpOnly: true,
            expires: new Date(T + 86_400_000),
            creation: new Date(T),
            lastAccessed: new Date(T),
          },
        ],
      }),
    ],

    RequestGroup: [
      doc('RequestGroup', 'fld_users', 'wrk_main', {
        name: 'Users',
        metaSortKey: 1,
        environment: { folderVar: 'x', __insomnia_vault: { FOLDER_SECRET: ENCRYPTED.folderSecret } },
        kvPairData: [
          { id: 'envPair_7', name: 'folderVar', value: 'x', type: 'str', enabled: true },
          { id: 'envPair_8', name: 'FOLDER_SECRET', value: ENCRYPTED.folderSecret, type: 'secret', enabled: true },
        ],
      }),
      doc('RequestGroup', 'fld_admin', 'fld_users', { name: 'Admin', metaSortKey: 2 }),
    ],
    RequestGroupMeta: [doc('RequestGroupMeta', 'fldm_users', 'fld_users', { collapsed: true })],

    Request: [
      doc('Request', 'req_get_users', 'fld_users', {
        name: 'Get users (old)',
        method: 'GET',
        url: '{{ _.baseUrl }}/users',
        metaSortKey: 1,
      }),
      doc('Request', 'req_create_user', 'fld_users', {
        name: 'Create user',
        method: 'POST',
        url: "{{ _.baseUrl }}/users?from={% response 'body', 'req_get_users', 'b64::JC5pZA==::46b', 'never', 60 %}",
        authentication: { type: 'basic', username: 'admin', password: READABLE.basicPassword },
        body: { mimeType: 'application/json', text: '{}' },
        metaSortKey: 2,
      }),
      doc('Request', 'req_admin', 'fld_admin', { name: 'Admin ping', method: 'GET', metaSortKey: 1 }),
      doc('Request', 'req_root', 'wrk_main', {
        name: 'Root',
        method: 'GET',
        url: 'https://example.com',
        metaSortKey: 3,
      }),
      doc('Request', 'req_gone', 'fld_users', { name: 'Gone', method: 'GET' }),
      {
        ...doc('Request', 'req_get_users', 'fld_users', {
          name: 'Get users',
          method: 'GET',
          url: '{{ _.baseUrl }}/users',
          metaSortKey: 1,
        }),
        modified: T + 1000,
      },
      deleted('req_gone'),
      doc('Request', 'req_team', 'wrk_team', { name: 'Team request', method: 'GET' }),
      doc('Request', 'req_in_git', 'wrk_git_a', { name: 'Git request', method: 'GET' }),
      doc('Request', 'req_scratch', 'wrk_scratchpad', { name: 'Scratch request', method: 'GET' }),
      doc('Request', 'req_under_orphan', 'wrk_orphan', { name: 'Under lost workspace', method: 'GET' }),
      doc('Request', 'req_lost', 'fld_missing', { name: 'Lost request', method: 'GET' }),
    ],
    RequestMeta: [doc('RequestMeta', 'reqm_get_users', 'req_get_users', { activeResponseId: 'res_1', pinned: true })],

    GrpcRequest: [
      doc('GrpcRequest', 'greq_users', 'wrk_main', {
        name: 'List users',
        url: 'localhost:50051',
        protoFileId: 'pf_users',
        protoMethodName: '/users.Users/List',
        metaSortKey: 4,
      }),
    ],
    GrpcRequestMeta: [doc('GrpcRequestMeta', 'greqm_users', 'greq_users', { pinned: true })],
    ProtoDirectory: [doc('ProtoDirectory', 'pd_root', 'wrk_main', { name: 'protos' })],
    ProtoFile: [doc('ProtoFile', 'pf_users', 'pd_root', { name: 'users.proto', protoText: 'syntax = "proto3";' })],

    WebSocketRequest: [
      doc('WebSocketRequest', 'ws-req_echo', 'wrk_main', { name: 'Echo', url: 'ws://localhost', metaSortKey: 5 }),
    ],
    WebSocketPayload: [doc('WebSocketPayload', 'ws-payload_hello', 'ws-req_echo', { name: 'Hello', value: 'hi' })],
    WebSocketRequestMeta: [doc('WebSocketRequestMeta', 'ws-req-meta_echo', 'ws-req_echo', { pinned: true })],

    SocketIORequest: [
      doc('SocketIORequest', 'socketio-req_chat', 'wrk_main', {
        name: 'Chat',
        url: 'http://localhost',
        metaSortKey: 6,
      }),
    ],
    SocketIOPayload: [doc('SocketIOPayload', 'socket-io-payload_hello', 'socketio-req_chat', { name: 'Hello' })],
    SocketIORequestMeta: [doc('SocketIORequestMeta', 'socketio-req-meta_chat', 'socketio-req_chat', { pinned: true })],

    McpRequest: [
      doc('McpRequest', 'mcp-req_tools', 'wrk_mcp', {
        name: 'Tools',
        transportType: 'stdio',
        url: 'node server.js',
        env: [
          { id: 'envPair_9', name: 'MODE', value: 'dev', type: 'str', enabled: true },
          { id: 'envPair_10', name: 'MCP_SECRET', value: ENCRYPTED.mcpSecret, type: 'secret', enabled: true },
        ],
      }),
    ],
    McpPayload: [doc('McpPayload', 'mcp-payload_1', 'mcp-req_tools', { url: 'tools/list', params: {} })],

    ApiSpec: [
      doc('ApiSpec', 'spc_petstore', 'wrk_design', {
        fileName: 'Petstore',
        contentType: 'yaml',
        contents: 'openapi: 3.0.0',
      }),
    ],

    MockServer: [
      doc('MockServer', 'mock_1', 'wrk_mock', {
        name: 'Mock',
        url: 'https://mock.example.com/bin/abc',
        useInsomniaCloud: true,
      }),
    ],
    MockRoute: [doc('MockRoute', 'mock-route_1', 'mock_1', { name: '/pets', body: '[]', statusCode: 200 })],

    UnitTestSuite: [doc('UnitTestSuite', 'uts_main', 'wrk_main', { name: 'Smoke', metaSortKey: 1 })],
    UnitTest: [
      doc('UnitTest', 'ut_one', 'uts_main', {
        name: 'Works',
        requestId: 'req_get_users',
        code: 'expect(1).to.equal(1)',
        metaSortKey: 1,
      }),
    ],

    ClientCertificate: [
      doc('ClientCertificate', 'crt_client_ok', 'wrk_main', {
        host: 'ok.example.com',
        cert: certs('client.pem'),
        key: certs('client.key'),
        pfx: null,
        passphrase: READABLE.certPassphrase,
      }),
      doc('ClientCertificate', 'crt_client_missing', 'wrk_main', {
        host: 'missing.example.com',
        cert: certs('gone.pem'),
        key: certs('gone.key'),
        pfx: null,
        passphrase: null,
      }),
    ],
    CaCertificate: [
      doc('CaCertificate', 'crt_ca_ok', 'wrk_main', { path: certs('ca.pem') }),
      doc('CaCertificate', 'crt_ca_missing', 'wrk_main', { path: certs('gone-ca.pem') }),
    ],

    OAuth2Token: [
      doc('OAuth2Token', 'oa2_users', 'req_get_users', {
        accessToken: READABLE.oauthAccess,
        refreshToken: READABLE.oauthRefresh,
      }),
      doc('OAuth2Token', 'oa2_in_git', 'req_in_git', {
        accessToken: READABLE.oauthAccess,
        refreshToken: READABLE.oauthRefresh,
      }),
    ],
    GitCredentials: [
      doc('GitCredentials', 'git_creds_1', null, { name: 'Work GitHub', provider: 'github', token: READABLE.gitToken }),
    ],
    CloudCredential: [
      doc('CloudCredential', 'cloudCred_1', null, { name: 'AWS dev', provider: 'aws', credentials: {} }),
    ],

    PluginData: [doc('PluginData', 'plg_1', null, { plugin: 'insomnia-plugin-faker', key: 'seed', value: '42' })],

    // Skipped without an entry per item
    Settings: [doc('Settings', 'set_1', null, { theme: 'default', httpProxy: 'http://proxy.invalid:3128' })],
    Stats: [doc('Stats', 'sta_1', null, { launches: 7 })],
    UserSession: [doc('UserSession', 'usr_1', null, { accountId: 'acct_1', vaultKey: READABLE.vaultKey })],
    Response: [doc('Response', 'res_1', 'req_get_users', { statusCode: 200, bodyPath: '' })],
    RequestVersion: [doc('RequestVersion', 'rvr_1', 'req_get_users', { name: 'old' })],
    UnitTestResult: [doc('UnitTestResult', 'utr_1', 'uts_main', { results: {} })],
    RunnerTestResult: [doc('RunnerTestResult', 'rtr_1', 'wrk_main', {})],
    WebSocketResponse: [doc('WebSocketResponse', 'ws-res_1', 'ws-req_echo', {})],

    // A type this version of restless does not have
    FutureThing: [
      doc('FutureThing', 'ft_1', 'wrk_main', {}),
      doc('FutureThing', 'ft_2', 'wrk_main', {}),
      deleted('ft_2'),
    ],
  };
}

// The files a data folder holds besides the logs
function buildFiles(): Record<string, string> {
  return {
    'certs/client.pem': 'pem',
    'certs/client.key': 'key',
    'certs/ca.pem': 'pem',
    'plugins/insomnia-plugin-faker/package.json': JSON.stringify({
      name: 'insomnia-plugin-faker',
      version: '1.0.0',
      insomnia: { name: 'faker' },
    }),
    'plugins/@acme/insomnia-plugin-acme/package.json': JSON.stringify({
      name: '@acme/insomnia-plugin-acme',
      version: '2.1.0',
      insomnia: { name: 'acme' },
    }),
    // Not plugins: no `insomnia` key, no package.json, a file, and a folder that is only a leftover
    'plugins/not-a-plugin/package.json': JSON.stringify({ name: 'not-a-plugin', version: '1.0.0' }),
    'plugins/empty-folder/readme.txt': 'nothing here',
    'plugins/notes.txt': 'a file in the plugins folder',
    'plugins/insomnia-plugin-broken/package.json': '{ not json',
    'plugins/broken-and-unnamed/package.json': '{ not json',
    // Things a real folder holds that are not data
    'logs/main.log': 'log',
    'Preferences': '{}',
  };
}

export function writeFixture(dir: string, options: FixtureOptions = {}) {
  mkdirSync(dir, { recursive: true });
  for (const [type, entries] of Object.entries(buildLogs(dir))) {
    writeLog(dir, type, entries, type === 'Request' && options.tornTail ? TORN_TAIL : '');
  }
  for (const [relative, content] of Object.entries(buildFiles())) {
    writeFile(dir, relative, content);
  }
  setTimes(dir);
}

if (typeof require !== 'undefined' && require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: esr make-fixture.ts <folder>');
    process.exit(1);
  }
  writeFixture(path.resolve(target));
  console.log(`Wrote a fake Insomnia data folder to ${path.resolve(target)}`);
}
