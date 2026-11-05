import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { RequestBody, RequestBodyParameter, RequestHeader, RequestParameter } from 'insomnia-data';
import { models } from 'insomnia-data';

import { listExistingProjects, takenNames, uniqueName } from '../project-names';
import type { DetectedSource, MigrationPlan, PlanItem, ReportEntry } from '../types';
import { mapAuthentication } from './auth';
import { buildEnvironment, resolveEnvironmentVariables } from './environment';
import {
  type BrunoAssertion,
  type BrunoCollection,
  type BrunoFolder,
  type BrunoFolderSettings,
  type BrunoKeyValue,
  type BrunoParam,
  type BrunoRequest,
  type BrunoVariable,
  findBrunoCollections,
  readBrunoCollection,
} from './read';
import { convertTemplate, type TemplateIssue } from './template';
import {
  buildAssertionTests,
  buildPostResponseVariables,
  buildPreRequestVariables,
  translateBrunoScript,
} from './translate-script';

/**
 * Turns Bruno collections into migration plans, one plan per collection.
 *
 * Documents come in parent-first order: project, workspace, cookie jar, base environment, environments,
 * folders, proto files, requests. The committer creates nothing of its own, and skips the children of a
 * document that failed, so the base environment and the cookie jar are part of the plan.
 *
 * IDs come from the collection path and the path of each file inside it, so a second run gives the same IDs
 * and the committer sees what is already there.
 */

interface Context {
  collection: BrunoCollection;
  workspaceId: string;
  issues: ReportEntry[];
  issueKeys: Set<string>;
  // Variables that had to be renamed to be stored (see environment.ts), by their Bruno name
  renames: Map<string, string>;
  protoFiles: Map<string, string>;
  protoItems: PlanItem[];
  taggedItems: number;
  examples: number;
}

interface Owner {
  type: string;
  name: string;
}

const MIME = {
  json: 'application/json',
  text: 'text/plain',
  xml: 'application/xml',
  sparql: 'application/sparql-query',
  graphql: 'application/graphql',
  formUrlEncoded: 'application/x-www-form-urlencoded',
  multipart: 'multipart/form-data',
  binary: 'application/octet-stream',
} as const;

const HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
// Bruno's defaults. Only a different value is worth a report.
const DEFAULT_MAX_REDIRECTS = 5;

const sha1 = (value: string) => createHash('sha1').update(value).digest('hex');
const posix = (value: string) => value.split(path.sep).join('/');
const exists = (target: string) =>
  fs.access(target).then(
    () => true,
    () => false,
  );

const idFor = (root: string, prefix: string, kind: string, relativePath = '') =>
  `${prefix}_${sha1([root, kind, relativePath].join('\0'))}`;
const stableId = (context: Context, prefix: string, kind: string, relativePath = '') =>
  idFor(context.collection.path, prefix, kind, relativePath);

const makeItem = (type: string, doc: { name: string } & Record<string, unknown>): PlanItem => ({
  type,
  name: doc.name,
  doc,
});

function report(context: Context, issue: ReportEntry) {
  const key = JSON.stringify(issue);
  if (!context.issueKeys.has(key)) {
    context.issueKeys.add(key);
    context.issues.push(issue);
  }
}

const unsupportedFor = (context: Context, owner: Owner) => (detail: string) =>
  report(context, { reason: 'not-supported', ...owner, detail });

function converter(context: Context, owner: Owner) {
  const onIssue = (issue: TemplateIssue) =>
    unsupportedFor(
      context,
      owner,
    )(`{{${issue.expression}}} has no restless equivalent. It was left as written and will not render.`);
  return (text: string) => convertTemplate(text, onIssue, context.renames);
}

// --- ordering ---

// Ported from usebruno/bruno (MIT, packages/bruno-common/src/collection/index.ts): the order Bruno shows folders in
function sortFolders(folders: BrunoFolder[]): BrunoFolder[] {
  const hasSeq = (folder: BrunoFolder) => Number.isInteger(folder.seq) && folder.seq! > 0;
  const alphabetical = [...folders].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const sorted: (BrunoFolder | BrunoFolder[])[] = alphabetical.filter(folder => !hasSeq(folder));
  for (const folder of alphabetical.filter(hasSeq).sort((a, b) => a.seq! - b.seq!)) {
    const position = folder.seq! - 1;
    const existing = sorted[position];
    const sameSeq = Array.isArray(existing) ? existing[0]?.seq === folder.seq : existing?.seq === folder.seq;
    if (sameSeq) {
      sorted.splice(position, 1, Array.isArray(existing) ? [...existing, folder] : [existing as BrunoFolder, folder]);
    } else {
      sorted.splice(position, 0, folder);
    }
  }
  return sorted.flat();
}

// Bruno lists folders first, then requests by `seq`
const sortRequests = (requests: BrunoRequest[]) =>
  [...requests].sort(
    (a, b) =>
      (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name, 'en') ||
      a.relativePath.localeCompare(b.relativePath, 'en'),
  );

// --- shared mappings ---

function mapHeaders(headers: BrunoKeyValue[], convert: (text: string) => string): RequestHeader[] {
  return headers.map(header => ({
    name: convert(header.name),
    value: convert(header.value),
    ...(header.description ? { description: header.description } : {}),
    ...(header.enabled ? {} : { disabled: true }),
  }));
}

function mapParameters(params: BrunoKeyValue[], convert: (text: string) => string): RequestParameter[] {
  return mapHeaders(params, convert);
}

// Insomnia sends the Content-Type the request carries, so the one the body type implies is written out
function withContentType(headers: RequestHeader[], contentType: string | undefined) {
  if (!contentType || headers.some(header => !header.disabled && header.name.toLowerCase() === 'content-type')) {
    return headers;
  }
  return [{ name: 'Content-Type', value: contentType }, ...headers];
}

const description = (request: BrunoRequest) => [request.description, request.docs].filter(Boolean).join('\n\n');

const joinScripts = (parts: string[]) => parts.filter(part => part.trim() !== '').join('\n\n');

interface ScriptParts {
  preVars?: BrunoVariable[];
  pre: string;
  postVars: BrunoVariable[];
  post: string;
  assertions?: BrunoAssertion[];
  tests: string;
}

/** The pre-request and after-response scripts of a request, folder or collection. Report anything partial. */
function buildScripts(context: Context, owner: Owner, parts: ScriptParts) {
  const unsupported = unsupportedFor(context, owner);
  const partial: string[] = [];
  const translate = (slot: string, script: string) => {
    if (!script.trim()) {
      return '';
    }
    const result = translateBrunoScript(script);
    if (result.partial) {
      partial.push(`${slot}: ${result.leftovers.join(', ')}`);
    }
    return result.code;
  };
  const onIssue = (issue: TemplateIssue) =>
    unsupported(`{{${issue.expression}}} has no restless equivalent. It was left as written and will not render.`);

  const preRequestScript = joinScripts([
    buildPreRequestVariables(parts.preVars ?? [], onIssue),
    translate('pre-request script', parts.pre),
  ]);

  const postVars = buildPostResponseVariables(parts.postVars);
  for (const item of postVars.unsupported) {
    unsupported(`Post-response variable "${item.name}" ${item.reason}, so it was not imported`);
  }
  const assertions = buildAssertionTests(parts.assertions ?? []);
  for (const item of assertions.unsupported) {
    unsupported(`Assertion "${item.name}" ${item.reason}, so it was not imported`);
  }
  const afterResponseScript = joinScripts([
    postVars.code,
    translate('post-response script', parts.post),
    assertions.code,
    translate('tests', parts.tests),
  ]);

  if (partial.length > 0) {
    report(context, { reason: 'script-partly-translated', ...owner, detail: partial.join('; ') });
  }
  return {
    ...(preRequestScript ? { preRequestScript } : {}),
    ...(afterResponseScript ? { afterResponseScript } : {}),
  };
}

async function resolveFile(context: Context, filePath: string, owner: Owner) {
  // A path with a variable in it cannot be checked
  if (filePath.includes('{{')) {
    return filePath;
  }
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(context.collection.path, filePath);
  if (!(await exists(absolute))) {
    report(context, { reason: 'file-missing', ...owner, detail: filePath });
  }
  return absolute;
}

// --- environments ---

function planEnvironments(context: Context): PlanItem[] {
  const { collection, workspaceId } = context;
  const baseId = `${models.environment.prefix}_${sha1(workspaceId)}`;
  const sorted = [...collection.environments].sort((a, b) => a.name.localeCompare(b.name, 'en'));

  const inputs = [
    { id: baseId, name: 'Base Environment', variables: collection.settings.vars.req },
    ...sorted.map(environment => ({
      id: stableId(context, models.environment.prefix, 'environment', environment.relativePath),
      name: environment.name,
      variables: resolveEnvironmentVariables(environment, collection.environments, problem =>
        report(context, {
          reason: 'not-supported',
          type: models.environment.type,
          name: environment.name,
          detail: `Environment ${problem}`,
        }),
      ),
    })),
  ];

  // A request refers to `{{api.url}}` once, whatever environment is selected, so a variable that has to be
  // renamed in one environment is renamed in all of them. The first pass finds those, the second builds.
  const ignore = () => {};
  for (const input of inputs) {
    buildEnvironment(
      {
        environmentId: input.id,
        environmentName: input.name,
        renames: context.renames,
        report: ignore,
        onTemplateIssue: ignore,
      },
      input.variables,
    );
  }
  const built = inputs.map(input =>
    buildEnvironment(
      {
        environmentId: input.id,
        environmentName: input.name,
        renames: context.renames,
        report: issue => report(context, issue),
        onTemplateIssue: issue =>
          unsupportedFor(context, { type: models.environment.type, name: input.name })(
            `{{${issue.expression}}} has no restless equivalent. It was left as written and will not render.`,
          ),
      },
      input.variables,
    ),
  );

  const items = [
    makeItem(models.environment.type, {
      _id: baseId,
      type: models.environment.type,
      parentId: workspaceId,
      name: 'Base Environment',
      environmentType: 'kv',
      data: built[0].data,
      kvPairData: built[0].kvPairData,
      metaSortKey: 0,
    }),
  ];

  sorted.forEach((environment, index) => {
    const { id, variables } = inputs[index + 1];
    const owner = { type: models.environment.type, name: environment.name };
    // The values of secrets live in Bruno's own store, so only the names come across
    for (const variable of variables.filter(candidate => candidate.secret)) {
      report(context, { reason: 'secret-not-readable', ...owner, detail: variable.name });
    }
    if (environment.hasExternalSecrets) {
      unsupportedFor(context, owner)('Secrets from an external provider are not supported');
    }
    const color = environment.color;
    if (color && !HEX_COLOR.test(color)) {
      unsupportedFor(context, owner)(`The color "${color}" is not a hex color, so it was not kept`);
    }
    items.push(
      makeItem(models.environment.type, {
        _id: id,
        type: models.environment.type,
        parentId: baseId,
        name: environment.name,
        environmentType: 'kv',
        data: built[index + 1].data,
        kvPairData: built[index + 1].kvPairData,
        metaSortKey: index + 1,
        ...(color && HEX_COLOR.test(color) ? { color } : {}),
      }),
    );
  });
  return items;
}

// --- folders ---

function groupDocument(
  context: Context,
  base: { _id: string; parentId: string; name: string; metaSortKey: number },
  settings: BrunoFolderSettings,
  // The variables of a collection go to the base environment, so only folders write them as script lines
  writeVariables: boolean,
) {
  const owner = { type: models.requestGroup.type, name: base.name };
  const convert = converter(context, owner);
  const authentication = mapAuthentication(settings.auth, { convert, unsupported: unsupportedFor(context, owner) });
  const headers = mapHeaders(settings.headers, convert);
  const scripts = buildScripts(context, owner, {
    preVars: writeVariables ? settings.vars.req : [],
    pre: settings.scripts.req,
    postVars: settings.vars.res,
    post: settings.scripts.res,
    tests: settings.scripts.tests,
  });
  return makeItem(models.requestGroup.type, {
    ...base,
    type: models.requestGroup.type,
    description: settings.docs,
    environment: {},
    ...(headers.length > 0 ? { headers } : {}),
    ...(authentication ? { authentication } : {}),
    ...scripts,
  });
}

const hasCollectionSettings = (settings: BrunoFolderSettings) =>
  settings.headers.length > 0 ||
  (settings.auth.mode !== 'inherit' && settings.auth.mode !== 'none') ||
  settings.scripts.req.trim() !== '' ||
  settings.scripts.res.trim() !== '' ||
  settings.scripts.tests.trim() !== '' ||
  settings.vars.res.length > 0;

interface Planned {
  folders: PlanItem[];
  requests: PlanItem[];
}

async function planChildren(context: Context, folder: BrunoFolder, parentId: string, planned: Planned) {
  let order = 0;
  for (const child of sortFolders(folder.folders)) {
    const group = groupDocument(
      context,
      {
        _id: stableId(context, models.requestGroup.prefix, 'folder', child.relativePath),
        parentId,
        name: child.name,
        metaSortKey: ++order,
      },
      child.settings,
      true,
    );
    context.taggedItems += child.tags.length > 0 ? 1 : 0;
    planned.folders.push(group);
    await planChildren(context, child, group.doc._id as string, planned);
  }
  for (const request of sortRequests(folder.requests)) {
    planned.requests.push(...(await planRequest(context, request, parentId, ++order)));
  }
}

// --- requests ---

// Index of the first `?` that is not inside {{ }}
function queryStart(url: string) {
  let depth = 0;
  for (let i = 0; i < url.length; i++) {
    if (url.startsWith('{{', i)) {
      depth++;
      i++;
    } else if (url.startsWith('}}', i)) {
      depth = Math.max(0, depth - 1);
      i++;
    } else if (url[i] === '?' && depth === 0) {
      return i;
    }
  }
  return -1;
}

const decode = (value: string) => {
  try {
    return decodeURIComponent(value.replaceAll('+', ' '));
  } catch {
    return value;
  }
};

/**
 * Bruno keeps the query in the URL and in the params table. restless sends both, so the query leaves the
 * URL and the parameters carry it. A pair in the URL that no parameter explains stays, as a parameter.
 */
function mapUrl(rawUrl: string, query: BrunoParam[], convert: (text: string) => string) {
  const parameters = mapParameters(query, convert);
  const start = queryStart(rawUrl);
  if (query.length === 0 || start === -1) {
    return { url: convert(rawUrl), parameters };
  }
  const hash = rawUrl.indexOf('#', start);
  const search = rawUrl.slice(start + 1, hash === -1 ? undefined : hash);
  const known = new Set(
    query.filter(param => param.enabled).map(param => `${decode(param.name)}=${decode(param.value)}`),
  );
  for (const pair of search.split('&').filter(Boolean)) {
    const equals = pair.indexOf('=');
    const name = equals === -1 ? pair : pair.slice(0, equals);
    const value = equals === -1 ? '' : pair.slice(equals + 1);
    if (!known.has(`${decode(name)}=${decode(value)}`)) {
      parameters.push({ name: convert(name), value: convert(value) });
    }
  }
  return { url: convert(rawUrl.slice(0, start) + (hash === -1 ? '' : rawUrl.slice(hash))), parameters };
}

async function mapBody(
  context: Context,
  request: BrunoRequest,
  owner: Owner,
  convert: (text: string) => string,
): Promise<{ body: RequestBody; contentType?: string }> {
  const { body } = request;
  const unsupported = unsupportedFor(context, owner);
  switch (body.mode) {
    case 'json':
    case 'text':
    case 'xml':
    case 'sparql': {
      return { body: { mimeType: MIME[body.mode], text: convert(body.text) }, contentType: MIME[body.mode] };
    }
    case 'graphql': {
      // The variables are written as they are: a {{var}} outside quotes is only valid JSON once it is rendered
      const variables = convert(body.graphql.variables).trim();
      const text = `{"query":${JSON.stringify(convert(body.graphql.query))}${variables ? `,"variables":${variables}` : ''}}`;
      return { body: { mimeType: MIME.graphql, text }, contentType: MIME.json };
    }
    case 'formUrlEncoded': {
      const params: RequestBodyParameter[] = body.formUrlEncoded.map(param => ({
        name: convert(param.name),
        value: convert(param.value),
        ...(param.description ? { description: param.description } : {}),
        ...(param.enabled ? {} : { disabled: true }),
      }));
      return { body: { mimeType: MIME.formUrlEncoded, params }, contentType: MIME.formUrlEncoded };
    }
    case 'multipartForm': {
      const params: RequestBodyParameter[] = [];
      let contentTypes = 0;
      for (const part of body.multipartForm) {
        const common = {
          name: convert(part.name),
          ...(part.description ? { description: part.description } : {}),
          ...(part.enabled ? {} : { disabled: true }),
        };
        contentTypes += part.contentType ? 1 : 0;
        if (part.type === 'file') {
          for (const file of part.files) {
            params.push({ ...common, type: 'file', value: '', fileName: await resolveFile(context, file, owner) });
          }
        } else {
          params.push({ ...common, type: 'text', value: convert(part.value) });
        }
      }
      if (contentTypes > 0) {
        unsupported(`The content type of ${contentTypes} multipart field(s) is not supported`);
      }
      return { body: { mimeType: MIME.multipart, params }, contentType: MIME.multipart };
    }
    case 'file': {
      const chosen = body.file.find(file => file.selected) ?? body.file[0];
      if (!chosen) {
        return { body: {} };
      }
      if (body.file.length > 1) {
        unsupported(`Only the selected file of ${body.file.length} is kept`);
      }
      return {
        body: { mimeType: MIME.binary, fileName: await resolveFile(context, chosen.filePath, owner) },
        contentType: chosen.contentType || MIME.binary,
      };
    }
    default: {
      return { body: {} };
    }
  }
}

function reportUnusedSettings(request: BrunoRequest, unsupported: (detail: string) => void) {
  const { maxRedirects, timeout } = request.settings;
  const unused = [
    ...(maxRedirects !== undefined && maxRedirects !== DEFAULT_MAX_REDIRECTS
      ? [`max redirects (${maxRedirects})`]
      : []),
    ...(typeof timeout === 'number' && timeout > 0 ? [`timeout (${timeout} ms)`] : []),
  ];
  if (unused.length > 0) {
    unsupported(`Per-request ${unused.join(' and ')} is not supported, the app settings apply`);
  }
}

// What a request type with no scripting cannot hold
function reportUnusedRuntime(request: BrunoRequest, label: string, unsupported: (detail: string) => void) {
  const unused = [
    ...(request.scripts.req.trim() || request.scripts.res.trim() ? ['scripts'] : []),
    ...(request.scripts.tests.trim() ? ['tests'] : []),
    ...(request.assertions.length > 0 ? ['assertions'] : []),
    ...(request.vars.req.length > 0 || request.vars.res.length > 0 ? ['variables'] : []),
    ...(request.scripts.grpcHooks.length > 0 ? [`hooks (${request.scripts.grpcHooks.join(', ')})`] : []),
  ];
  if (unused.length > 0) {
    unsupported(`${label} do not support ${unused.join(', ')}. They were not imported.`);
  }
}

async function planRequest(context: Context, request: BrunoRequest, parentId: string, metaSortKey: number) {
  context.taggedItems += request.tags.length > 0 ? 1 : 0;
  context.examples += request.exampleCount;
  switch (request.kind) {
    case 'grpc': {
      return planGrpcRequest(context, request, parentId, metaSortKey);
    }
    case 'ws': {
      return planWebSocketRequest(context, request, parentId, metaSortKey);
    }
    default: {
      return planHttpRequest(context, request, parentId, metaSortKey);
    }
  }
}

async function planHttpRequest(context: Context, request: BrunoRequest, parentId: string, metaSortKey: number) {
  const owner = { type: models.request.type, name: request.name };
  const convert = converter(context, owner);
  const unsupported = unsupportedFor(context, owner);

  const { url, parameters } = mapUrl(
    request.url,
    request.params.filter(param => param.type === 'query'),
    convert,
  );
  const pathParameters = request.params
    .filter(param => param.type === 'path')
    .map(param => ({ name: convert(param.name), value: convert(param.value) }));
  const { body, contentType } = await mapBody(context, request, owner, convert);
  const authentication = mapAuthentication(request.auth, { convert, unsupported }) ?? {};
  const scripts = buildScripts(context, owner, {
    preVars: request.vars.req,
    pre: request.scripts.req,
    postVars: request.vars.res,
    post: request.scripts.res,
    assertions: request.assertions,
    tests: request.scripts.tests,
  });
  reportUnusedSettings(request, unsupported);

  const { followRedirects, encodeUrl } = request.settings;
  return [
    makeItem(models.request.type, {
      _id: stableId(context, models.request.prefix, 'request', request.relativePath),
      type: models.request.type,
      parentId,
      name: request.name,
      description: description(request),
      method: request.method,
      url,
      parameters,
      ...(pathParameters.length > 0 ? { pathParameters } : {}),
      headers: withContentType(mapHeaders(request.headers, convert), contentType),
      body,
      authentication,
      metaSortKey,
      ...(encodeUrl === undefined ? {} : { settingEncodeUrl: encodeUrl }),
      ...(followRedirects === undefined ? {} : { settingFollowRedirects: followRedirects ? 'on' : 'off' }),
      ...scripts,
    }),
  ];
}

// The ID of the proto file document, or an empty string when there is none
async function planProtoFile(context: Context, protoPath: string, owner: Owner): Promise<string> {
  if (!protoPath) {
    return '';
  }
  if (protoPath.includes('{{')) {
    unsupportedFor(context, owner)('A proto file path with a variable in it is not supported');
    return '';
  }
  const absolute = path.isAbsolute(protoPath) ? protoPath : path.resolve(context.collection.path, protoPath);
  const known = context.protoFiles.get(absolute);
  if (known) {
    return known;
  }
  let protoText: string;
  try {
    protoText = await fs.readFile(absolute, 'utf8');
  } catch {
    report(context, { reason: 'file-missing', ...owner, detail: protoPath });
    return '';
  }
  const id = stableId(
    context,
    models.protoFile.prefix,
    'proto',
    posix(path.relative(context.collection.path, absolute)),
  );
  context.protoFiles.set(absolute, id);
  context.protoItems.push(
    makeItem(models.protoFile.type, {
      _id: id,
      type: models.protoFile.type,
      parentId: context.workspaceId,
      name: path.basename(absolute),
      protoText,
    }),
  );
  return id;
}

async function planGrpcRequest(context: Context, request: BrunoRequest, parentId: string, metaSortKey: number) {
  const owner = { type: models.grpcRequest.type, name: request.name };
  const convert = converter(context, owner);
  const unsupported = unsupportedFor(context, owner);
  const [first, ...others] = request.grpc?.messages ?? [];
  if (others.length > 0) {
    unsupported(`restless sends one message, so the other ${others.length} were not imported`);
  }
  if (request.auth.mode !== 'inherit' && request.auth.mode !== 'none') {
    unsupported('Authentication is not supported on gRPC requests');
  }
  reportUnusedRuntime(request, 'gRPC requests', unsupported);
  const protoFileId = await planProtoFile(context, request.grpc?.protoPath ?? '', owner);

  return [
    makeItem(models.grpcRequest.type, {
      _id: stableId(context, models.grpcRequest.prefix, 'request', request.relativePath),
      type: models.grpcRequest.type,
      parentId,
      name: request.name,
      description: description(request),
      url: convert(request.url),
      protoMethodName: request.method,
      body: { text: convert(first?.content ?? '{}') },
      metadata: mapHeaders(request.headers, convert),
      metaSortKey,
      ...(protoFileId ? { protoFileId } : {}),
    }),
  ];
}

const WEBSOCKET_MODES: Record<string, string> = { json: MIME.json, text: MIME.text, xml: MIME.xml };

async function planWebSocketRequest(context: Context, request: BrunoRequest, parentId: string, metaSortKey: number) {
  const owner = { type: models.webSocketRequest.type, name: request.name };
  const convert = converter(context, owner);
  const unsupported = unsupportedFor(context, owner);
  reportUnusedRuntime(request, 'WebSocket requests', unsupported);

  const id = stableId(context, models.webSocketRequest.prefix, 'request', request.relativePath);
  const messages = request.ws?.messages ?? [];
  const chosen = messages.find(message => message.selected) ?? messages[0];
  if (messages.length > 1) {
    unsupported(`restless keeps one message, so the other ${messages.length - 1} were not imported`);
  }

  const items = [
    makeItem(models.webSocketRequest.type, {
      _id: id,
      type: models.webSocketRequest.type,
      parentId,
      name: request.name,
      description: description(request),
      url: convert(request.url),
      headers: mapHeaders(request.headers, convert),
      authentication: mapAuthentication(request.auth, { convert, unsupported }) ?? {},
      parameters: [],
      metaSortKey,
    }),
  ];
  if (chosen) {
    items.push(
      makeItem(models.webSocketPayload.type, {
        _id: stableId(context, models.webSocketPayload.prefix, 'payload', request.relativePath),
        type: models.webSocketPayload.type,
        parentId: id,
        name: chosen.name || 'Message',
        value: convert(chosen.content),
        mode: WEBSOCKET_MODES[chosen.type] ?? MIME.text,
      }),
    );
  }
  return items;
}

// --- collections ---

export async function planCollection(collection: BrunoCollection): Promise<MigrationPlan> {
  const projectId = idFor(collection.path, models.project.prefix, 'project');
  const workspaceId = idFor(collection.path, models.workspace.prefix, 'workspace');
  const context: Context = {
    collection,
    workspaceId,
    issues: [],
    issueKeys: new Set(),
    renames: new Map(),
    protoFiles: new Map(),
    protoItems: [],
    taggedItems: 0,
    examples: 0,
  };

  const items: PlanItem[] = [
    makeItem(models.project.type, {
      _id: projectId,
      type: models.project.type,
      parentId: models.organization.LOCAL_ORGANIZATION_ID,
      name: collection.name,
      remoteId: null,
      gitRepositoryId: null,
      mcpStdioAccess: false,
    }),
    makeItem(models.workspace.type, {
      _id: workspaceId,
      type: models.workspace.type,
      parentId: projectId,
      name: collection.name,
      description: collection.settings.docs,
      scope: models.workspace.WorkspaceScopeKeys.collection,
    }),
    // The same IDs getOrCreateForParentId gives, so the app finds them instead of making another
    makeItem(models.cookieJar.type, {
      _id: `${models.cookieJar.prefix}_${sha1(workspaceId)}`,
      type: models.cookieJar.type,
      parentId: workspaceId,
      name: 'Default Jar',
      cookies: [],
    }),
  ];
  const environments = planEnvironments(context);
  const environmentCount = environments.length - 1;
  items.push(...environments);

  // Settings on the collection itself live in a folder around everything, which is how restless inherits them
  const planned: Planned = { folders: [], requests: [] };
  let parentId = workspaceId;
  if (hasCollectionSettings(collection.settings)) {
    const wrapper = groupDocument(
      context,
      {
        _id: idFor(collection.path, models.requestGroup.prefix, 'collection'),
        parentId: workspaceId,
        name: collection.name,
        metaSortKey: 1,
      },
      collection.settings,
      false,
    );
    planned.folders.push(wrapper);
    parentId = wrapper.doc._id as string;
  }
  await planChildren(context, collection.root, parentId, planned);
  items.push(...planned.folders, ...context.protoItems, ...planned.requests);

  const owner = { type: models.workspace.type, name: collection.name };
  const unsupported = unsupportedFor(context, owner);
  if (collection.clientCertificateCount > 0) {
    unsupported(`${collection.clientCertificateCount} client certificate(s) were not imported`);
  }
  if (collection.protoFileCount > 0) {
    unsupported(
      `${collection.protoFileCount} proto file(s) listed in the collection settings were not imported. Pick a proto file on each gRPC request.`,
    );
  }
  if (collection.hasProxy) {
    unsupported('The proxy settings of the collection were not imported');
  }
  if (context.taggedItems > 0) {
    unsupported(`Tags on ${context.taggedItems} request(s) and folder(s) were not imported`);
  }
  if (context.examples > 0) {
    unsupported(`${context.examples} saved response example(s) were not imported`);
  }

  const requestTypes = new Set<string>([models.request.type, models.grpcRequest.type, models.webSocketRequest.type]);
  const source: DetectedSource = {
    id: `bruno:${collection.path}`,
    kind: 'bruno',
    path: collection.path,
    counts: {
      projects: 1,
      collections: 1,
      requests: items.filter(item => requestTypes.has(item.type)).length,
      environments: environmentCount,
    },
    running: false,
  };
  return { source, items, issues: [...collection.issues, ...context.issues], plugins: [] };
}

/** `folder` is a collection, or a folder with collections in it */
export async function planBruno(folder: string): Promise<MigrationPlan[]> {
  if (!(await fs.stat(folder)).isDirectory()) {
    throw new Error(`${folder} is not a folder`);
  }
  const collectionPaths = await findBrunoCollections(folder);
  const existingProjects = collectionPaths.length ? await listExistingProjects() : [];
  const claimed = new Set<string>();
  const plans: MigrationPlan[] = [];
  for (const collectionPath of collectionPaths) {
    const plan = await planCollection(await readBrunoCollection(collectionPath));
    const project = plan.items[0];
    project.name = uniqueName(project.name, takenNames(existingProjects, claimed, project.doc._id), 'Bruno');
    project.doc.name = project.name;
    claimed.add(project.name);
    plans.push(plan);
  }
  return plans;
}
