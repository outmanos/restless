import type { SettingsTabKey } from './components/settings/settings-tabs';
import uiEventBus, { OPEN_SETTINGS } from './event-bus';

export interface OpenSettingsOptions {
  tab?: SettingsTabKey;
  // The name of a setting to scroll to and highlight
  setting?: string;
}

// Opens Preferences as a tab, from anywhere (including code outside React).
// Without a section it returns to the one that was open last.
export const openSettings = (options?: OpenSettingsOptions) => {
  uiEventBus.emit(OPEN_SETTINGS, options);
};
