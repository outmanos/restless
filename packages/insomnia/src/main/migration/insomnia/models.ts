// What the migration does with each model type. The data file for a type is `insomnia.<Type>.db`, which is
// how packages/insomnia-data/node-src/database/database-nedb.ts names them. A test checks this table against
// `models.types()`, so a model added later cannot slip through unhandled.

// Moved to restless. Parents come before children, and siblings are planned in this order.
export const IMPORTED_TYPES = [
  'Project',
  'ProjectLintRuleset',
  'Workspace',
  'WorkspaceMeta',
  'Environment',
  'CookieJar',
  'ApiSpec',
  'MockServer',
  'MockRoute',
  'ClientCertificate',
  'CaCertificate',
  'ProtoDirectory',
  'ProtoFile',
  'UnitTestSuite',
  'UnitTest',
  'RequestGroup',
  'RequestGroupMeta',
  'Request',
  'RequestMeta',
  'GrpcRequest',
  'GrpcRequestMeta',
  'WebSocketRequest',
  'WebSocketRequestMeta',
  'WebSocketPayload',
  'SocketIORequest',
  'SocketIORequestMeta',
  'SocketIOPayload',
  'McpRequest',
  'McpPayload',
  'PluginData',
] as const;

// Skipped, and reported as `git-project`
export const GIT_TYPES = ['GitRepository'] as const;

// Skipped, and reported as `secret-not-readable`
export const SECRET_TYPES = ['GitCredentials', 'CloudCredential', 'OAuth2Token'] as const;

// Skipped without a report entry per item: app state, history and cached output. The report lists these once.
export const QUIET_TYPES = [
  'Settings',
  'Stats',
  'UserSession',
  'Response',
  'WebSocketResponse',
  'SocketIOResponse',
  'McpResponse',
  'RequestVersion',
  'UnitTestResult',
  'RunnerTestResult',
] as const;

export const REQUEST_TYPES = ['Request', 'GrpcRequest', 'WebSocketRequest', 'SocketIORequest', 'McpRequest'] as const;

const imported = new Set<string>(IMPORTED_TYPES);
const secret = new Set<string>(SECRET_TYPES);
const known = new Set<string>([...IMPORTED_TYPES, ...GIT_TYPES, ...SECRET_TYPES, ...QUIET_TYPES]);

export const isImportedType = (type: string) => imported.has(type);
export const isSecretType = (type: string) => secret.has(type);
export const isKnownType = (type: string) => known.has(type);
export const allKnownTypes = () => [...known];

// Position among siblings, so a workspace lists its environment before its folders and requests
const rank = new Map<string, number>(IMPORTED_TYPES.map((type, index) => [type, index]));
export const typeRank = (type: string) => rank.get(type) ?? IMPORTED_TYPES.length;

export const dbFileName = (type: string) => `insomnia.${type}.db`;

const DB_FILE_NAME = /^insomnia\.([\w-]+)\.db$/;
export const typeOfDbFile = (fileName: string): string | null => DB_FILE_NAME.exec(fileName)?.[1] ?? null;
