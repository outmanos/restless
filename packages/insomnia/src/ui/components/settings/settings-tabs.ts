export const SETTINGS_TAB_KEYS = [
  'general',
  'appearance',
  'editor',
  'keyboard',
  'requests',
  'security',
  'data',
  'plugins',
  'credentials',
  'scripting',
  'ai',
  'about',
] as const;

export type SettingsTabKey = (typeof SETTINGS_TAB_KEYS)[number];

export const DEFAULT_SETTINGS_TAB: SettingsTabKey = 'general';

export const isSettingsTabKey = (value: string | null | undefined): value is SettingsTabKey =>
  SETTINGS_TAB_KEYS.includes(value as SettingsTabKey);
