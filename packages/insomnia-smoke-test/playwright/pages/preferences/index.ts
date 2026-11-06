import type { ElectronApplication, Locator, Page } from '@playwright/test';

import { PreferencesCredentialsTab } from './credentials-tab';
import { PreferencesDataTab } from './data-tab';

type PreferencesTab = 'Data' | 'General' | 'Themes' | 'Credentials' | 'Plugins' | 'Other';

/**
 * Page Object for the **Restless Preferences** tab.
 *
 * Composes preference tabs:
 * - Data tab (import/export)
 * - Credentials tab (Git credentials management)
 * - Other tabs (themes, plugins, etc.) can be added as needed
 */
export class PreferencesPage {
  /** Data tab (import/export functionality). */
  readonly dataTab: PreferencesDataTab;
  /** Credentials tab (Git credentials management). */
  readonly credentialsTab: PreferencesCredentialsTab;

  constructor(
    readonly page: Page,
    readonly app: ElectronApplication,
  ) {
    this.dataTab = new PreferencesDataTab(page, app);
    this.credentialsTab = new PreferencesCredentialsTab(page, app);
  }

  /** The Preferences page. */
  get root(): Locator {
    return this.page.getByTestId('preferences');
  }

  // ===========================================================================
  // Actions
  // ===========================================================================

  /**
   * Opens a specific tab in the preferences modal.
   * @param tabName - The name of the tab to open (e.g., 'Data', 'General', 'Themes')
   */
  async switchToPreferenceTab(tabName: PreferencesTab): Promise<void> {
    await this.root.getByRole('tab', { name: tabName }).click();
  }

  /**
   * Closes the Preferences tab.
   */
  async closePreferences(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await this.root.waitFor({ state: 'hidden' });
  }
}
