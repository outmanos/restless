import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  type BrunoCollection,
  type BrunoFolder,
  type BrunoRequest,
  findBrunoCollections,
  isBrunoCollection,
  readBrunoCollection,
} from './read';
import { BRU_COLLECTION, FIXTURES, hashDirectory, YML_COLLECTION, YML_OAUTH_COLLECTION } from './test-utils';

const allRequests = (folder: BrunoFolder): BrunoRequest[] => [
  ...folder.requests,
  ...folder.folders.flatMap(allRequests),
];
const findRequest = (collection: BrunoCollection, name: string) => {
  const request = allRequests(collection.root).find(candidate => candidate.name === name);
  if (!request) {
    throw new Error(`No request named ${name}`);
  }
  return request;
};
const findFolder = (folder: BrunoFolder, relativePath: string): BrunoFolder | undefined =>
  folder.relativePath === relativePath ? folder : folder.folders.map(child => findFolder(child, relativePath)).find(Boolean);

const temporaryFolders: string[] = [];
afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
function makeCollection(files: Record<string, string>) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-read-'));
  temporaryFolders.push(folder);
  for (const [relativePath, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(folder, relativePath)), { recursive: true });
    fs.writeFileSync(path.join(folder, relativePath), content);
  }
  return folder;
}

describe('finding collections', () => {
  it('knows a collection by bruno.json or opencollection.yml', async () => {
    expect(await isBrunoCollection(BRU_COLLECTION)).toBe(true);
    expect(await isBrunoCollection(YML_COLLECTION)).toBe(true);
    expect(await isBrunoCollection(path.join(BRU_COLLECTION, 'echo'))).toBe(false);
  });

  it('returns a collection folder as it is', async () => {
    expect(await findBrunoCollections(BRU_COLLECTION)).toEqual([fs.realpathSync(BRU_COLLECTION)]);
  });

  it('finds the collections in a parent folder, sorted, and does not look inside a collection', async () => {
    expect(await findBrunoCollections(FIXTURES)).toEqual(
      [BRU_COLLECTION, YML_COLLECTION, YML_OAUTH_COLLECTION].map(folder => fs.realpathSync(folder)),
    );
  });

  it('finds nothing in a folder without collections', async () => {
    expect(await findBrunoCollections(makeCollection({ 'notes/readme.md': 'hello' }))).toEqual([]);
  });

  it('finds collections a few levels down, as in a Bruno workspace, and skips node_modules', async () => {
    const parent = makeCollection({
      'collections/one/bruno.json': '{"name":"one"}',
      'collections/two/opencollection.yml': 'opencollection: 1.0.0\ninfo:\n  name: two\n',
      'node_modules/dep/bruno.json': '{"name":"not me"}',
    });
    expect((await findBrunoCollections(parent)).map(folder => path.basename(folder))).toEqual(['one', 'two']);
  });
});

describe('reading a .bru collection', () => {
  it('reads the collection, its settings and its folders', async () => {
    const collection = await readBrunoCollection(BRU_COLLECTION);
    expect(collection).toMatchObject({ format: 'bru', name: 'bruno-testbench', hasProxy: false, clientCertificateCount: 0 });
    expect(collection.settings.headers.map(header => header.name)).toEqual(['check', 'token', 'collection-header']);
    expect(collection.settings.auth).toEqual({ mode: 'bearer', values: { token: '{{bearer_auth_token}}' } });
    expect(collection.settings.scripts.req).toContain("bru.getVar('should-test-collection-scripts')");
    expect(collection.settings.docs).toContain('# bruno-testbench');
    expect(collection.settings.vars.req.map(variable => [variable.name, variable.value])).toEqual([
      ['collection_pre_var', 'collection_pre_var_value'],
      ['collection_pre_var_token', '{{request_pre_var_token}}'],
      ['collection-var', 'collection-var-value'],
      ['coll_str', 'collection_string'],
      ['coll_num', 100],
      ['coll_bool', false],
      ['coll_obj', { scope: 'collection' }],
    ]);
    expect(collection.root.folders.map(folder => folder.relativePath)).toEqual([
      'HelloService',
      'asserts',
      'auth',
      'broken',
      'echo',
      'file-binary',
      'graphql',
      'request-setting',
      'response-time',
      'scripting',
      'websocket',
    ]);
  });

  it('takes the folder name and order from folder.bru', async () => {
    const collection = await readBrunoCollection(BRU_COLLECTION);
    expect(findFolder(collection.root, 'request-setting')).toMatchObject({ name: 'request-setting', seq: 14 });
    expect(findFolder(collection.root, 'auth/digest')).toMatchObject({ name: 'digest' });
    expect(findFolder(collection.root, 'scripting/js')?.settings.headers).toEqual([
      { name: 'folder-header', value: 'folder-header-value', enabled: true },
    ]);
    // Folders are named after their directory when there is no folder.bru
    expect(findFolder(collection.root, 'auth/bearer')?.name).toBe('bearer');
  });

  it('reads an HTTP request', async () => {
    const request = findRequest(await readBrunoCollection(BRU_COLLECTION), 'delayed body');
    expect(request).toMatchObject({
      kind: 'http',
      method: 'GET',
      url: '{{localhost}}/api/wait-for/body?time=1000',
      seq: 2,
      relativePath: 'response-time/delayed-body.bru',
    });
    expect(request.params).toEqual([{ name: 'time', value: '1000', enabled: true, type: 'query' }]);
  });

  it('reads path parameters', async () => {
    const request = findRequest(await readBrunoCollection(BRU_COLLECTION), 'getPathParam');
    expect(request.params).toEqual([{ name: 'pathParam', value: 'ping', enabled: true, type: 'path' }]);
  });

  it.each([
    ['Basic Auth 200', 'none', {}],
    ['Digest Auth 200', 'digest', { username: 'admin', password: 'password' }],
    ['Bearer Auth 200', 'bearer', { token: '{{bearer_auth_token}}' }],
    ['inherit Bearer Auth 200', 'inherit', {}],
  ])('reads the %s authentication', async (name, mode, values) => {
    expect(findRequest(await readBrunoCollection(BRU_COLLECTION), name).auth).toEqual({ mode, values });
  });

  it('keeps only the authentication mode a request uses', async () => {
    // runRequest.bru has auth:basic and auth:bearer blocks but `auth: none`
    expect(findRequest(await readBrunoCollection(BRU_COLLECTION), 'runRequest').auth).toEqual({ mode: 'none', values: {} });
  });

  it.each([
    ['echo xml raw', 'xml', '<hello><world>bruno</world></hello>'],
    ['echo plaintext', 'text', 'hello'],
  ])('reads a %s body', async (name, mode, text) => {
    expect(findRequest(await readBrunoCollection(BRU_COLLECTION), name).body).toMatchObject({ mode, text });
  });

  it('reads a GraphQL body with variables', async () => {
    const collection = await readBrunoCollection(BRU_COLLECTION);
    expect(findRequest(collection, 'spacex')).toMatchObject({ kind: 'graphql', method: 'POST' });
    expect(findRequest(collection, 'spacex').body.graphql.query).toContain('ceo');
    expect(findRequest(collection, 'variables interpolation').body.graphql).toEqual({
      query: 'query { __typename }',
      variables: '{\n  "my_json": "{{my_json}}"\n}',
    });
  });

  it('reads form and multipart bodies, with duplicate keys and files', async () => {
    const collection = await readBrunoCollection(BRU_COLLECTION);
    const form = findRequest(collection, 'echo form-url-encoded');
    expect(form.body.mode).toBe('formUrlEncoded');
    expect(form.body.formUrlEncoded.map(field => `${field.name}=${field.value}`)).toEqual([
      'form-data-key={{form-data-key}}',
      'form-data-stringified-object={{form-data-stringified-object}}',
      'key_1=value_1',
      'key_2=value_2',
      'key_1=value_3',
      'key_2=value_4',
    ]);
    const multipart = findRequest(collection, 'echo multipart').body.multipartForm;
    expect(multipart.map(part => [part.name, part.type, part.contentType])).toEqual([
      ['foo', 'text', 'application/json--test'],
      ['multiline', 'text', 'application/json--multiline--test'],
      ['form-data-key', 'text', ''],
      ['form-data-stringified-object', 'text', ''],
      ['file', 'file', ''],
    ]);
    expect(multipart[0].value).toBe('{"bar":"baz"}');
    expect(multipart[4].files).toEqual(['bruno.png']);
  });

  it('reads a file body', async () => {
    expect(findRequest(await readBrunoCollection(BRU_COLLECTION), 'binary upload json').body).toMatchObject({
      mode: 'file',
      file: [{ filePath: 'file.json', contentType: 'application/json', selected: true }],
    });
  });

  it('reads scripts, tests, variables and settings', async () => {
    const collection = await readBrunoCollection(BRU_COLLECTION);
    const request = findRequest(collection, 'variables interpolation');
    expect(request.scripts.req).toContain('bru.setVar("my_json", cv)');
    expect(request.scripts.res).toBe('bru.deleteVar("my_json")');
    expect(request.scripts.tests).toContain('GraphQL variables with nested object');
    expect(findRequest(collection, 'follow-redirect').settings).toMatchObject({ encodeUrl: true, followRedirects: false });
  });

  it('reads assertions: the operator is the first word of the value', async () => {
    const assertions = findRequest(await readBrunoCollection(BRU_COLLECTION), 'test-assert-combinations').assertions;
    expect(assertions).toHaveLength(28);
    expect(assertions[0]).toEqual({ expression: 'res.body.string', operator: 'eq', value: 'foo', enabled: true });
    expect(assertions.find(a => a.expression === 'res.body.numberBig.toString()')).toMatchObject({ operator: 'eq', value: "'9007199254740992000'" });
    // no operator means eq
    const noOperator = findRequest(await readBrunoCollection(BRU_COLLECTION), 'Bearer Auth 200').assertions;
    expect(noOperator).toEqual([
      { expression: 'res.status', operator: 'eq', value: '200', enabled: true },
      { expression: 'res.body.message', operator: 'eq', value: 'Authentication successful', enabled: true },
    ]);
    // a value with colons in it stays whole
    const echo = findRequest(await readBrunoCollection(BRU_COLLECTION), 'echo multipart').assertions;
    expect(echo.at(-2)).toEqual({ expression: 'res.body', operator: 'contains', value: 'Content-Type: application/json--test', enabled: true });
    // unary operators carry no value
    expect(findRequest(await readBrunoCollection(BRU_COLLECTION), 'Digest Auth 200').assertions[1]).toEqual({
      expression: 'res.body.authenticated',
      operator: 'isTruthy',
      value: '',
      enabled: true,
    });
  });

  it('reads gRPC requests: method, messages and proto path', async () => {
    const collection = await readBrunoCollection(BRU_COLLECTION);
    expect(findRequest(collection, 'SayHello')).toMatchObject({
      kind: 'grpc',
      url: '{{host}}',
      method: '/hello.HelloService/SayHello',
      grpc: { methodType: 'unary', protoPath: '', messages: [{ name: 'message 1', content: '{\n  "greeting": "amoveo"\n}' }] },
    });
    expect(findRequest(collection, 'BidiHello').grpc?.messages).toHaveLength(2);
    expect(findRequest(collection, 'MissingProto').grpc?.protoPath).toBe('protos/not-there.proto');
  });

  it('reads WebSocket requests', async () => {
    expect(findRequest(await readBrunoCollection(BRU_COLLECTION), 'ws-multi-msg')).toMatchObject({
      kind: 'ws',
      url: 'ws://localhost:8081/ws/echo',
      auth: { mode: 'inherit' },
      ws: {
        messages: [
          { name: 'message 1', type: 'json', content: '{\n  "action": "subscribe"\n}', selected: false },
          { name: 'message 2', type: 'text', content: 'hello world', selected: false },
        ],
      },
    });
  });

  it('reads environments, named after their file, with secrets as names only', async () => {
    const { environments } = await readBrunoCollection(BRU_COLLECTION);
    expect(environments.map(environment => environment.name)).toEqual(['Local', 'Prod', 'base', 'dev']);
    const local = environments.find(environment => environment.name === 'Local')!;
    expect(local.variables.find(variable => variable.name === 'env.var1')).toMatchObject({ value: 'envVar1', secret: false });
    expect(local.variables.find(variable => variable.name === 'typed_env_num')?.value).toBe(300);
    expect(local.variables.find(variable => variable.name === 'typed_env_obj')?.value).toEqual({ scope: 'env' });
    expect(local.variables.filter(variable => variable.secret).map(variable => [variable.name, variable.value])).toEqual(
      [
        'github_client_secret',
        'github_client_id',
        'google_client_id',
        'google_client_secret',
        'github_authorization_code',
        'passwordCredentials_access_token',
        'client_credentials_access_token',
        'authorization_code_access_token',
        'github_access_token',
      ].map(name => [name, '']),
    );
    expect(environments.find(environment => environment.name === 'dev')?.extends).toEqual(['base']);
  });

  it('reports files it cannot parse and goes on with the rest', async () => {
    const collection = await readBrunoCollection(BRU_COLLECTION);
    expect(collection.issues).toEqual([
      { reason: 'parse-error', type: 'Request', name: 'broken/nested/broken.bru', detail: 'Syntax error at line 11, column 1' },
      { reason: 'parse-error', type: 'Request', name: 'broken/shallow-broken.bru', detail: 'Syntax error at line 11, column 1' },
    ]);
    expect(findRequest(collection, 'healthy').relativePath).toBe('broken/healthy.bru');
  });
});

describe('reading an OpenCollection YAML collection', () => {
  it('reads the collection, with typed variables', async () => {
    const collection = await readBrunoCollection(YML_COLLECTION);
    expect(collection).toMatchObject({ format: 'yml', name: 'bruno-yml-testbench' });
    expect(collection.settings.vars.req.map(variable => [variable.name, variable.value])).toEqual([
      ['coll_str', 'collection_string'],
      ['coll_num', 100],
      ['coll_bool', false],
      ['coll_obj', { scope: 'collection' }],
    ]);
  });

  it('reads folders with their own variables', async () => {
    const collection = await readBrunoCollection(YML_COLLECTION);
    expect(findFolder(collection.root, 'variable-datatypes')?.settings.vars.req.map(variable => variable.name)).toEqual([
      'fold_str',
      'fold_num',
      'fold_bool',
      'fold_obj',
    ]);
    expect(findFolder(collection.root, 'auth/oauth2-folder')).toMatchObject({
      seq: 3,
      settings: { auth: { mode: 'oauth2', values: { grantType: 'client_credentials', clientId: 'client_id_1', credentialsPlacement: 'body' } } },
    });
    expect(findFolder(collection.root, 'auth/oauth1-folder')?.settings.auth).toMatchObject({
      mode: 'oauth1',
      values: { consumerKey: 'consumer_key_1', accessToken: 'access_token_1', signatureMethod: 'HMAC-SHA1' },
    });
  });

  it('reads a request with typed variables, scripts and assertions', async () => {
    const collection = await readBrunoCollection(YML_COLLECTION);
    const request = findRequest(collection, 'typed vars');
    expect(request).toMatchObject({ kind: 'http', method: 'POST', seq: 1, url: '{{echo-host}}' });
    expect(request.vars.req.map(variable => [variable.name, variable.value])).toEqual([
      ['req_str', 'request_string'],
      ['req_num', 42],
      ['req_bool', true],
      ['req_obj', { key: 'value' }],
      ['req_obj_precision', expect.objectContaining({ integer: 123, smallDouble: 9.876e-12 })],
      ['req_obj_empty', {}],
      // not a number: Bruno keeps the text
      ['mismatched_num', 'not-a-number'],
    ]);
    expect(request.scripts.req).toContain('bru.setVar("runtime_str", "runtime_string");');
    expect(request.scripts.tests).toContain('collection vars carry their declared types');
    expect(request.body.mode).toBe('json');
    expect(findRequest(collection, 'delayed body').assertions).toEqual([
      { expression: 'res.status', operator: 'eq', value: '200', enabled: true },
    ]);
    expect(findRequest(collection, 'delayed body').params).toEqual([{ name: 'time', value: '1000', enabled: true, type: 'query' }]);
  });

  it('reads form, multipart and authentication', async () => {
    const collection = await readBrunoCollection(YML_COLLECTION);
    expect(findRequest(collection, 'form-urlencoded').body.formUrlEncoded.map(field => field.name)).toEqual(['fu_str', 'fu_num', 'fu_bool', 'fu_obj']);
    expect(findRequest(collection, 'multipart').body.multipartForm.map(part => part.type)).toEqual(['text', 'text', 'text', 'text']);
    expect(findRequest(collection, 'api').auth).toEqual({ mode: 'ntlm', values: expect.objectContaining({ username: 'ntlmtest', domain: '' }) });
    expect(findRequest(collection, 'EdgeGrid GET 200').auth.mode).toBe('akamai-edgegrid');
    expect(findRequest(collection, 'oauth2-request').auth.mode).toBe('inherit');
  });

  it('reads gRPC and WebSocket requests', async () => {
    const collection = await readBrunoCollection(YML_COLLECTION);
    const grpc = findRequest(collection, 'MessageHooksUnary');
    expect(grpc).toMatchObject({
      kind: 'grpc',
      url: '{{host}}',
      method: '/hello.HelloService/SayHello',
      headers: [{ name: 'x-keep', value: 'kept-value', enabled: true }],
    });
    expect(grpc.scripts.grpcHooks).toEqual(['before-call-start', 'before-message-send', 'after-message-receive', 'after-call-end']);
    expect(findRequest(collection, 'WithProto').grpc?.protoPath).toBe('protos/hello.proto');
    expect(findRequest(collection, 'ws-multi-msg').ws?.messages.map(message => [message.name, message.type])).toEqual([
      ['message 1', 'json'],
      ['message 2', 'text'],
    ]);
  });

  it('names environments after their file, and reads secrets as names only', async () => {
    const { environments } = await readBrunoCollection(YML_COLLECTION);
    expect(environments.map(environment => environment.name)).toEqual(['Local', 'Prod', 'Secrets', 'base', 'dev']);
    // Secrets.yml says `name: Local` inside, as it was copied from a file with that name
    expect(environments.find(environment => environment.name === 'Secrets')?.variables).toEqual([
      { name: 'baseUrl', value: 'http://localhost:8081', enabled: true, secret: false },
      { name: 'apiToken', value: '', enabled: true, secret: true },
    ]);
    const base = environments.find(environment => environment.name === 'base')!;
    expect(base.variables.find(variable => variable.name === 'base_number')?.value).toBe(42);
    expect(base.variables.find(variable => variable.name === 'disabled_in_base')).toMatchObject({ enabled: false });
    expect(environments.find(environment => environment.name === 'dev')?.extends).toEqual(['base']);
  });

  it('reads settings the collection holds in its root file', async () => {
    const collection = await readBrunoCollection(YML_OAUTH_COLLECTION);
    expect(collection.name).toBe('inherited-auth-collection');
    expect(collection.settings.auth).toMatchObject({
      mode: 'oauth2',
      values: {
        grantType: 'authorization_code',
        authorizationUrl: 'http://localhost:8081/authorize',
        callbackUrl: 'http://localhost:8081/callback',
        clientId: 'inherited-client-id',
        credentialsPlacement: 'body',
        pkce: false,
        tokenPlacement: 'header',
      },
    });
    expect(collection.settings.auth.values.additionalParameters).toBeTruthy();
  });

  it('reports files it cannot parse and goes on with the rest', async () => {
    const collection = await readBrunoCollection(YML_COLLECTION);
    expect(collection.issues).toEqual([
      { reason: 'parse-error', type: 'Request', name: 'broken/nested/broken.yml', detail: 'Syntax error at line 9, column 1' },
      { reason: 'parse-error', type: 'Request', name: 'broken/shallow-broken.yml', detail: 'Syntax error at line 9, column 1' },
    ]);
    expect(findRequest(collection, 'healthy').relativePath).toBe('broken/healthy.yml');
  });
});

describe('malformed input', () => {
  it('never puts a line of the file in the report, since it could hold a secret', async () => {
    const folder = makeCollection({
      'bruno.json': '{"name": "leaky", "token": "TOPSECRET-in-config",}',
      'bad.bru': 'meta {\n  name: bad\n}\n\nauth:bearer {\n  token: TOPSECRET-in-request\n\nget {',
      'environments/Bad.bru': 'vars {\n  password: TOPSECRET-in-env\n',
      'ok.bru': 'meta {\n  name: ok\n  type: http\n  seq: 1\n}\n\nget {\n  url: http://x\n  body: none\n  auth: none\n}\n',
    });
    const collection = await readBrunoCollection(folder);
    expect(collection.issues.map(issue => [issue.reason, issue.name])).toEqual([
      ['parse-error', 'bruno.json'],
      ['parse-error', 'bad.bru'],
      ['parse-error', 'environments/Bad.bru'],
    ]);
    expect(JSON.stringify(collection.issues)).not.toContain('TOPSECRET');
    // the folder name stands in for the name in the unreadable bruno.json, and the good file still comes through
    expect(collection.name).toBe(path.basename(fs.realpathSync(folder)));
    expect(findRequest(collection, 'ok').url).toBe('http://x');
  });

  it('reads a file with a byte order mark and Windows line endings', async () => {
    const folder = makeCollection({
      'bruno.json': '{"name":"crlf"}',
      'a.bru': '﻿meta {\r\n  name: a\r\n  type: http\r\n  seq: 1\r\n}\r\n\r\nget {\r\n  url: http://x\r\n  body: none\r\n  auth: none\r\n}\r\n',
    });
    expect(findRequest(await readBrunoCollection(folder), 'a')).toMatchObject({ method: 'GET', url: 'http://x' });
  });

  it('skips the folders Bruno skips, and the ones bruno.json ignores', async () => {
    const request = 'meta {\n  name: r\n  type: http\n  seq: 1\n}\n\nget {\n  url: http://x\n  body: none\n  auth: none\n}\n';
    const folder = makeCollection({
      'bruno.json': '{"name":"skips","ignore":["generated"]}',
      'node_modules/dep/r.bru': request,
      '.git/r.bru': request,
      'mocks/r.bru': request,
      'generated/deep/r.bru': request,
      'kept/r.bru': request,
    });
    expect(allRequests((await readBrunoCollection(folder)).root).map(r => r.relativePath)).toEqual(['kept/r.bru']);
  });

  it('skips Bruno apps with a report', async () => {
    const folder = makeCollection({
      'bruno.json': '{"name":"apps"}',
      'app.bru': 'meta {\n  name: my app\n  type: app\n  seq: 1\n}\n\napp {\n  code: x\n}\n',
    });
    const collection = await readBrunoCollection(folder);
    expect(allRequests(collection.root)).toEqual([]);
    expect(collection.issues).toEqual([{ reason: 'not-supported', type: 'Request', name: 'my app', detail: 'Bruno apps are not supported' }]);
  });
});

describe('reading changes nothing', () => {
  it.each([
    ['.bru', BRU_COLLECTION],
    ['YAML', YML_COLLECTION],
  ])('leaves a %s collection exactly as it was', async (_format, folder) => {
    const before = hashDirectory(folder);
    await readBrunoCollection(folder);
    await findBrunoCollections(FIXTURES);
    expect(hashDirectory(folder)).toBe(before);
  });

  it('works on a folder it is not allowed to write to', async () => {
    const folder = makeCollection({ 'bruno.json': '{"name":"readonly"}', 'sub/r.bru': 'meta {\n  name: r\n}\n\nget {\n  url: http://x\n}\n' });
    const chmodAll = (mode: number) => {
      for (const target of [folder, path.join(folder, 'sub')]) {
        fs.chmodSync(target, mode);
      }
    };
    chmodAll(0o555);
    try {
      expect(allRequests((await readBrunoCollection(folder)).root)).toHaveLength(1);
    } finally {
      chmodAll(0o755);
    }
  });
});
