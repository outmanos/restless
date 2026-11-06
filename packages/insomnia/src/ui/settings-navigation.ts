import type { SettingsTabKey } from './components/settings/preferences';
import uiEventBus, { OPEN_SETTINGS } from './event-bus';

// Opens Preferences as a tab, from anywhere (including code outside React).
// Without a section it returns to the one that was open last.
export const openSettings = (options?: { tab?: SettingsTabKey }) => {
  uiEventBus.emit(OPEN_SETTINGS, options?.tab);
};
