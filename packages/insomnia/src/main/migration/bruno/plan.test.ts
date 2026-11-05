import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { database, models, services } from 'insomnia-data';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { MigrationPlan, PlanItem } from '../types';
import { planBruno } from './plan';
import { BRU_COLLECTION, FIXTURES, hashDirectory, nedbKeyProblems, undefinedPaths, YML_COLLECTION } from './test-utils';

const sha1 = (value: string) => createHash('sha1').update(value).digest('hex');

let plans: MigrationPlan[];
let bru: MigrationPlan;
let yml: MigrationPlan;
let ymlOAuth: MigrationPlan;
let hashBefore: string;

beforeAll(async () => {
  hashBefore = hashDirectory(FIXTURES);
  plans = await planBruno(FIXTURES);
  [bru, yml, ymlOAuth] = plans;
});

const item = (plan: MigrationPlan, type: string, name: string): PlanItem => {
  const found = plan.items.find(candidate => candidate.type === type && candidate.name === name);
  if (!found) {
    throw new Error(`No ${type} named ${name}`);
  }
  return found;
};
const doc = (plan: MigrationPlan, type: string, name: string): Record<string, any> => item(plan, type, name).doc;
const request = (plan: MigrationPlan, name: string) => doc(plan, 'Request', name);
const issues = (plan: MigrationPlan, reason: string, name?: string) =>
  plan.issues.filter(issue => issue.reason === reason && (name === undefined || issue.name === name));

const temporaryFolders: string[] = [];
afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
function makeCollection(files: Record<string, string>) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-plan-'));
  temporaryFolders.push(folder);
  fs.writeFileSync(path.join(folder, 'bruno.json'), '{"name":"temp"}');
  for (const [relativePath, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(folder, relativePath)), { recursive: true });
    fs.writeFileSync(path.join(folder, relativePath), content);
  }
  return folder;
}
const requestFile = (name: string, method: string, block: string, rest = '') =>
  `meta {\n  name: ${name}\n  type: http\n  seq: 1\n}\n\n${method} {\n  url: http://x\n  body: none\n  auth: none\n${block}}\n\n${rest}`;

describe('the plan of a folder', () => {
  it('has one plan for each collection, sorted by path', () => {
    expect(plans.map(plan => path.basename(plan.source.path))).toEqual([
      'bru-collection',
      'yml-collection',
      'yml-oauth-collection',
    ]);
  });

  it('describes the source', () => {
    expect(bru.source).toEqual({
      id: `bruno:${fs.realpathSync(BRU_COLLECTION)}`,
      kind: 'bruno',
      path: fs.realpathSync(BRU_COLLECTION),
      counts: { projects: 1, collections: 1, requests: 25, environments: 4 },
      running: false,
    });
    expect(plans.map(plan => plan.plugins)).toEqual([[], [], []]);
  });

  it('plans one collection when pointed at it, and nothing when there is none', async () => {
    expect((await planBruno(YML_COLLECTION)).map(plan => path.basename(plan.source.path))).toEqual(['yml-collection']);
    const empty = makeCollection({});
    fs.rmSync(path.join(empty, 'bruno.json'));
    expect(await planBruno(empty)).toEqual([]);
  });

  it('refuses a path that is not a folder', async () => {
    await expect(planBruno(path.join(BRU_COLLECTION, 'bruno.json'))).rejects.toThrow('is not a folder');
    await expect(planBruno(path.join(BRU_COLLECTION, 'nope'))).rejects.toThrow();
  });
});

describe('order and IDs', () => {
  it('puts parents before children', () => {
    for (const plan of plans) {
      const position = new Map(plan.items.map((candidate, index) => [candidate.doc._id as string, index]));
      plan.items.forEach((candidate, index) => {
        const parent = position.get(candidate.doc.parentId as string);
        if (candidate.type === 'Project') {
          expect(parent).toBeUndefined();
        } else {
          expect(parent, `${candidate.type} ${candidate.name}`).toBeDefined();
          expect(parent!, `${candidate.type} ${candidate.name}`).toBeLessThan(index);
        }
      });
    }
  });

  it('starts with the project and the workspace, then the cookie jar and the environments, then folders, then requests', () => {
    for (const plan of plans) {
      const types = plan.items.map(candidate => candidate.type);
      expect(types.slice(0, 4)).toEqual(['Project', 'Workspace', 'CookieJar', 'Environment']);
      const lastEnvironment = types.lastIndexOf('Environment');
      const firstFolder = types.indexOf('RequestGroup');
      const lastFolder = types.lastIndexOf('RequestGroup');
      const firstRequest = types.findIndex(type => ['Request', 'GrpcRequest', 'WebSocketRequest'].includes(type));
      expect(lastEnvironment).toBeLessThan(firstFolder === -1 ? firstRequest : firstFolder);
      if (firstFolder !== -1) {
        expect(lastFolder).toBeLessThan(firstRequest);
      }
    }
  });

  it('gives every document the ID prefix of its model, and no two the same ID', () => {
    const ids = plans.flatMap(plan => plan.items.map(candidate => candidate.doc._id as string));
    expect(new Set(ids).size).toBe(ids.length);
    for (const candidate of plans.flatMap(plan => plan.items)) {
      expect(candidate.doc._id).toMatch(new RegExp(`^${models.getModel(candidate.type)!.prefix}_[0-9a-f]{40}$`));
      expect(candidate.doc.type).toBe(candidate.type);
      expect(candidate.doc.name).toBe(candidate.name);
    }
  });

  it('gives the same plan on every run', async () => {
    expect(JSON.stringify(await planBruno(FIXTURES))).toBe(JSON.stringify(plans));
  });

  it('gives the base environment and the cookie jar the IDs the app gives them', () => {
    for (const plan of plans) {
      const workspaceId = plan.items[1].doc._id as string;
      expect(plan.items[2].doc._id).toBe(`jar_${sha1(workspaceId)}`);
      expect(plan.items[3].doc._id).toBe(`env_${sha1(workspaceId)}`);
      expect(plan.items[3].doc.parentId).toBe(workspaceId);
    }
  });

  it('keeps the plan plain data, which is what crosses IPC: nothing undefined, nothing that cannot be cloned', () => {
    for (const candidate of plans.flatMap(plan => plan.items)) {
      expect(() => structuredClone(candidate)).not.toThrow();
      expect(undefinedPaths(candidate), `${candidate.type} ${candidate.name}`).toEqual([]);
    }
  });
});

describe('the project and the workspace', () => {
  it('creates a local project named after the collection', () => {
    expect(bru.items[0].doc).toEqual({
      _id: expect.stringMatching(/^proj_/),
      type: 'Project',
      parentId: 'org_local',
      name: 'bruno-testbench',
      remoteId: null,
      gitRepositoryId: null,
      mcpStdioAccess: false,
    });
  });

  it('creates a collection workspace in it, holding the docs of the collection', () => {
    expect(bru.items[1].doc).toMatchObject({
      type: 'Workspace',
      parentId: bru.items[0].doc._id,
      name: 'bruno-testbench',
      scope: 'collection',
    });
    expect(bru.items[1].doc.description).toContain('This is a test collection');
    expect(yml.items[1].doc.name).toBe('bruno-yml-testbench');
  });
});

describe('collection settings', () => {
  it('puts them in a folder around everything, which restless inherits from', () => {
    const wrapper = doc(bru, 'RequestGroup', 'bruno-testbench');
    expect(wrapper.parentId).toBe(bru.items[1].doc._id);
    expect(wrapper.headers).toEqual([
      { name: 'check', value: 'again', description: 'asd' },
      { name: 'token', value: '{{ _.collection_pre_var_token }}', description: expect.stringContaining('asd') },
      { name: 'collection-header', value: 'collection-header-value', description: 'asd' },
    ]);
    expect(wrapper.authentication).toEqual({ type: 'bearer', token: '{{ _.bearer_auth_token }}' });
    expect(wrapper.preRequestScript).toContain("insomnia.variables.get('should-test-collection-scripts')");
    expect(wrapper.preRequestScript).toContain("insomnia.environment.set('collection-var-set-by-collection-script'");
    expect(wrapper.afterResponseScript).toContain('insomnia.test("collection level test');
    expect(`${wrapper.preRequestScript}${wrapper.afterResponseScript}`).not.toMatch(/\bbru\./);
    // The first folder in the plan, and every top-level item is below it
    expect(bru.items.find(candidate => candidate.type === 'RequestGroup')).toBe(
      item(bru, 'RequestGroup', 'bruno-testbench'),
    );
    expect(doc(bru, 'RequestGroup', 'asserts').parentId).toBe(wrapper._id);
    expect(request(bru, 'ping').parentId).toBe(wrapper._id);
  });

  it('puts the collection variables in the base environment, below the selected environment as in Bruno', () => {
    const base = bru.items[3].doc as Record<string, any>;
    expect(base.name).toBe('Base Environment');
    expect(base.environmentType).toBe('kv');
    expect(base.data).toEqual({
      'collection_pre_var': 'collection_pre_var_value',
      'collection_pre_var_token': '{{ _.request_pre_var_token }}',
      'collection-var': 'collection-var-value',
      'coll_str': 'collection_string',
      'coll_num': 100,
      'coll_bool': false,
      'coll_obj': { scope: 'collection' },
    });
    expect(base.kvPairData.map((row: any) => [row.name, row.type, row.value])).toEqual([
      ['collection_pre_var', 'str', 'collection_pre_var_value'],
      ['collection_pre_var_token', 'str', '{{ _.request_pre_var_token }}'],
      ['collection-var', 'str', 'collection-var-value'],
      ['coll_str', 'str', 'collection_string'],
      ['coll_num', 'json', '100'],
      ['coll_bool', 'json', 'false'],
      ['coll_obj', 'json', '{"scope":"collection"}'],
    ]);
  });

  it('adds no folder when the collection has no settings of its own', () => {
    expect(
      yml.items.some(candidate => candidate.name === 'bruno-yml-testbench' && candidate.type === 'RequestGroup'),
    ).toBe(false);
    expect(doc(yml, 'RequestGroup', 'response-time').parentId).toBe(yml.items[1].doc._id);
    expect(yml.items[3].doc.data).toEqual({
      coll_str: 'collection_string',
      coll_num: 100,
      coll_bool: false,
      coll_obj: { scope: 'collection' },
    });
  });

  it('reads a collection whose root file holds OAuth 2', () => {
    const wrapper = doc(ymlOAuth, 'RequestGroup', 'inherited-auth-collection');
    expect(wrapper.authentication).toEqual({
      type: 'oauth2',
      grantType: 'authorization_code',
      authorizationUrl: 'http://localhost:8081/authorize',
      accessTokenUrl: 'http://localhost:8081/token',
      redirectUrl: 'http://localhost:8081/callback',
      clientId: 'inherited-client-id',
      clientSecret: 'inherited-client-secret',
      credentialsInBody: true,
    });
    expect(issues(ymlOAuth, 'not-supported')).toEqual([
      {
        reason: 'not-supported',
        type: 'RequestGroup',
        name: 'inherited-auth-collection',
        detail: 'OAuth 2 additional parameters are not supported',
      },
    ]);
    // A request inheriting from it has no authentication of its own
    expect(request(ymlOAuth, 'inherited-request').authentication).toEqual({});
  });
});

describe('folders', () => {
  it('maps the headers, scripts and tests of a folder, and the docs', () => {
    const folder = doc(bru, 'RequestGroup', 'js');
    expect(folder.headers).toEqual([{ name: 'folder-header', value: 'folder-header-value' }]);
    expect(folder.preRequestScript).toContain("insomnia.variables.get('should-test-folder-scripts')");
    expect(folder.afterResponseScript).toContain('insomnia.test("folder level test');
    expect(folder.environment).toEqual({});
  });

  it('leaves a folder that adds nothing without headers, authentication or scripts', () => {
    for (const name of ['digest', 'request-setting']) {
      const folder = doc(bru, 'RequestGroup', name);
      expect(Object.keys(folder)).not.toEqual(expect.arrayContaining(['authentication']));
      expect(folder.headers).toBeUndefined();
      expect(folder.preRequestScript).toBeUndefined();
    }
  });

  it('writes the variables of a folder as insomnia.variables.set lines, with their types', () => {
    expect(doc(yml, 'RequestGroup', 'variable-datatypes').preRequestScript).toBe(
      [
        'insomnia.variables.set("fold_str", "folder_string");',
        'insomnia.variables.set("fold_num", 200);',
        'insomnia.variables.set("fold_bool", true);',
        'insomnia.variables.set("fold_obj", {"scope":"folder"});',
      ].join('\n'),
    );
  });

  it('maps the authentication of a folder', () => {
    expect(doc(yml, 'RequestGroup', 'oauth2-folder').authentication).toEqual({
      type: 'oauth2',
      grantType: 'client_credentials',
      accessTokenUrl: 'http://localhost:8081/api/auth/oauth2/client_credentials/token',
      clientId: 'client_id_1',
      clientSecret: 'client_secret_1',
      scope: 'admin',
      credentialsInBody: true,
    });
    expect(doc(yml, 'RequestGroup', 'oauth1-folder').authentication).toEqual({
      type: 'oauth1',
      signatureMethod: 'HMAC-SHA1',
      consumerKey: 'consumer_key_1',
      consumerSecret: 'consumer_secret_1',
      tokenKey: 'access_token_1',
      tokenSecret: 'token_secret_1',
      version: '1.0',
    });
  });

  it('keeps folders ahead of requests, and requests in the order of their seq', () => {
    for (const plan of plans) {
      const byParent = new Map<string, PlanItem[]>();
      for (const candidate of plan.items) {
        if (['RequestGroup', 'Request', 'GrpcRequest', 'WebSocketRequest'].includes(candidate.type)) {
          const parent = candidate.doc.parentId as string;
          byParent.set(parent, [...(byParent.get(parent) ?? []), candidate]);
        }
      }
      for (const children of byParent.values()) {
        const keys = children.map(child => child.doc.metaSortKey as number);
        expect(new Set(keys).size).toBe(keys.length);
        const sorted = [...children].sort((a, b) => (a.doc.metaSortKey as number) - (b.doc.metaSortKey as number));
        const firstRequest = sorted.findIndex(child => child.type !== 'RequestGroup');
        if (firstRequest !== -1) {
          expect(sorted.slice(firstRequest).every(child => child.type !== 'RequestGroup')).toBe(true);
        }
      }
    }
    const echo = bru.items
      .filter(candidate => candidate.doc.parentId === doc(bru, 'RequestGroup', 'echo')._id)
      .sort((a, b) => (a.doc.metaSortKey as number) - (b.doc.metaSortKey as number))
      .map(candidate => candidate.name);
    // seq 3, 5, 8, 9 in the files
    expect(echo).toEqual(['echo plaintext', 'echo xml raw', 'echo multipart', 'echo form-url-encoded']);
  });
});

describe('HTTP requests', () => {
  it('maps the method, the URL with {{var}} converted, and the authentication', () => {
    expect(request(bru, 'ping')).toMatchObject({
      method: 'GET',
      url: '{{ _.host }}/ping',
      authentication: { type: 'none' },
      headers: [],
      body: {},
      parameters: [],
      description: '',
    });
  });

  it('maps every authentication mode that restless has, and inheritance', () => {
    expect(request(bru, 'Digest Auth 200').authentication).toEqual({
      type: 'digest',
      username: 'admin',
      password: 'password',
    });
    expect(request(bru, 'Bearer Auth 200').authentication).toEqual({
      type: 'bearer',
      token: '{{ _.bearer_auth_token }}',
    });
    // Bruno inherit is "no authentication set" here, which restless reads as inherit
    expect(request(bru, 'inherit Bearer Auth 200').authentication).toEqual({});
    expect(request(yml, 'api').authentication).toEqual({ type: 'ntlm', username: 'ntlmtest', password: 'Br!unoNtlm' });
    expect(request(yml, 'oauth2-request').authentication).toEqual({});
  });

  it('reports an authentication mode restless does not have, and sends the request without it', () => {
    expect(request(yml, 'EdgeGrid GET 200').authentication).toEqual({ type: 'none' });
    expect(issues(yml, 'not-supported', 'EdgeGrid GET 200')).toEqual([
      {
        reason: 'not-supported',
        type: 'Request',
        name: 'EdgeGrid GET 200',
        detail: 'Authentication mode "akamai-edgegrid" is not supported, the request is sent without it',
      },
    ]);
  });

  it('moves the query out of the URL into the parameters', () => {
    const delayed = request(bru, 'delayed body');
    expect(delayed.url).toBe('{{ _.localhost }}/api/wait-for/body');
    expect(delayed.parameters).toEqual([{ name: 'time', value: '1000' }]);
    expect(request(yml, 'delayed body')).toMatchObject({
      url: '{{ _.localhost }}/api/wait-for/body',
      parameters: [{ name: 'time', value: '1000' }],
    });
  });

  it('maps path parameters', () => {
    expect(request(bru, 'getPathParam')).toMatchObject({
      url: '{{ _.host }}/:pathParam',
      pathParameters: [{ name: 'pathParam', value: 'ping' }],
    });
  });

  it('maps a JSON body and adds the Content-Type it implies', () => {
    const typed = request(yml, 'typed vars');
    expect(typed.body.mimeType).toBe('application/json');
    expect(typed.body.text).toContain('"coll_num": {{ _.coll_num }},');
    expect(typed.headers[0]).toEqual({ name: 'Content-Type', value: 'application/json' });
    expect(typed.headers.map((header: any) => header.name)).toEqual([
      'Content-Type',
      'x-h-str',
      'x-h-num',
      'x-h-bool',
      'x-h-obj',
    ]);
  });

  it.each([
    ['echo xml raw', 'application/xml', '<hello><world>bruno</world></hello>'],
    ['echo plaintext', 'text/plain', 'hello'],
  ])('maps the %s body', (name, mimeType, text) => {
    expect(request(bru, name)).toMatchObject({
      body: { mimeType, text },
      headers: [{ name: 'Content-Type', value: mimeType }],
    });
  });

  it('keeps a Content-Type the request set itself', () => {
    const form = request(bru, 'echo form-url-encoded');
    expect(form.headers).toEqual([{ name: 'Content-Type', value: 'application/x-www-form-urlencoded; charset=UTF-8' }]);
    expect(form.body.mimeType).toBe('application/x-www-form-urlencoded');
    expect(form.body.params.map((param: any) => `${param.name}=${param.value}`)).toEqual([
      "form-data-key={{ _['form-data-key'] }}",
      "form-data-stringified-object={{ _['form-data-stringified-object'] }}",
      'key_1=value_1',
      'key_2=value_2',
      'key_1=value_3',
      'key_2=value_4',
    ]);
  });

  it('maps a multipart body, with a file part as an absolute path, and reports what it cannot keep', () => {
    const multipart = request(bru, 'echo multipart');
    expect(multipart.body.mimeType).toBe('multipart/form-data');
    expect(multipart.headers).toEqual([{ name: 'Content-Type', value: 'multipart/form-data' }]);
    expect(multipart.body.params).toEqual([
      { name: 'foo', type: 'text', value: '{"bar":"baz"}' },
      { name: 'multiline', type: 'text', value: '"multiline-test"' },
      { name: 'form-data-key', type: 'text', value: "{{ _['form-data-key'] }}" },
      { name: 'form-data-stringified-object', type: 'text', value: "{{ _['form-data-stringified-object'] }}" },
      { name: 'file', type: 'file', value: '', fileName: path.join(fs.realpathSync(BRU_COLLECTION), 'bruno.png') },
    ]);
    expect(issues(bru, 'file-missing', 'echo multipart')).toEqual([
      { reason: 'file-missing', type: 'Request', name: 'echo multipart', detail: 'bruno.png' },
    ]);
    expect(issues(bru, 'not-supported', 'echo multipart')).toEqual([
      {
        reason: 'not-supported',
        type: 'Request',
        name: 'echo multipart',
        detail: 'The content type of 2 multipart field(s) is not supported',
      },
    ]);
  });

  it('maps a file body to the file, with the content type Bruno names', () => {
    const upload = request(bru, 'binary upload json');
    expect(upload.body).toEqual({
      mimeType: 'application/octet-stream',
      fileName: path.join(fs.realpathSync(BRU_COLLECTION), 'file.json'),
    });
    expect(upload.headers).toEqual([{ name: 'Content-Type', value: 'application/json' }]);
    expect(issues(bru, 'file-missing', 'binary upload json')).toEqual([]);
  });

  it('maps a GraphQL request', () => {
    const query = request(bru, 'spacex');
    expect(query.method).toBe('POST');
    expect(query.body.mimeType).toBe('application/graphql');
    expect(JSON.parse(query.body.text).query).toContain('ceo');
    expect(query.headers).toEqual([{ name: 'Content-Type', value: 'application/json' }]);
    // Variables go in as written, with {{var}} converted
    expect(request(bru, 'variables interpolation').body.text).toBe(
      '{"query":"query { __typename }","variables":{\n  "my_json": "{{ _.my_json }}"\n}}',
    );
  });

  it('maps request settings: redirects off and URL encoding', () => {
    expect(request(bru, 'follow-redirect')).toMatchObject({ settingEncodeUrl: true, settingFollowRedirects: 'off' });
    expect(request(bru, 'ping').settingFollowRedirects).toBeUndefined();
  });

  it('maps docs to the description', () => {
    expect(request(bru, 'ping').description).toBe('');
  });
});

describe('scripts', () => {
  it('writes pre-request variables ahead of the script, in the order of Bruno', () => {
    const typed = request(yml, 'typed vars');
    const lines = typed.preRequestScript.split('\n');
    expect(lines.slice(0, 7)).toEqual([
      'insomnia.variables.set("req_str", "request_string");',
      'insomnia.variables.set("req_num", 42);',
      'insomnia.variables.set("req_bool", true);',
      'insomnia.variables.set("req_obj", {"key":"value"});',
      expect.stringMatching(/^insomnia\.variables\.set\("req_obj_precision", \{"integer":123,/),
      'insomnia.variables.set("req_obj_empty", {});',
      'insomnia.variables.set("mismatched_num", "not-a-number");',
    ]);
    // then the script itself
    expect(typed.preRequestScript).toContain('insomnia.environment.set("runtime_str", "runtime_string");');
  });

  it('writes post-response scripts, assertions and tests into the after-response script, in that order', () => {
    const script: string = request(bru, 'follow-redirect').afterResponseScript;
    expect(script).toContain('insomnia.test("body should include redirecting"');
    expect(script).toContain('insomnia.expect(data).to.include("Redirecting...");');
    expect(script).toContain('const data = insomnia.response.json();');
    const withAssertions: string = request(bru, 'setHeader').afterResponseScript;
    expect(withAssertions.indexOf('insomnia.test("res.status: eq 200"')).toBeLessThan(
      withAssertions.indexOf('insomnia.test("req.setHeader(name)"'),
    );
  });

  it('turns assertions into insomnia.test lines', () => {
    const script: string = request(bru, 'Digest Auth 200').afterResponseScript;
    expect(script).toBe(
      [
        'insomnia.test("res.status: eq 200", () => { insomnia.expect(insomnia.response.code).to.equal(200); });',
        'insomnia.test("res.body.authenticated: isTruthy", () => { insomnia.expect(insomnia.response.json().authenticated).to.be.true; });',
      ].join('\n'),
    );
    expect((request(bru, 'test-assert-combinations').afterResponseScript.match(/insomnia\.test\(/g) ?? []).length).toBe(
      28,
    );
  });

  it('translates a script fully, without a report, when it only uses what restless has', () => {
    expect(request(bru, 'setVar').afterResponseScript).toContain(
      'insomnia.environment.set("testSetVar", "bruno-test-87267")',
    );
    expect(request(bru, 'setVar').afterResponseScript).toContain(
      'const testSetVar = insomnia.variables.get("testSetVar");',
    );
    expect(request(bru, 'getStatus').afterResponseScript).toContain('const status = insomnia.response.code');
    expect(request(bru, 'setHeader').preRequestScript).toBe(
      "insomnia.request.upsertHeader({ key: 'bruno', value: 'is-the-future' });",
    );
    for (const name of [
      'setVar',
      'getStatus',
      'setHeader',
      'Bearer Auth 200',
      'follow-redirect',
      'variables interpolation',
    ]) {
      expect(issues(bru, 'script-partly-translated', name)).toEqual([]);
    }
    expect(issues(yml, 'script-partly-translated', 'typed vars')).toEqual([]);
  });

  it('comments the original out and reports a script that is only partly translated', () => {
    const run = request(bru, 'runRequest');
    expect(run.preRequestScript.startsWith('// restless: this Bruno script was only partly translated.')).toBe(true);
    expect(run.preRequestScript).toContain("// let pingRes = await bru.runRequest('ping');");
    expect(issues(bru, 'script-partly-translated', 'runRequest')).toEqual([
      {
        reason: 'script-partly-translated',
        type: 'Request',
        name: 'runRequest',
        detail: 'pre-request script: bru.runRequest; post-response script: bru.runRequest; tests: bru.runRequest',
      },
    ]);
    expect(issues(bru, 'script-partly-translated', 'Basic Auth 200')).toEqual([
      {
        reason: 'script-partly-translated',
        type: 'Request',
        name: 'Basic Auth 200',
        detail: 'pre-request script: require()',
      },
    ]);
    expect(issues(bru, 'script-partly-translated', 'ping')[0].detail).toBe(
      'pre-request script: bru.runner.stopExecution',
    );
  });

  it('never leaves a script that looks translated and is not', () => {
    for (const candidate of bru.items.filter(entry => entry.type === 'Request')) {
      for (const field of ['preRequestScript', 'afterResponseScript']) {
        const script = candidate.doc[field] as string | undefined;
        if (script === undefined) {
          continue;
        }
        const code = script.replace(/^\/\/.*$/gm, '');
        const hasBruno = /(?<![\w$.])(?:bru|req|res)\.[A-Za-z_$]|require\s*\(/.test(code.replace(/(["'`]).*?\1/g, ''));
        const reported = issues(bru, 'script-partly-translated', candidate.name).length > 0;
        expect(hasBruno && !reported, `${candidate.name} ${field}`).toBe(false);
      }
    }
  });

  it('reports an assertion it cannot turn into a test, without its value', async () => {
    const folder = makeCollection({
      'a.bru': requestFile(
        'odd assertions',
        'get',
        '',
        'assert {\n  res("data.id"): eq SECRET-VALUE\n  res.status: eq 200\n}\n',
      ),
    });
    const [plan] = await planBruno(folder);
    expect(plan.issues).toEqual([
      {
        reason: 'not-supported',
        type: 'Request',
        name: 'odd assertions',
        detail: 'Assertion "res("data.id")" uses res(), so it was not imported',
      },
    ]);
    expect(JSON.stringify(plan.issues)).not.toContain('SECRET-VALUE');
    expect(request(plan, 'odd assertions').afterResponseScript).toBe(
      'insomnia.test("res.status: eq 200", () => { insomnia.expect(insomnia.response.code).to.equal(200); });',
    );
  });

  it('reads a first word that is no operator the way Bruno does: as eq against the whole text', async () => {
    const folder = makeCollection({
      'a.bru': requestFile('plain text', 'get', '', 'assert {\n  res.body.message: Authentication successful\n}\n'),
    });
    expect(request((await planBruno(folder))[0], 'plain text').afterResponseScript).toContain(
      '.to.equal("Authentication successful");',
    );
  });

  it('reports an operator that only a YAML file can name, since there the operator is its own field', async () => {
    const folder = makeCollection({
      'opencollection.yml': 'opencollection: 1.0.0\ninfo:\n  name: yaml operator\n',
      'a.yml': [
        'info:',
        '  name: odd operator',
        '  type: http',
        'http:',
        '  method: GET',
        '  url: http://x',
        'runtime:',
        '  assertions:',
        '    - expression: res.status',
        '    - operator: approximately',
        '      expression: res.status',
        '      value: "200"',
        '',
      ].join('\n'),
    });
    const [plan] = await planBruno(folder);
    expect(plan.issues).toEqual([
      {
        reason: 'not-supported',
        type: 'Request',
        name: 'odd operator',
        detail: 'Assertion "res.status" operator "approximately" has no equivalent, so it was not imported',
      },
    ]);
    // An assertion with no operator is eq with no value, which is what Bruno reads it as
    expect(request(plan, 'odd operator').afterResponseScript).toContain('insomnia.test("res.status: eq"');
  });
});

describe('gRPC and WebSocket requests', () => {
  it('maps a gRPC request', () => {
    expect(doc(bru, 'GrpcRequest', 'SayHello')).toMatchObject({
      url: '{{ _.host }}',
      protoMethodName: '/hello.HelloService/SayHello',
      body: { text: '{\n  "greeting": "amoveo"\n}' },
      metadata: [],
    });
    expect(doc(yml, 'GrpcRequest', 'MessageHooksUnary')).toMatchObject({
      metadata: [{ name: 'x-keep', value: 'kept-value' }],
      body: { text: '{\n  "greeting": "{{ _.unaryGreeting }}"\n}' },
    });
  });

  it('keeps the first message of a gRPC request and reports the others', () => {
    expect(doc(bru, 'GrpcRequest', 'BidiHello').body.text).toContain('cuius');
    expect(issues(bru, 'not-supported', 'BidiHello')).toEqual([
      {
        reason: 'not-supported',
        type: 'GrpcRequest',
        name: 'BidiHello',
        detail: 'restless sends one message, so the other 1 were not imported',
      },
    ]);
  });

  it('reports the lifecycle hooks, which restless has no place for', () => {
    expect(issues(yml, 'not-supported', 'MessageHooksUnary')).toEqual([
      {
        reason: 'not-supported',
        type: 'GrpcRequest',
        name: 'MessageHooksUnary',
        detail:
          'gRPC requests do not support hooks (before-call-start, before-message-send, after-message-receive, after-call-end). They were not imported.',
      },
    ]);
  });

  it('brings the proto file along and links it', () => {
    const proto = item(yml, 'ProtoFile', 'hello.proto');
    expect(proto.doc).toMatchObject({
      parentId: yml.items[1].doc._id,
      protoText: fs.readFileSync(path.join(YML_COLLECTION, 'protos/hello.proto'), 'utf8'),
    });
    expect(doc(yml, 'GrpcRequest', 'WithProto').protoFileId).toBe(proto.doc._id);
    expect(yml.items.indexOf(proto)).toBeLessThan(yml.items.indexOf(item(yml, 'GrpcRequest', 'WithProto')));
  });

  it('reports a proto file that is not there', () => {
    expect(doc(bru, 'GrpcRequest', 'MissingProto').protoFileId).toBeUndefined();
    expect(issues(bru, 'file-missing', 'MissingProto')).toEqual([
      { reason: 'file-missing', type: 'GrpcRequest', name: 'MissingProto', detail: 'protos/not-there.proto' },
    ]);
  });

  it('maps a WebSocket request and its message', () => {
    const socket = doc(bru, 'WebSocketRequest', 'ws-multi-msg');
    expect(socket).toMatchObject({
      url: 'ws://localhost:8081/ws/echo',
      authentication: {},
      headers: [],
      parameters: [],
    });
    const payload = doc(bru, 'WebSocketPayload', 'message 1');
    expect(payload).toMatchObject({
      parentId: socket._id,
      mode: 'application/json',
      value: '{\n  "action": "subscribe"\n}',
    });
    expect(bru.items.indexOf(item(bru, 'WebSocketPayload', 'message 1'))).toBe(
      bru.items.indexOf(item(bru, 'WebSocketRequest', 'ws-multi-msg')) + 1,
    );
    expect(issues(bru, 'not-supported', 'ws-multi-msg')).toEqual([
      {
        reason: 'not-supported',
        type: 'WebSocketRequest',
        name: 'ws-multi-msg',
        detail: 'restless keeps one message, so the other 1 were not imported',
      },
    ]);
  });
});

describe('environments', () => {
  it('creates a sub environment for each file, under the base environment', () => {
    const environments = bru.items.filter(candidate => candidate.type === 'Environment');
    expect(environments.map(candidate => candidate.name)).toEqual(['Base Environment', 'base', 'dev', 'Local', 'Prod']);
    for (const environment of environments.slice(1)) {
      expect(environment.doc.parentId).toBe(bru.items[3].doc._id);
      expect(environment.doc.environmentType).toBe('kv');
    }
    expect(yml.items.filter(candidate => candidate.type === 'Environment').map(candidate => candidate.name)).toEqual([
      'Base Environment',
      'base',
      'dev',
      'Local',
      'Prod',
      'Secrets',
    ]);
  });

  it('keeps values, with typed variables as typed data', () => {
    const local = doc(bru, 'Environment', 'Local');
    expect(local.data).toMatchObject({
      'host': 'http://localhost:8080',
      'env-var2': 'envVar2',
      'typed_env_num': 300,
      'typed_env_bool': true,
      'typed_env_obj': { scope: 'env' },
    });
    expect(local.kvPairData.find((row: any) => row.name === 'typed_env_num')).toMatchObject({
      type: 'json',
      value: '300',
    });
  });

  it('stores a dotted name as nested data, since NeDB refuses a key with a dot', () => {
    const local = doc(bru, 'Environment', 'Local');
    expect(local.data.env).toEqual({ var1: 'envVar1' });
    expect(local.data['env.var1']).toBeUndefined();
    expect(local.kvPairData.find((row: any) => row.name === 'env')).toMatchObject({
      type: 'json',
      value: '{"var1":"envVar1"}',
    });
    expect(issues(bru, 'not-supported', 'Local')).toContainEqual({
      reason: 'not-supported',
      type: 'Environment',
      name: 'Local',
      detail:
        'Variables with a dot are stored as nested values: env.var1. Scripts that read them by their full name need changing.',
    });
  });

  it('keeps the names of secrets and reports them, never a value', () => {
    const local = doc(bru, 'Environment', 'Local');
    expect(local.data.github_client_secret).toBe('');
    expect(local.kvPairData.find((row: any) => row.name === 'github_client_secret')).toMatchObject({
      value: '',
      type: 'str',
      isConfidential: true,
    });
    expect(issues(bru, 'secret-not-readable', 'Local').map(issue => issue.detail)).toEqual([
      'github_client_secret',
      'github_client_id',
      'google_client_id',
      'google_client_secret',
      'github_authorization_code',
      'passwordCredentials_access_token',
      'client_credentials_access_token',
      'authorization_code_access_token',
      'github_access_token',
    ]);
    expect(issues(yml, 'secret-not-readable', 'Secrets')).toEqual([
      { reason: 'secret-not-readable', type: 'Environment', name: 'Secrets', detail: 'apiToken' },
    ]);
    expect(doc(yml, 'Environment', 'Secrets').data).toEqual({ baseUrl: 'http://localhost:8081', apiToken: '' });
  });

  it('names an environment after its file', () => {
    expect(doc(yml, 'Environment', 'Secrets').name).toBe('Secrets');
  });

  it('copies in what an environment extends, and lets it override', () => {
    const dev = doc(yml, 'Environment', 'dev').data;
    expect(dev).toMatchObject({
      host: 'http://localhost:8081',
      base_only: 'base_only_value',
      api_url: 'https://dev.example.com',
      dev_only: 'dev_only_value',
      base_number: 42,
      base_boolean: true,
      base_object: { region: 'eu' },
    });
    expect(dev.disabled_in_base).toBeUndefined();
    expect(issues(yml, 'not-supported', 'dev').filter(issue => issue.detail?.includes('extends'))).toEqual([]);
  });

  it('leaves {{process.env.X}} as written and reports it', () => {
    expect(doc(bru, 'Environment', 'Local').data.bark).toBe('{{process.env.PROC_ENV_VAR}}');
    expect(issues(bru, 'not-supported', 'Local')).toContainEqual({
      reason: 'not-supported',
      type: 'Environment',
      name: 'Local',
      detail: '{{process.env.PROC_ENV_VAR}} has no restless equivalent. It was left as written and will not render.',
    });
    expect(request(yml, 'api').url).toBe('{{process.env.NTLM_BASE_URL}}/api');
    expect(issues(yml, 'not-supported', 'api')).toEqual([
      {
        reason: 'not-supported',
        type: 'Request',
        name: 'api',
        detail: '{{process.env.NTLM_BASE_URL}} has no restless equivalent. It was left as written and will not render.',
      },
    ]);
  });
});

describe('NeDB and the committer', () => {
  it('has no key with a dot or a leading $ in any document', () => {
    for (const candidate of plans.flatMap(plan => plan.items)) {
      expect(nedbKeyProblems(candidate.doc), `${candidate.type} ${candidate.name}`).toEqual([]);
    }
  });

  it('survives initModel and the database: every document inserts, and keeps every field', async () => {
    for (const plan of plans) {
      for (const candidate of plan.items) {
        const inserted: Record<string, any> = await database.docCreate(candidate.type as never, candidate.doc as never);
        for (const [key, value] of Object.entries(candidate.doc)) {
          expect(inserted[key], `${candidate.type} ${candidate.name}.${key}`).toEqual(value);
        }
      }
    }
  });

  it('is found by the app, which then creates no second base environment or cookie jar', async () => {
    for (const plan of plans) {
      const workspaceId = plan.items[1].doc._id as string;
      expect((await services.environment.getOrCreateForParentId(workspaceId))._id).toBe(plan.items[3].doc._id);
      expect((await services.cookieJar.getOrCreateForParentId(workspaceId))._id).toBe(plan.items[2].doc._id);
      expect(await services.environment.list({ parentId: workspaceId })).toHaveLength(1);
      expect(await services.cookieJar.getOrCreateForParentId(workspaceId)).toMatchObject({ parentId: workspaceId });
    }
  });
});

describe('names NeDB rejects, end to end', () => {
  it('stores api.url as nested data and converts {{api.url}} to a reference that reads it', async () => {
    const folder = makeCollection({
      'environments/Local.bru': 'vars {\n  api.url: https://api.test\n  $secret: x\n  plain: y\n}\n',
      'a.bru': requestFile('call', 'get', '').replace('http://x', '{{api.url}}/v1/{{plain}}'),
    });
    const [plan] = await planBruno(folder);
    const environment = doc(plan, 'Environment', 'Local');
    expect(environment.data).toEqual({ api: { url: 'https://api.test' }, _secret: 'x', plain: 'y' });
    expect(request(plan, 'call').url).toBe('{{ _.api.url }}/v1/{{ _.plain }}');
    for (const candidate of plan.items) {
      expect(nedbKeyProblems(candidate.doc)).toEqual([]);
    }
    expect(issues(plan, 'not-supported', 'Local').map(issue => issue.detail)).toEqual([
      'Variable "$secret" is stored as "_secret" because a key cannot have that name',
      'Variables with a dot are stored as nested values: api.url. Scripts that read them by their full name need changing.',
    ]);
    await database.docCreate('Environment' as never, environment as never);
  });

  it('renames a dotted name when a plain value holds its key, and the references follow', async () => {
    const folder = makeCollection({
      'environments/Local.bru': 'vars {\n  api: https://plain.test\n  api.url: https://dotted.test\n}\n',
      'environments/Prod.bru': 'vars {\n  api.url: https://prod.test\n}\n',
      'a.bru': requestFile('call', 'get', '').replace('http://x', '{{api.url}}/v1 {{api}}'),
    });
    const [plan] = await planBruno(folder);
    expect(doc(plan, 'Environment', 'Local').data).toEqual({
      api: 'https://plain.test',
      api_url: 'https://dotted.test',
    });
    // Prod has no clash, but one request serves both, so it uses the same name
    expect(doc(plan, 'Environment', 'Prod').data).toEqual({ api_url: 'https://prod.test' });
    expect(request(plan, 'call').url).toBe('{{ _.api_url }}/v1 {{ _.api }}');
    expect(issues(plan, 'not-supported', 'Local').map(issue => issue.detail)).toEqual([
      'Variable "api.url" is stored as "api_url" because "api" already holds a value',
    ]);
    expect(issues(plan, 'not-supported', 'Prod').map(issue => issue.detail)).toEqual([
      'Variable "api.url" is stored as "api_url" so that every environment of the collection uses the same name',
    ]);
    for (const candidate of plan.items) {
      expect(nedbKeyProblems(candidate.doc)).toEqual([]);
    }
  });

  it('applies to the collection variables and to the typed values inside them', async () => {
    const folder = makeCollection({
      'collection.bru':
        "vars:pre-request {\n  base.url: http://base\n  @object\n  shape: '''\n    {\"a.b\": 1, \"$c\": 2}\n  '''\n}\n",
    });
    const [plan] = await planBruno(folder);
    expect(plan.items[3].doc.data).toEqual({ base: { url: 'http://base' }, shape: { a_b: 1, _c: 2 } });
    expect(nedbKeyProblems(plan.items[3].doc)).toEqual([]);
  });
});

describe('more request mappings, from small collections', () => {
  it('keeps a query pair the parameters do not explain, and a disabled parameter', async () => {
    const folder = makeCollection({
      'a.bru':
        requestFile('query', 'get', '').replace('url: http://x', 'url: http://x/path?known=1&extra=2&enc=a%20b') +
        'params:query {\n  known: 1\n  ~off: 3\n  enc: a b\n}\n',
    });
    const [plan] = await planBruno(folder);
    expect(request(plan, 'query')).toMatchObject({
      url: 'http://x/path',
      parameters: [
        { name: 'known', value: '1' },
        { name: 'off', value: '3', disabled: true },
        { name: 'enc', value: 'a b' },
        { name: 'extra', value: '2' },
      ],
    });
  });

  it('leaves the query in the URL when there are no parameters', async () => {
    const folder = makeCollection({ 'a.bru': requestFile('query', 'get', '').replace('http://x', 'http://x?a=1') });
    expect(request((await planBruno(folder))[0], 'query').url).toBe('http://x?a=1');
  });

  it('reports settings restless does not have, and tags and examples once', async () => {
    const folder = makeCollection({
      'a.bru': requestFile(
        'tagged',
        'get',
        '',
        'settings {\n  encodeUrl: true\n  maxRedirects: 10\n  timeout: 3000\n}\n',
      ).replace('seq: 1\n', 'seq: 1\n  tags: [\n    smoke\n  ]\n'),
    });
    const [plan] = await planBruno(folder);
    expect(plan.issues).toEqual([
      {
        reason: 'not-supported',
        type: 'Request',
        name: 'tagged',
        detail: 'Per-request max redirects (10) and timeout (3000 ms) is not supported, the app settings apply',
      },
      {
        reason: 'not-supported',
        type: 'Workspace',
        name: 'temp',
        detail: 'Tags on 1 request(s) and folder(s) were not imported',
      },
    ]);
  });

  it('never puts a secret in a report', async () => {
    const folder = makeCollection({
      'bad.bru': 'meta {\n  name: bad\n}\nauth:bearer {\n  token: TOPSECRET-1\n\nget {',
      'wsse.bru':
        requestFile('wsse', 'get', '').replace('auth: none', 'auth: wsse') +
        'auth:wsse {\n  username: TOPSECRET-2\n  password: TOPSECRET-3\n}\n',
      'oauth.bru':
        requestFile('oauth', 'get', '').replace('auth: none', 'auth: oauth2') +
        'auth:oauth2 {\n  grant_type: authorization_code\n  client_secret: TOPSECRET-4\n  token_placement: url\n}\n',
      'env.bru': requestFile('env', 'get', '').replace('http://x', '{{process.env.TOPSECRET_NAME_ONLY}}'),
      'environments/Local.bru': 'vars {\n  password: TOPSECRET-5\n  a.b: TOPSECRET-6\n}\nvars:secret [\n  apiKey\n]\n',
    });
    const [plan] = await planBruno(folder);
    expect(plan.issues.length).toBeGreaterThan(4);
    const text = JSON.stringify(plan.issues);
    for (let n = 1; n <= 6; n++) {
      expect(text).not.toContain(`TOPSECRET-${n}`);
    }
    // a name is not a value
    expect(text).toContain('TOPSECRET_NAME_ONLY');
  });
});

describe('the source', () => {
  it('is left exactly as it was', () => {
    expect(hashDirectory(FIXTURES)).toBe(hashBefore);
  });

  it('can be planned from a folder that cannot be written to', async () => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-readonly-'));
    temporaryFolders.push(copy);
    fs.cpSync(FIXTURES, copy, { recursive: true });
    const directories = [
      copy,
      ...fs
        .readdirSync(copy, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(entry.parentPath, entry.name)),
    ];
    const before = hashDirectory(copy);
    for (const directory of directories) {
      fs.chmodSync(directory, 0o555);
    }
    try {
      const planned = await planBruno(copy);
      expect(planned.map(plan => plan.items.length)).toEqual(plans.map(plan => plan.items.length));
    } finally {
      for (const directory of directories) {
        fs.chmodSync(directory, 0o755);
      }
    }
    expect(hashDirectory(copy)).toBe(before);
  });
});

afterAll(() => {
  expect(hashDirectory(FIXTURES)).toBe(hashBefore);
});
