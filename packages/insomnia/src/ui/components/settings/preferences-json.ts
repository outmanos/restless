// Preferences as a JSON file a person can keep, edit by hand, or carry to another computer.
export const PREFERENCES_FORMAT = 'restless-preferences';
const PREFERENCES_VERSION = 1;

// What stays out of the file. Some of it is private (proxy addresses can carry a password, plugin settings can hold
// tokens), some belongs to this computer (folders, device id), and some is only a record of what was shown here.
const LEFT_OUT = new Set([
  '_id',
  'type',
  'parentId',
  'name',
  'created',
  'modified',
  'isPrivate',
  'metaSortKey',
  'deviceId',
  'hasReadInstallerUpdateChoice',
  'hasSeenSidebarFocusOnboarding',
  'hasSeenMigrationOffer',
  'httpProxy',
  'httpsProxy',
  'noProxy',
  'pluginConfig',
  'pluginPath',
  'pluginNodeExtraCerts',
  'npmRegistryUrl',
  'dataFolders',
  'gitHubClientId',
  'gitLabClientId',
]);

export interface PreferencesFile {
  format: typeof PREFERENCES_FORMAT;
  version: number;
  exportedAt: string;
  // The app version that wrote it, for anyone reading the file
  app: string;
  settings: Record<string, unknown>;
}

export const buildPreferencesFile = (
  settings: Record<string, unknown>,
  defaults: Record<string, unknown>,
  appVersion: string,
  now = new Date(),
): PreferencesFile => ({
  format: PREFERENCES_FORMAT,
  version: PREFERENCES_VERSION,
  exportedAt: now.toISOString(),
  app: appVersion,
  settings: Object.fromEntries(
    Object.keys(defaults)
      .filter(key => !LEFT_OUT.has(key) && key in settings && settings[key] !== undefined)
      .sort()
      .map(key => [key, settings[key]]),
  ),
});

const isKeyCombination = (value: unknown) =>
  typeof value === 'object' && value !== null && typeof (value as { keyCode?: unknown }).keyCode === 'number';

const isPlatformKeys = (value: unknown) => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { macKeys, winLinuxKeys } = value as { macKeys?: unknown; winLinuxKeys?: unknown };
  return (
    Array.isArray(macKeys) &&
    Array.isArray(winLinuxKeys) &&
    macKeys.every(isKeyCombination) &&
    winLinuxKeys.every(isKeyCombination)
  );
};

// Does a value have the kind of value the setting has by default? A default of null stands for text that can be empty.
const sameKind = (value: unknown, fallback: unknown) => {
  if (fallback === null) {
    return value === null || typeof value === 'string';
  }
  if (Array.isArray(fallback)) {
    return Array.isArray(value);
  }
  return typeof value === typeof fallback && value !== null;
};

export interface PreferencesImport {
  // What would be applied
  settings: Record<string, unknown>;
  skipped: { key: string; reason: string }[];
}

export const parsePreferencesFile = (
  text: string,
  defaults: Record<string, unknown>,
): PreferencesImport | { error: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'That file is not valid JSON.' };
  }
  const file = parsed as Partial<PreferencesFile> | null;
  if (!file || file.format !== PREFERENCES_FORMAT || typeof file.settings !== 'object' || file.settings === null) {
    return { error: 'That file was not exported from restless preferences.' };
  }
  if (typeof file.version === 'number' && file.version > PREFERENCES_VERSION) {
    return { error: 'That file comes from a newer version of restless. Update restless and try again.' };
  }

  const settings: Record<string, unknown> = {};
  const skipped: PreferencesImport['skipped'] = [];
  for (const [key, value] of Object.entries(file.settings)) {
    if (LEFT_OUT.has(key) || !(key in defaults)) {
      skipped.push({ key, reason: 'not a preference restless knows' });
    } else if (key === 'hotKeyRegistry') {
      const known = defaults.hotKeyRegistry as Record<string, unknown>;
      const registry: Record<string, unknown> = {};
      for (const [name, keys] of Object.entries((value ?? {}) as Record<string, unknown>)) {
        if (name in known && isPlatformKeys(keys)) {
          registry[name] = keys;
        } else {
          skipped.push({ key: `hotKeyRegistry.${name}`, reason: 'not a shortcut restless knows' });
        }
      }
      if (Object.keys(registry).length) {
        settings.hotKeyRegistry = registry;
      }
    } else if (sameKind(value, defaults[key])) {
      settings[key] = value;
    } else {
      skipped.push({ key, reason: 'the wrong kind of value' });
    }
  }
  return { settings, skipped };
};
