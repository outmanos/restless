import type { ReportReason, SourceKind } from '~/main/migration/types';

// Source apps are only ever named as plain text.
const SOURCE_LABELS: Record<SourceKind, string> = {
  insomnia: 'Insomnia',
  insomnium: 'Insomnium',
  bruno: 'Bruno',
};

export const sourceLabel = (kind: string): string =>
  Object.hasOwn(SOURCE_LABELS, kind) ? SOURCE_LABELS[kind as SourceKind] : kind;

export interface ReasonInfo {
  title: string;
  hint: string;
}

// The same words are used before the import (the plan) and after it (the report),
// so the hints say what happens in the present tense.
export const REASON_INFO: Record<ReportReason, ReasonInfo> = {
  'parse-error': {
    title: 'Could not read',
    hint: 'These could not be read or saved, so they are skipped. The detail says why.',
  },
  'git-project': {
    title: 'Git projects',
    hint: "Not copied. Use File > Open Folder… and pick the project's folder.",
  },
  'cloud-only': {
    title: 'Cloud only',
    hint: 'These projects only exist in the cloud. There is nothing on this computer to copy.',
  },
  'secret-not-readable': {
    title: 'Secrets not copied',
    hint: 'These are locked with a key restless does not have. Enter them again in restless.',
  },
  'script-partly-translated': {
    title: 'Scripts to check',
    hint: 'Part of the script could not be converted. The original is kept as a comment at the top.',
  },
  'not-supported': {
    title: 'Not supported yet',
    hint: 'restless has no match for these, so they are not converted.',
  },
  'file-missing': {
    title: 'File not found',
    hint: 'The file these point to is not on this computer. Check the path.',
  },
  'unknown-model': {
    title: 'Unknown data',
    hint: 'restless does not know this kind of data, so it is skipped.',
  },
  'already-imported': {
    title: 'Already in restless',
    hint: 'Skipped so nothing is overwritten.',
  },
};

// Groups are shown in this order: things that need action first, bookkeeping last.
export const REASON_ORDER: readonly ReportReason[] = [
  'parse-error',
  'git-project',
  'cloud-only',
  'secret-not-readable',
  'script-partly-translated',
  'not-supported',
  'file-missing',
  'unknown-model',
  'already-imported',
];

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// "SomeModelType" and "some-reason" both become "some model type" and "some reason".
const toWords = (name: string) =>
  name
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replaceAll(/[-_]+/g, ' ')
    .trim()
    .toLowerCase();

// A reason the UI does not know yet still gets a group, so nothing is dropped silently.
export const reasonInfo = (reason: string): ReasonInfo =>
  Object.hasOwn(REASON_INFO, reason)
    ? REASON_INFO[reason as ReportReason]
    : { title: capitalize(toWords(reason)) || 'Other', hint: '' };

interface TypeLabel {
  type: string;
  singular: string;
  plural: string;
}

// Display order of the counts. A workspace is an API collection in the rest of the app.
const TYPE_LABELS: readonly TypeLabel[] = [
  { type: 'Project', singular: 'project', plural: 'projects' },
  { type: 'Workspace', singular: 'collection', plural: 'collections' },
  { type: 'RequestGroup', singular: 'folder', plural: 'folders' },
  { type: 'Request', singular: 'request', plural: 'requests' },
  { type: 'GrpcRequest', singular: 'gRPC request', plural: 'gRPC requests' },
  { type: 'WebSocketRequest', singular: 'WebSocket request', plural: 'WebSocket requests' },
  { type: 'SocketIORequest', singular: 'Socket.IO request', plural: 'Socket.IO requests' },
  { type: 'McpRequest', singular: 'MCP request', plural: 'MCP requests' },
  { type: 'WebSocketPayload', singular: 'saved WebSocket message', plural: 'saved WebSocket messages' },
  { type: 'SocketIOPayload', singular: 'saved Socket.IO message', plural: 'saved Socket.IO messages' },
  { type: 'McpPayload', singular: 'saved MCP message', plural: 'saved MCP messages' },
  { type: 'Environment', singular: 'environment', plural: 'environments' },
  { type: 'CookieJar', singular: 'cookie jar', plural: 'cookie jars' },
  { type: 'ApiSpec', singular: 'API spec', plural: 'API specs' },
  { type: 'MockServer', singular: 'mock server', plural: 'mock servers' },
  { type: 'MockRoute', singular: 'mock route', plural: 'mock routes' },
  { type: 'ProtoDirectory', singular: 'proto folder', plural: 'proto folders' },
  { type: 'ProtoFile', singular: 'proto file', plural: 'proto files' },
  { type: 'UnitTestSuite', singular: 'test suite', plural: 'test suites' },
  { type: 'UnitTest', singular: 'test', plural: 'tests' },
  { type: 'ClientCertificate', singular: 'client certificate', plural: 'client certificates' },
  { type: 'CaCertificate', singular: 'CA certificate', plural: 'CA certificates' },
  { type: 'PluginData', singular: 'plugin data record', plural: 'plugin data records' },
];

const TYPE_LABEL_BY_TYPE = new Map(TYPE_LABELS.map(label => [label.type, label]));
const TYPE_POSITION = new Map(TYPE_LABELS.map((label, index) => [label.type, index]));

export const typePosition = (type: string): number => TYPE_POSITION.get(type) ?? Number.MAX_SAFE_INTEGER;

export const typeLabel = (type: string, count = 1): string => {
  const known = TYPE_LABEL_BY_TYPE.get(type);
  if (known) {
    return count === 1 ? known.singular : known.plural;
  }
  const words = toWords(type) || 'item';
  return count === 1 ? words : `${words}s`;
};

// Models that only hold view state, such as which folder is open. They are counted
// together instead of one row each.
export const isSupportingType = (type: string): boolean => type.endsWith('Meta');

// Left out of the copy on purpose, listed once instead of per item.
export const QUIET_SKIPS_NOTE =
  'Not copied on purpose: app settings, usage stats, sign-in sessions, saved responses, request versions and test results.';
