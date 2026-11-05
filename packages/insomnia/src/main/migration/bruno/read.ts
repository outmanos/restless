import fs from 'node:fs/promises';
import path from 'node:path';

import { bruToEnvJsonV2, bruToJsonV2, collectionBruToJson } from '@usebruno/lang';
import { parse as parseYaml } from 'yaml';

import type { ReportEntry } from '../types';
import type { BrunoAssertionInput, BrunoVariableInput } from './translate-script';

/**
 * Reads a Bruno collection without touching it. Both formats end up in the same shape:
 *  - `.bru`: bruno.json, collection.bru, folder.bru, environments/*.bru, one .bru per request
 *  - OpenCollection YAML: opencollection.yml, folder.yml, environments/*.yml, one .yml per request
 * Verified against usebruno/bruno (packages/bruno-electron/src/utils/mount.js and packages/bruno-filestore).
 */

export type BrunoFormat = 'bru' | 'yml';
export type BrunoRequestKind = 'http' | 'graphql' | 'grpc' | 'ws';

export interface BrunoKeyValue {
  name: string;
  value: string;
  enabled: boolean;
  description?: string;
}

export interface BrunoParam extends BrunoKeyValue {
  type: 'query' | 'path';
}

export interface BrunoVariable extends BrunoVariableInput {
  description?: string;
  secret?: boolean;
}

export type BrunoAssertion = BrunoAssertionInput;

// `values` holds the settings of the chosen mode, with the field names `@usebruno/lang` uses
export interface BrunoAuth {
  mode: string;
  values: Record<string, any>;
}

export interface BrunoMultipartPart extends BrunoKeyValue {
  type: 'text' | 'file';
  contentType: string;
  files: string[];
}

export interface BrunoFileEntry {
  filePath: string;
  contentType: string;
  selected: boolean;
}

export interface BrunoBody {
  mode: 'none' | 'json' | 'text' | 'xml' | 'sparql' | 'graphql' | 'formUrlEncoded' | 'multipartForm' | 'file';
  // The payload of the json, text, xml and sparql modes
  text: string;
  graphql: { query: string; variables: string };
  formUrlEncoded: BrunoKeyValue[];
  multipartForm: BrunoMultipartPart[];
  file: BrunoFileEntry[];
}

export interface BrunoScripts {
  req: string;
  res: string;
  tests: string;
  // gRPC lifecycle hooks that are present, by name
  grpcHooks: string[];
}

export interface BrunoSettings {
  encodeUrl?: boolean;
  followRedirects?: boolean;
  maxRedirects?: number;
  timeout?: number | 'inherit';
}

export interface BrunoRequest {
  kind: BrunoRequestKind;
  name: string;
  seq?: number;
  tags: string[];
  description: string;
  docs: string;
  // The HTTP method, or the full method name of a gRPC call
  method: string;
  url: string;
  headers: BrunoKeyValue[];
  params: BrunoParam[];
  auth: BrunoAuth;
  body: BrunoBody;
  vars: { req: BrunoVariable[]; res: BrunoVariable[] };
  assertions: BrunoAssertion[];
  scripts: BrunoScripts;
  settings: BrunoSettings;
  grpc?: { methodType: string; protoPath: string; messages: { name: string; content: string }[] };
  ws?: { messages: { name: string; type: string; content: string; selected: boolean }[] };
  exampleCount: number;
  relativePath: string;
}

// What a folder, or the collection itself, adds to the requests below it
export interface BrunoFolderSettings {
  headers: BrunoKeyValue[];
  auth: BrunoAuth;
  vars: { req: BrunoVariable[]; res: BrunoVariable[] };
  scripts: { req: string; res: string; tests: string };
  docs: string;
}

export interface BrunoFolder {
  name: string;
  relativePath: string;
  seq?: number;
  tags: string[];
  settings: BrunoFolderSettings;
  folders: BrunoFolder[];
  requests: BrunoRequest[];
}

export interface BrunoEnvironment {
  name: string;
  relativePath: string;
  variables: BrunoVariable[];
  color?: string;
  extends: string[];
  hasExternalSecrets: boolean;
}

export interface BrunoCollection {
  // Real path of the collection folder
  path: string;
  format: BrunoFormat;
  name: string;
  settings: BrunoFolderSettings;
  root: BrunoFolder;
  environments: BrunoEnvironment[];
  clientCertificateCount: number;
  // Proto files the collection lists in its settings, which requests use without naming them
  protoFileCount: number;
  hasProxy: boolean;
  issues: ReportEntry[];
}

export const OPEN_COLLECTION_FILE = 'opencollection.yml';
export const BRUNO_CONFIG_FILE = 'bruno.json';

const COLLECTION_ROOT_FILES = { bru: 'collection.bru', yml: OPEN_COLLECTION_FILE } as const;
const FOLDER_FILES = { bru: 'folder.bru', yml: 'folder.yml' } as const;
const EXTENSIONS = { bru: '.bru', yml: '.yml' } as const;
const ENVIRONMENTS_DIR = 'environments';
// Bruno skips these everywhere, and `mocks` at the collection root
const DENIED_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.bruno']);
const GRPC_HOOKS = ['beforeCallStart', 'beforeMessageSend', 'afterMessageReceive', 'afterCallEnd'] as const;

const asArray = (value: unknown): any[] => (Array.isArray(value) ? value : []);
const asObject = (value: unknown): Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};

export function asString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

// Docs and descriptions are a string, or `{ content }` in OpenCollection
const asText = (value: unknown): string => asString(asObject(value).content ?? value);

const toNumber = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : Number.parseFloat(asString(value));
  return Number.isFinite(number) ? number : undefined;
};

const toBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : undefined;

// Ported from usebruno/bruno (MIT, packages/bruno-common/src/utils/datatype.ts)
function parseValueByDataType(value: string, dataType: string): unknown {
  try {
    if (dataType === 'number') {
      const number = Number(value.trim());
      return value.trim() !== '' && !Number.isNaN(number) ? number : value;
    }
    if (dataType === 'boolean') {
      return value === 'true' ? true : value === 'false' ? false : value;
    }
    if (dataType === 'object') {
      const parsed = JSON.parse(value.trim());
      return parsed !== null && typeof parsed === 'object' ? parsed : value;
    }
  } catch {
    // not a value of that type: Bruno keeps the text
  }
  return value;
}

// An OpenCollection value is a string, or `{ type, data }` for numbers, booleans and objects
function ymlValue(raw: unknown): unknown {
  const typed = asObject(raw);
  if ('type' in typed && 'data' in typed) {
    return parseValueByDataType(asString(typed.data), asString(typed.type));
  }
  return asString(raw);
}

/** The message of a parse error without the file excerpt, which could hold secrets */
export function describeError(error: any): string {
  if (error?.code && typeof error.code === 'string' && /^E[A-Z]+$/.test(error.code)) {
    return `The file could not be read (${error.code})`;
  }
  const message = asString(error?.message);
  const ohm = /Line (\d+), col (\d+)/.exec(message);
  if (ohm) {
    return `Syntax error at line ${ohm[1]}, column ${ohm[2]}`;
  }
  const position = error?.linePos?.[0];
  if (position) {
    return `Syntax error at line ${position.line}, column ${position.col}`;
  }
  return error instanceof SyntaxError ? 'The file is not valid JSON' : 'The file could not be parsed';
}

const exists = (target: string) =>
  fs.access(target).then(
    () => true,
    () => false,
  );

// Some editors put one at the start of a file, and the parsers do not expect it
const BYTE_ORDER_MARK = String.fromCodePoint(0xfe_ff);

async function readText(target: string) {
  const text = await fs.readFile(target, 'utf8');
  return text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
}

type EntryKind = 'directory' | 'file' | 'other';

async function entryKind(
  directory: string,
  entry: { name: string; isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean },
): Promise<EntryKind> {
  try {
    const stat = entry.isSymbolicLink() ? await fs.stat(path.join(directory, entry.name)) : entry;
    return stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
  } catch {
    // a broken link, or a file that went away
    return 'other';
  }
}

async function listEntries(directory: string) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export async function isBrunoCollection(directory: string) {
  return (
    (await exists(path.join(directory, BRUNO_CONFIG_FILE))) ||
    (await exists(path.join(directory, OPEN_COLLECTION_FILE)))
  );
}

/** The collection folders in `root`: the folder itself, or the ones below it. Collections do not nest. */
export async function findBrunoCollections(root: string, maxDepth = 5): Promise<string[]> {
  const found: string[] = [];
  const visited = new Set<string>();

  const visit = async (directory: string, depth: number) => {
    let real: string;
    try {
      real = await fs.realpath(directory);
    } catch {
      return;
    }
    if (visited.has(real)) {
      return;
    }
    visited.add(real);
    if (await isBrunoCollection(real)) {
      found.push(real);
      return;
    }
    if (depth >= maxDepth) {
      return;
    }
    let entries;
    try {
      entries = await listEntries(real);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!DENIED_DIRS.has(entry.name) && (await entryKind(real, entry)) === 'directory') {
        await visit(path.join(real, entry.name), depth + 1);
      }
    }
  };

  await visit(root, 0);
  return found.sort();
}

// --- authentication ---

const AUTH_VALUE_KEYS: Record<string, string> = {
  'basic': 'basic',
  'bearer': 'bearer',
  'digest': 'digest',
  'ntlm': 'ntlm',
  'oauth1': 'oauth1',
  'oauth2': 'oauth2',
  'awsv4': 'awsv4',
  'wsse': 'wsse',
  'apikey': 'apikey',
  'akamai-edgegrid': 'akamaiEdgegrid',
};

function bruAuth(mode: unknown, auth: unknown, file: Record<string, any>): BrunoAuth {
  const name = typeof mode === 'string' && mode ? mode : 'none';
  const key = AUTH_VALUE_KEYS[name];
  const values = key ? asObject(asObject(auth)[key]) : {};
  // The extra OAuth 2 parameters are blocks of their own in the file
  const hasExtraParameters =
    name === 'oauth2' && Object.keys(file).some(block => block.startsWith('oauth2_additional_parameters_'));
  return { mode: name, values: hasExtraParameters ? { ...values, additionalParameters: true } : values };
}

const OAUTH2_FLOWS: Record<string, string> = {
  client_credentials: 'client_credentials',
  resource_owner_password_credentials: 'password',
  authorization_code: 'authorization_code',
  implicit: 'implicit',
};

// OpenCollection spells OAuth 2 differently. This gives it the shape `@usebruno/lang` produces.
function ymlOAuth2(auth: Record<string, any>): Record<string, any> {
  const tokenPlacement = asObject(asObject(auth.tokenConfig).placement);
  const parameters = asObject(auth.additionalParameters);
  return {
    grantType: OAUTH2_FLOWS[asString(auth.flow)] ?? asString(auth.flow),
    accessTokenUrl: asString(auth.accessTokenUrl),
    refreshTokenUrl: asString(auth.refreshTokenUrl),
    authorizationUrl: asString(auth.authorizationUrl),
    callbackUrl: asString(auth.callbackUrl),
    clientId: asString(asObject(auth.credentials).clientId),
    clientSecret: asString(asObject(auth.credentials).clientSecret),
    credentialsPlacement: asString(asObject(auth.credentials).placement) || 'body',
    username: asString(asObject(auth.resourceOwner).username),
    password: asString(asObject(auth.resourceOwner).password),
    scope: asString(auth.scope),
    state: asString(auth.state),
    pkce: auth.pkce !== undefined && !asObject(auth.pkce).disabled,
    tokenPlacement: 'query' in tokenPlacement ? 'url' : 'header',
    tokenHeaderPrefix: asString(tokenPlacement.header),
    tokenQueryKey: asString(tokenPlacement.query),
    tokenSource: asString(asObject(auth.tokenConfig).source) || 'access_token',
    additionalParameters: Object.keys(parameters).length > 0 ? parameters : undefined,
  };
}

function ymlAuth(auth: unknown): BrunoAuth {
  if (auth === 'inherit') {
    return { mode: 'inherit', values: {} };
  }
  const values = asObject(auth);
  const type = asString(values.type);
  switch (type) {
    case '':
    case 'none': {
      return { mode: 'none', values: {} };
    }
    case 'oauth2': {
      return { mode: 'oauth2', values: ymlOAuth2(values) };
    }
    case 'apikey': {
      return {
        mode: 'apikey',
        values: { ...values, placement: values.placement === 'query' ? 'queryparams' : 'header' },
      };
    }
    case 'oauth1': {
      const key = asObject(values.privateKey);
      const hasKeyObject = 'value' in key;
      return {
        mode: 'oauth1',
        values: {
          ...values,
          privateKey: hasKeyObject ? asString(key.value) : asString(values.privateKey),
          privateKeyType: hasKeyObject ? asString(key.type) : 'text',
        },
      };
    }
    default: {
      return { mode: type, values };
    }
  }
}

// --- request parts ---

const bruKeyValues = (list: unknown): BrunoKeyValue[] =>
  asArray(list).map(item => ({
    name: asString(item.name),
    value: asString(item.value),
    enabled: item.enabled !== false,
    ...(item.description ? { description: asString(item.description) } : {}),
  }));

const ymlKeyValues = (list: unknown): BrunoKeyValue[] =>
  asArray(list).map(item => ({
    name: asString(item.name),
    value: asString(item.value),
    enabled: item.disabled !== true,
    ...(item.description ? { description: asText(item.description) } : {}),
  }));

const bruVariables = (list: unknown): BrunoVariable[] =>
  asArray(list).map(item => ({
    name: asString(item.name),
    value: item.value,
    enabled: item.enabled !== false,
    local: item.local === true,
    ...(item.description ? { description: asString(item.description) } : {}),
  }));

const ymlVariables = (list: unknown): BrunoVariable[] =>
  asArray(list).map(item => ({
    name: asString(item.name),
    value: ymlValue(item.value),
    enabled: item.disabled !== true,
    ...(item.description ? { description: asText(item.description) } : {}),
  }));

// OpenCollection keeps post-response variables as actions
const ymlPostResponseVariables = (actions: unknown): BrunoVariable[] =>
  asArray(actions)
    .filter(action => action.type === 'set-variable' && action.phase === 'after-response')
    .map(action => ({
      name: asString(action.variable?.name),
      value: asString(action.selector?.expression),
      enabled: action.disabled !== true,
      local: action.variable?.scope === 'request',
    }));

// "res.status: eq 200" is a name and "eq 200" a value. The operator is the first word of the value.
const UNARY_OPERATORS = new Set([
  'isEmpty',
  'isNotEmpty',
  'isNull',
  'isUndefined',
  'isDefined',
  'isTruthy',
  'isFalsy',
  'isJson',
  'isNumber',
  'isString',
  'isBoolean',
  'isArray',
]);
const BINARY_OPERATORS = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'notIn',
  'contains',
  'notContains',
  'length',
  'matches',
  'notMatches',
  'startsWith',
  'endsWith',
  'between',
]);

function bruAssertions(list: unknown): BrunoAssertion[] {
  return asArray(list).map(item => {
    const raw = asString(item.value);
    const [first = '', ...rest] = raw.trim().split(' ');
    const base = { expression: asString(item.name), enabled: item.enabled !== false };
    if (UNARY_OPERATORS.has(first)) {
      return { ...base, operator: first, value: '' };
    }
    if (BINARY_OPERATORS.has(first)) {
      return { ...base, operator: first, value: rest.join(' ') };
    }
    return { ...base, operator: 'eq', value: raw };
  });
}

const ymlAssertions = (list: unknown): BrunoAssertion[] =>
  asArray(list).map(item => ({
    expression: asString(item.expression),
    operator: asString(item.operator) || 'eq',
    value: asString(item.value),
    enabled: item.disabled !== true,
  }));

function ymlScripts(list: unknown): BrunoScripts {
  const scripts: BrunoScripts = { req: '', res: '', tests: '', grpcHooks: [] };
  for (const script of asArray(list)) {
    const code = asString(script.code);
    switch (script.type) {
      case 'before-request': {
        scripts.req = code;
        break;
      }
      case 'after-response': {
        scripts.res = code;
        break;
      }
      case 'tests': {
        scripts.tests = code;
        break;
      }
      default: {
        if (typeof script.type === 'string' && script.type.startsWith('grpc:') && code.trim()) {
          scripts.grpcHooks.push(script.type.slice('grpc:'.length));
        }
      }
    }
  }
  return scripts;
}

const emptyBody = (): BrunoBody => ({
  mode: 'none',
  text: '',
  graphql: { query: '', variables: '' },
  formUrlEncoded: [],
  multipartForm: [],
  file: [],
});

const emptyFolderSettings = (): BrunoFolderSettings => ({
  headers: [],
  auth: { mode: 'inherit', values: {} },
  vars: { req: [], res: [] },
  scripts: { req: '', res: '', tests: '' },
  docs: '',
});

function bruBody(json: any): BrunoBody {
  const body = emptyBody();
  const mode = asString(json.http?.body);
  const data = asObject(json.body);
  switch (mode) {
    case 'json':
    case 'text':
    case 'xml':
    case 'sparql': {
      body.mode = mode;
      body.text = asString(data[mode]);
      break;
    }
    case 'graphql': {
      body.mode = 'graphql';
      body.graphql = { query: asString(data.graphql?.query), variables: asString(data.graphql?.variables) };
      break;
    }
    case 'formUrlEncoded': {
      body.mode = 'formUrlEncoded';
      body.formUrlEncoded = bruKeyValues(data.formUrlEncoded);
      break;
    }
    case 'multipartForm': {
      body.mode = 'multipartForm';
      body.multipartForm = asArray(data.multipartForm).map(part => ({
        name: asString(part.name),
        value: Array.isArray(part.value) ? '' : asString(part.value),
        enabled: part.enabled !== false,
        type: part.type === 'file' ? 'file' : 'text',
        contentType: asString(part.contentType),
        files: Array.isArray(part.value) ? part.value.map(asString) : [],
        ...(part.description ? { description: asString(part.description) } : {}),
      }));
      break;
    }
    case 'file': {
      body.mode = 'file';
      body.file = asArray(data.file).map(file => ({
        filePath: asString(file.filePath),
        contentType: asString(file.contentType),
        selected: file.selected !== false,
      }));
      break;
    }
    default: {
      break;
    }
  }
  return body;
}

function ymlBody(kind: BrunoRequestKind, section: Record<string, any>): BrunoBody {
  const body = emptyBody();
  const data = asObject(section.body);
  if (kind === 'graphql') {
    body.mode = 'graphql';
    body.graphql = { query: asString(data.query), variables: asString(data.variables) };
    return body;
  }
  switch (data.type) {
    case 'json':
    case 'text':
    case 'xml':
    case 'sparql': {
      body.mode = data.type;
      body.text = asString(data.data);
      break;
    }
    case 'form-urlencoded': {
      body.mode = 'formUrlEncoded';
      body.formUrlEncoded = ymlKeyValues(data.data);
      break;
    }
    case 'multipart-form': {
      body.mode = 'multipartForm';
      body.multipartForm = asArray(data.data).map(part => ({
        name: asString(part.name),
        value: part.type === 'file' ? '' : asString(part.value),
        enabled: part.disabled !== true,
        type: part.type === 'file' ? 'file' : 'text',
        contentType: asString(part.contentType),
        files: part.type === 'file' ? asArray(part.value).map(asString) : [],
        ...(part.description ? { description: asText(part.description) } : {}),
      }));
      break;
    }
    case 'file': {
      body.mode = 'file';
      body.file = asArray(data.data).map(file => ({
        filePath: asString(file.filePath),
        contentType: asString(file.contentType),
        selected: file.selected === true,
      }));
      break;
    }
    default: {
      break;
    }
  }
  return body;
}

function bruSettings(raw: unknown): BrunoSettings {
  const settings = asObject(raw);
  return {
    encodeUrl: toBoolean(settings.encodeUrl),
    followRedirects: toBoolean(settings.followRedirects),
    maxRedirects: toNumber(settings.maxRedirects),
    timeout: settings.timeout === 'inherit' ? 'inherit' : toNumber(settings.timeout),
  };
}

const withFallbackName = (name: unknown, relativePath: string, extension: string) =>
  asString(name).trim() || path.posix.basename(relativePath, extension);

export type ParsedRequest = BrunoRequest | { skipped: string; name: string };

function bruRequest(json: any, relativePath: string): ParsedRequest {
  const meta = asObject(json.meta);
  const name = withFallbackName(meta.name, relativePath, '.bru');
  if (meta.type === 'app') {
    return { skipped: 'Bruno apps', name };
  }
  const kind: BrunoRequestKind =
    meta.type === 'graphql' ? 'graphql' : meta.type === 'grpc' ? 'grpc' : meta.type === 'ws' ? 'ws' : 'http';
  const section = asObject(kind === 'grpc' ? json.grpc : kind === 'ws' ? json.ws : json.http);
  const script = asObject(json.script);
  const request: BrunoRequest = {
    kind,
    name,
    seq: toNumber(meta.seq),
    tags: asArray(meta.tags).map(asString),
    description: '',
    docs: asString(json.docs),
    method: kind === 'grpc' ? asString(section.method) : asString(section.method).toUpperCase() || 'GET',
    url: asString(section.url),
    headers: bruKeyValues(kind === 'grpc' ? json.metadata : json.headers),
    params: bruKeyValues(json.params).map((param, index) => ({
      ...param,
      type: asArray(json.params)[index]?.type === 'path' ? ('path' as const) : ('query' as const),
    })),
    auth: bruAuth(section.auth, json.auth, json),
    body: kind === 'grpc' || kind === 'ws' ? emptyBody() : bruBody(json),
    vars: { req: bruVariables(json.vars?.req), res: bruVariables(json.vars?.res) },
    assertions: bruAssertions(json.assertions),
    scripts: {
      req: asString(script.req),
      res: asString(script.res),
      tests: asString(json.tests),
      grpcHooks: GRPC_HOOKS.filter(hook => asString(script[hook]).trim()),
    },
    settings: bruSettings(json.settings),
    exampleCount: asArray(json.examples).length,
    relativePath,
  };
  if (kind === 'grpc') {
    request.grpc = {
      methodType: asString(section.methodType),
      protoPath: asString(section.protoPath),
      messages: asArray(json.body?.grpc).map(message => ({
        name: asString(message.name),
        content: asString(message.content),
      })),
    };
  }
  if (kind === 'ws') {
    request.ws = {
      messages: asArray(json.body?.ws).map(message => ({
        name: asString(message.name),
        type: asString(message.type) || 'text',
        content: asString(message.content),
        selected: message.selected === true,
      })),
    };
  }
  return request;
}

const YML_KINDS: Record<string, BrunoRequestKind> = { http: 'http', graphql: 'graphql', grpc: 'grpc', websocket: 'ws' };

function ymlRequest(doc: any, relativePath: string): ParsedRequest {
  const info = asObject(doc?.info);
  const name = withFallbackName(info.name, relativePath, '.yml');
  const type = asString(info.type);
  if (type === 'script' || type === 'app') {
    return { skipped: type === 'app' ? 'Bruno apps' : 'standalone scripts', name };
  }
  const kind = YML_KINDS[type];
  if (!kind) {
    throw new Error('Invalid item: missing or unknown type');
  }
  const section = asObject(doc[type]);
  const runtime = asObject(doc.runtime);
  const scripts = ymlScripts(runtime.scripts);
  const description = asText(info.description);
  const docs = asText(doc.docs);
  const request: BrunoRequest = {
    kind,
    name,
    seq: toNumber(info.seq),
    tags: asArray(info.tags).map(asString),
    description,
    docs,
    method:
      kind === 'grpc'
        ? asString(section.method)
        : (kind === 'graphql' ? asString(section.method) || 'POST' : asString(section.method) || 'GET').toUpperCase(),
    url: asString(section.url),
    headers: ymlKeyValues(kind === 'grpc' ? section.metadata : section.headers),
    params: ymlKeyValues(section.params).map((param, index) => ({
      ...param,
      type: asArray(section.params)[index]?.type === 'path' ? ('path' as const) : ('query' as const),
    })),
    auth: ymlAuth(section.auth),
    body: kind === 'grpc' || kind === 'ws' ? emptyBody() : ymlBody(kind, section),
    vars: { req: ymlVariables(runtime.variables), res: ymlPostResponseVariables(runtime.actions) },
    assertions: ymlAssertions(runtime.assertions),
    scripts,
    settings: bruSettings(doc.settings),
    exampleCount: asArray(doc.examples).length,
    relativePath,
  };
  if (kind === 'grpc') {
    const message = section.message;
    request.grpc = {
      methodType: asString(section.methodType),
      protoPath: asString(section.protoFilePath),
      messages: Array.isArray(message)
        ? message.map((entry, index) => ({
            name: asString(entry.title) || `message ${index + 1}`,
            content: asString(entry.message),
          }))
        : message
          ? [{ name: '', content: asString(message) }]
          : [],
    };
  }
  if (kind === 'ws') {
    const message = section.message;
    request.ws = {
      messages: Array.isArray(message)
        ? message.map((entry, index) => ({
            name: asString(entry.title) || `message ${index + 1}`,
            type: asString(asObject(entry.message).type) || 'text',
            content: asString(asObject(entry.message).data),
            selected: entry.selected === true,
          }))
        : message
          ? [
              {
                name: '',
                type: asString(asObject(message).type) || 'text',
                content: asString(asObject(message).data),
                selected: true,
              },
            ]
          : [],
    };
  }
  return request;
}

// --- folders, collection and environments ---

function bruFolderSettings(json: any): BrunoFolderSettings {
  const script = asObject(json.script);
  return {
    headers: bruKeyValues(json.headers),
    auth: json.auth?.mode ? bruAuth(json.auth.mode, json.auth, json) : { mode: 'inherit', values: {} },
    vars: { req: bruVariables(json.vars?.req), res: bruVariables(json.vars?.res) },
    scripts: { req: asString(script.req), res: asString(script.res), tests: asString(json.tests) },
    docs: asString(json.docs),
  };
}

function ymlFolderSettings(doc: any): BrunoFolderSettings {
  const request = asObject(doc?.request);
  const scripts = ymlScripts(request.scripts);
  return {
    headers: ymlKeyValues(request.headers),
    auth: request.auth === undefined ? { mode: 'inherit', values: {} } : ymlAuth(request.auth),
    vars: { req: ymlVariables(request.variables), res: ymlPostResponseVariables(request.actions) },
    scripts: { req: scripts.req, res: scripts.res, tests: scripts.tests },
    docs: asText(doc?.docs),
  };
}

function hasCustomProxy(proxy: unknown) {
  const config = asObject(proxy);
  const settings = asObject(config.config ?? config);
  const enabled = 'inherit' in config ? config.inherit === false && config.disabled !== true : config.enabled === true;
  return enabled && asString(settings.hostname).trim() !== '';
}

function environmentFrom(json: any, name: string, relativePath: string, format: BrunoFormat): BrunoEnvironment {
  const extendsFrom = json?.extends;
  return {
    name,
    relativePath,
    variables: asArray(json?.variables).map(variable => ({
      name: asString(variable.name),
      // A secret has no value in the file, Bruno keeps it in its own encrypted store
      value: variable.secret === true ? '' : format === 'yml' ? ymlValue(variable.value) : variable.value,
      enabled: format === 'yml' ? variable.disabled !== true : variable.enabled !== false,
      secret: variable.secret === true,
      ...(variable.description ? { description: asText(variable.description) } : {}),
    })),
    ...(asString(json?.color).trim() ? { color: asString(json.color).trim() } : {}),
    extends: (Array.isArray(extendsFrom) ? extendsFrom : extendsFrom ? [extendsFrom] : []).map(asString),
    hasExternalSecrets: Object.keys(asObject(json?.externalSecrets)).length > 0,
  };
}

interface ReadContext {
  root: string;
  format: BrunoFormat;
  ignore: string[];
  issues: ReportEntry[];
  visited: Set<string>;
}

const isIgnored = (relativePath: string, ignore: string[]) =>
  ignore.some(pattern => {
    const normalized = pattern.replaceAll('\\', '/').replace(/\/+$/, '');
    return normalized !== '' && (relativePath === normalized || relativePath.startsWith(`${normalized}/`));
  });

async function attempt<T>(
  context: ReadContext,
  type: string,
  relativePath: string,
  read: () => Promise<T> | T,
): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    context.issues.push({ reason: 'parse-error', type, name: relativePath, detail: describeError(error) });
    return undefined;
  }
}

async function readFolder(directory: string, relativePath: string, context: ReadContext): Promise<BrunoFolder> {
  const { format } = context;
  const folder: BrunoFolder = {
    name: path.posix.basename(relativePath) || path.basename(context.root),
    relativePath,
    tags: [],
    settings: emptyFolderSettings(),
    folders: [],
    requests: [],
  };

  const folderFile = FOLDER_FILES[format];
  if (await exists(path.join(directory, folderFile))) {
    const folderPath = relativePath ? `${relativePath}/${folderFile}` : folderFile;
    await attempt(context, 'RequestGroup', folderPath, async () => {
      const text = await readText(path.join(directory, folderFile));
      if (format === 'bru') {
        const json = collectionBruToJson(text);
        folder.name = asString(json.meta?.name).trim() || folder.name;
        folder.seq = toNumber(json.meta?.seq);
        folder.tags = asArray(json.meta?.tags).map(asString);
        folder.settings = bruFolderSettings(json);
      } else {
        const doc = asObject(parseYaml(text));
        folder.name = asString(asObject(doc.info).name).trim() || folder.name;
        folder.seq = toNumber(asObject(doc.info).seq);
        folder.tags = asArray(asObject(doc.info).tags).map(asString);
        folder.settings = ymlFolderSettings(doc);
      }
    });
  }

  let entries;
  try {
    entries = await listEntries(directory);
  } catch (error) {
    context.issues.push({
      reason: 'parse-error',
      type: 'RequestGroup',
      name: relativePath || '.',
      detail: describeError(error),
    });
    return folder;
  }

  for (const entry of entries) {
    const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    const kind = await entryKind(directory, entry);
    if (kind === 'directory') {
      const atRoot = relativePath === '';
      if (DENIED_DIRS.has(entry.name) || (atRoot && (entry.name === ENVIRONMENTS_DIR || entry.name === 'mocks'))) {
        continue;
      }
      if (isIgnored(entryPath, context.ignore)) {
        continue;
      }
      let real: string;
      try {
        real = await fs.realpath(path.join(directory, entry.name));
      } catch {
        continue;
      }
      if (context.visited.has(real)) {
        continue;
      }
      context.visited.add(real);
      folder.folders.push(await readFolder(path.join(directory, entry.name), entryPath, context));
    } else if (kind === 'file' && entry.name.toLowerCase().endsWith(EXTENSIONS[format])) {
      const atRoot = relativePath === '';
      const isSpecial =
        entry.name === folderFile ||
        (atRoot && (entry.name === COLLECTION_ROOT_FILES[format] || entry.name === 'collection.yml'));
      if (isSpecial || isIgnored(entryPath, context.ignore)) {
        continue;
      }
      const parsed = await attempt(context, 'Request', entryPath, async () => {
        const text = await readText(path.join(directory, entry.name));
        return format === 'bru' ? bruRequest(bruToJsonV2(text), entryPath) : ymlRequest(parseYaml(text), entryPath);
      });
      if (!parsed) {
        continue;
      }
      if ('skipped' in parsed) {
        context.issues.push({
          reason: 'not-supported',
          type: 'Request',
          name: parsed.name,
          detail: `${parsed.skipped} are not supported`,
        });
      } else {
        folder.requests.push(parsed);
      }
    }
  }
  return folder;
}

async function readEnvironments(context: ReadContext): Promise<BrunoEnvironment[]> {
  const directory = path.join(context.root, ENVIRONMENTS_DIR);
  let entries;
  try {
    entries = await listEntries(directory);
  } catch {
    return [];
  }
  const { format } = context;
  const environments: BrunoEnvironment[] = [];
  for (const entry of entries) {
    if ((await entryKind(directory, entry)) !== 'file' || !entry.name.toLowerCase().endsWith(EXTENSIONS[format])) {
      continue;
    }
    const relativePath = `${ENVIRONMENTS_DIR}/${entry.name}`;
    // Bruno names an environment after its file
    const name = entry.name.slice(0, -EXTENSIONS[format].length);
    const environment = await attempt(context, 'Environment', relativePath, async () => {
      const text = await readText(path.join(directory, entry.name));
      return environmentFrom(format === 'bru' ? bruToEnvJsonV2(text) : parseYaml(text), name, relativePath, format);
    });
    if (environment) {
      environments.push(environment);
    }
  }
  return environments;
}

export async function readBrunoCollection(collectionPath: string): Promise<BrunoCollection> {
  const root = await fs.realpath(collectionPath);
  const format: BrunoFormat = (await exists(path.join(root, OPEN_COLLECTION_FILE))) ? 'yml' : 'bru';
  const context: ReadContext = { root, format, ignore: [], issues: [], visited: new Set([root]) };

  let name = path.basename(root);
  let settings = emptyFolderSettings();
  let clientCertificateCount = 0;
  let protoFileCount = 0;
  let hasProxy = false;

  if (format === 'yml') {
    const doc = await attempt(context, 'Workspace', OPEN_COLLECTION_FILE, async () =>
      asObject(parseYaml(await readText(path.join(root, OPEN_COLLECTION_FILE)))),
    );
    if (doc) {
      name = asString(asObject(doc.info).name).trim() || name;
      context.ignore = asArray(asObject(asObject(doc.extensions).bruno).ignore).map(asString);
      settings = ymlFolderSettings(doc);
      clientCertificateCount = asArray(asObject(doc.config).clientCertificates).length;
      protoFileCount = asArray(asObject(asObject(doc.config).protobuf).protoFiles).length;
      hasProxy = hasCustomProxy(asObject(doc.config).proxy);
    }
  } else {
    const config = await attempt(context, 'Workspace', BRUNO_CONFIG_FILE, async () =>
      asObject(JSON.parse(await readText(path.join(root, BRUNO_CONFIG_FILE)))),
    );
    if (config) {
      name = asString(config.name).trim() || name;
      context.ignore = asArray(config.ignore).map(asString);
      clientCertificateCount = asArray(asObject(config.clientCertificates).certs).length;
      protoFileCount = asArray(asObject(config.protobuf).protoFiles).length;
      hasProxy = hasCustomProxy(config.proxy);
    }
    if (await exists(path.join(root, COLLECTION_ROOT_FILES.bru))) {
      const json = await attempt(context, 'Workspace', COLLECTION_ROOT_FILES.bru, async () =>
        collectionBruToJson(await readText(path.join(root, COLLECTION_ROOT_FILES.bru))),
      );
      if (json) {
        settings = bruFolderSettings(json);
      }
    }
  }

  const tree = await readFolder(root, '', context);
  tree.name = name;
  const environments = await readEnvironments(context);
  return {
    path: root,
    format,
    name,
    settings,
    root: tree,
    environments,
    clientCertificateCount,
    protoFileCount,
    hasProxy,
    issues: context.issues,
  };
}
