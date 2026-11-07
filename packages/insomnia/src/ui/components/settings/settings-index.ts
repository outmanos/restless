import type { SettingsTabKey } from './settings-tabs';

// Every setting a person might look for, with the tab it lives in. Powers the search box in Preferences and the
// settings in the command palette. `key` is the setting's name, which is also how the control is found on the page.
export interface SettingsIndexEntry {
  key: string;
  label: string;
  tab: SettingsTabKey;
  // Other words someone might type
  keywords?: string[];
}

export const SETTINGS_INDEX: SettingsIndexEntry[] = [
  {
    key: 'newRequestCollection',
    label: 'Default collection for new requests',
    tab: 'general',
    keywords: ['plus', 'new'],
  },
  {
    key: 'sidebarFocusForCollections',
    label: 'Sidebar focus for collections',
    tab: 'general',
    keywords: ['navigation'],
  },
  { key: 'enableLegacyUnitTests', label: 'Show legacy unit tests', tab: 'general', keywords: ['tests tab'] },
  {
    key: 'handleInsomniaLinks',
    label: 'Open Insomnia web links',
    tab: 'general',
    keywords: ['insomnia://', 'deep link'],
  },

  { key: 'accentColor', label: 'Accent color', tab: 'appearance', keywords: ['theme', 'color', 'highlight'] },
  {
    key: 'autoDetectColorScheme',
    label: 'Use OS color scheme',
    tab: 'appearance',
    keywords: ['dark', 'light', 'theme'],
  },
  { key: 'fontInterface', label: 'Interface font', tab: 'appearance', keywords: ['typeface'] },
  { key: 'fontSize', label: 'Interface font size', tab: 'appearance', keywords: ['text size'] },
  { key: 'fontMonospace', label: 'Text editor font', tab: 'appearance', keywords: ['monospace', 'code font'] },
  { key: 'editorFontSize', label: 'Editor font size', tab: 'appearance', keywords: ['text size'] },
  { key: 'fontVariantLigatures', label: 'Font ligatures', tab: 'appearance' },
  { key: 'forceVerticalLayout', label: 'Use vertical layout', tab: 'appearance', keywords: ['panes', 'stack'] },

  { key: 'editorIndentWithTabs', label: 'Indent with tabs', tab: 'editor', keywords: ['spaces'] },
  { key: 'editorLineWrapping', label: 'Wrap text editor lines', tab: 'editor', keywords: ['word wrap'] },
  { key: 'editorIndentSize', label: 'Editor indent size', tab: 'editor', keywords: ['tab width'] },
  { key: 'autocompleteDelay', label: 'Autocomplete popup delay', tab: 'editor', keywords: ['suggestions'] },
  { key: 'useBulkHeaderEditor', label: 'Use bulk header editor', tab: 'editor', keywords: ['headers'] },
  { key: 'nunjucksPowerUserMode', label: 'Raw template syntax', tab: 'editor', keywords: ['nunjucks', 'tags'] },
  {
    key: 'showVariableSourceAndValue',
    label: 'Template tags show variable source and value',
    tab: 'editor',
    keywords: ['variables', 'environment'],
  },

  { key: 'editorKeyMap', label: 'Text editor key map', tab: 'keyboard', keywords: ['vim', 'emacs', 'sublime'] },
  {
    key: 'enableKeyMapForInlineTextEditors',
    label: 'Use the key map in one-line editors',
    tab: 'keyboard',
    keywords: ['vim', 'headers', 'url'],
  },

  { key: 'followRedirects', label: 'Follow redirects', tab: 'requests' },
  { key: 'validateSSL', label: 'Validate certificates', tab: 'requests', keywords: ['ssl', 'tls', 'https'] },
  { key: 'preferredHttpVersion', label: 'Preferred HTTP version', tab: 'requests', keywords: ['http2', 'http/1.1'] },
  { key: 'maxRedirects', label: 'Maximum redirects', tab: 'requests' },
  { key: 'timeout', label: 'Request timeout', tab: 'requests', keywords: ['milliseconds'] },
  { key: 'proxyEnabled', label: 'Enable proxy', tab: 'requests', keywords: ['network', 'socks'] },
  { key: 'proxyScope', label: 'Use proxy for', tab: 'requests' },
  { key: 'httpProxy', label: 'Proxy for HTTP', tab: 'requests' },
  { key: 'httpsProxy', label: 'Proxy for HTTPS', tab: 'requests' },
  { key: 'noProxy', label: 'No proxy', tab: 'requests', keywords: ['bypass', 'exclude hosts'] },
  { key: 'filterResponsesByEnv', label: 'Filter responses by environment', tab: 'requests', keywords: ['history'] },
  { key: 'maxHistoryResponses', label: 'Response history limit', tab: 'requests', keywords: ['keep'] },
  { key: 'maxTimelineDataSizeKB', label: 'Max timeline chunk size', tab: 'requests' },

  { key: 'showPasswords', label: 'Reveal passwords', tab: 'security', keywords: ['show', 'mask'] },
  {
    key: 'hideSecretValuesInPreviewAndConsole',
    label: 'Hide Confidential values in Preview/Console',
    tab: 'security',
    keywords: ['secrets', 'redact'],
  },
  { key: 'clearOAuth2SessionOnRestart', label: 'Clear OAuth 2 session on start', tab: 'security' },
  { key: 'validateAuthSSL', label: 'Validate certificates during authentication', tab: 'security' },
  {
    key: 'dataFolders',
    label: 'What folders can restless access',
    tab: 'security',
    keywords: ['allow list', 'files', 'paths'],
  },
  { key: 'disableHtmlPreviewJs', label: 'Disable JS in HTML preview', tab: 'security' },
  { key: 'disableResponsePreviewLinks', label: 'Disable links in response viewer', tab: 'security' },

  { key: 'pluginPath', label: 'Additional plugin path', tab: 'plugins', keywords: ['folder', 'directory'] },
  { key: 'npmRegistryUrl', label: 'npm registry', tab: 'plugins', keywords: ['install'] },

  { key: 'scriptSandboxEnabled', label: 'Script sandbox', tab: 'scripting', keywords: ['security'] },

  {
    key: 'export-preferences',
    label: 'Export preferences to a JSON file',
    tab: 'data',
    keywords: ['save', 'settings', 'backup', 'json'],
  },
  {
    key: 'import-preferences',
    label: 'Import preferences from a JSON file',
    tab: 'data',
    keywords: ['load', 'settings', 'restore', 'json'],
  },
  { key: 'backup-now', label: 'Back up now', tab: 'data', keywords: ['backups', 'restore', 'copy'] },
  { key: 'data-folder-path', label: 'Data folder location', tab: 'data', keywords: ['where', 'files', 'disk', 'size'] },

  { key: 'aiFeatures', label: 'Enable AI features', tab: 'ai', keywords: ['llm', 'claude', 'openai', 'gemini'] },

  { key: 'updateAutomatically', label: 'Automatic updates', tab: 'about', keywords: ['update', 'download'] },
  { key: 'updateCheckOnStartup', label: 'Check for updates on startup', tab: 'about', keywords: ['update'] },
  { key: 'updateCheckInterval', label: 'Check for updates every', tab: 'about', keywords: ['update', 'frequency'] },
  { key: 'updateChannel', label: 'Update channel', tab: 'about', keywords: ['beta', 'pre-release', 'stable'] },
];

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9/:.]+/g, ' ')
    .trim();

// Every typed word has to appear somewhere in the label, keywords or key. Label matches rank first, and
// earlier words in the label beat later ones.
export const searchSettings = (query: string, index: SettingsIndexEntry[] = SETTINGS_INDEX): SettingsIndexEntry[] => {
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) {
    return [];
  }
  const scored = index.flatMap(entry => {
    const label = normalize(entry.label);
    const rest = normalize([...(entry.keywords ?? []), entry.key].join(' '));
    let score = 0;
    for (const word of words) {
      const inLabel = label.indexOf(word);
      if (inLabel !== -1) {
        // A word at the start of the label or of a label word counts most
        score += inLabel === 0 || label[inLabel - 1] === ' ' ? 3 : 2;
      } else if (rest.includes(word)) {
        score += 1;
      } else {
        return [];
      }
    }
    return [{ entry, score }];
  });
  return scored.sort((a, b) => b.score - a.score).map(item => item.entry);
};
