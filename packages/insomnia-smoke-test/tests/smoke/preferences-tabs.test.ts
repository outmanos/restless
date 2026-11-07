import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const TABS = [
  'General',
  'Appearance',
  'Editor',
  'Keyboard',
  'Requests',
  'Security',
  'Data',
  'Plugins',
  'Credentials',
  'Scripting',
  'AI',
  'About',
];

test('Preferences lists the sections down the left, with About last', async ({ page }) => {
  await page.getByTestId('settings-button').click();
  const modal = page.getByTestId('preferences');
  await modal.waitFor();

  const tabs = modal.getByRole('tab');
  await expect.soft(tabs).toHaveText(TABS);

  // The sections stack vertically on the left, About at the bottom
  const first = await tabs.first().boundingBox();
  const last = await tabs.last().boundingBox();
  expect.soft(last!.y).toBeGreaterThan(first!.y);
  expect.soft(last!.x).toBe(first!.x);
});

test('Settings live in the tab that matches their name', async ({ page }) => {
  await page.getByTestId('settings-button').click();
  const modal = page.getByTestId('preferences');
  await modal.waitFor();

  const placements: [string, string][] = [
    ['General', 'Default collection for new requests'],
    ['General', 'Sidebar focus for collections'],
    ['General', 'Show legacy unit tests'],
    ['General', 'Open Insomnia web links'],
    ['General', 'Number of backups to keep'],
    ['General', 'Export preferences'],
    ['Appearance', 'Interface font'],
    ['Editor', 'Autocomplete popup delay (ms)'],
    ['Keyboard', 'Key map'],
    ['Requests', 'Enable proxy'],
    ['Security', 'Reveal passwords'],
    ['Plugins', 'Additional plugin path'],
  ];
  for (const [tab, setting] of placements) {
    await modal.getByRole('tab', { name: tab }).click();
    await expect.soft(modal.getByText(setting).first(), `${setting} is under ${tab}`).toBeVisible();
  }
});

test('About shows the build, the update settings and copies the details', async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }) => clipboard.writeText(''));
  await page.getByTestId('settings-button').click();
  const modal = page.getByTestId('preferences');
  await modal.getByRole('tab', { name: 'About' }).click();

  await expect.soft(modal.getByTestId('about-details')).toContainText('Electron');
  // The test build is not packaged, so it explains why it cannot update itself.
  await expect.soft(modal.getByText('Updates are off in development builds.')).toBeVisible();

  await modal.getByRole('button', { name: 'Copy details' }).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('Electron:');
});

test('Help, About opens the About tab instead of a native box', async ({ page }) => {
  await page.getByRole('button', { name: 'Help' }).click();
  await page.getByRole('menuitem', { name: /^About/ }).click();
  const modal = page.getByTestId('preferences');
  await expect.soft(modal.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true');
});

test('Preferences opens as a tab in the tab strip and Escape closes it', async ({ page }) => {
  const preferencesTab = page.getByTestId('tab-title').filter({ hasText: 'Preferences' });
  await page.getByTestId('settings-button').click();
  await expect.soft(page.getByTestId('preferences')).toBeVisible();
  await expect.soft(preferencesTab).toBeVisible();
  // It is a tab like any other, so the rest of the app stays around it
  await expect.soft(page.getByRole('grid', { name: 'Project Navigation Tree' })).toBeVisible();

  // Opening it again reuses the same tab
  await page.getByTestId('settings-button').click();
  await expect.soft(preferencesTab).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect.soft(page.getByTestId('preferences')).toBeHidden();
  await expect.soft(preferencesTab).toBeHidden();
});

test('The section is kept in the address so a link can open it', async ({ page }) => {
  await page.getByTestId('settings-button').click();
  await page.getByTestId('preferences').getByRole('tab', { name: 'Requests' }).click();
  await expect.soft(page).toHaveURL(/settings\?tab=requests/);
});

test('Search finds a setting, opens its section and highlights it', async ({ page }) => {
  await page.getByTestId('settings-button').click();
  const search = page.getByTestId('settings-search');
  await search.fill('proxy');
  await expect.soft(page.getByTestId('settings-search-result-httpProxy')).toBeVisible();
  await page.getByTestId('settings-search-result-httpProxy').click();

  const preferences = page.getByTestId('preferences');
  await expect.soft(preferences.getByRole('tab', { name: 'Requests' })).toHaveAttribute('aria-selected', 'true');
  await expect.soft(page.locator('[name="httpProxy"]')).toBeFocused();
  await expect.soft(page.locator('.setting-found')).toHaveCount(1);
  // The search box is cleared, and the address no longer asks for the setting
  await expect.soft(search).toHaveValue('');
  await expect.soft(page).not.toHaveURL(/setting=/);
});

test('Enter in the search box opens the best match, and Escape clears it without closing', async ({ page }) => {
  await page.getByTestId('settings-button').click();
  const search = page.getByTestId('settings-search');
  await search.fill('vim');
  await search.press('Escape');
  await expect.soft(search).toHaveValue('');
  await expect.soft(page.getByTestId('preferences')).toBeVisible();

  await search.fill('vim');
  await search.press('Enter');
  await expect
    .soft(page.getByTestId('preferences').getByRole('tab', { name: 'Keyboard' }))
    .toHaveAttribute('aria-selected', 'true');
});

test('Ctrl+Shift+P opens the palette in command mode and finds commands and settings', async ({ page }) => {
  await page.locator('body').press('Control+Shift+P');
  const input = page.getByPlaceholder('Type a command or the name of a setting');
  await expect.soft(input).toHaveValue('>');
  await expect.soft(page.getByRole('option', { name: /Open Preferences/ })).toBeVisible();

  await input.fill('> keyboard');
  await expect.soft(page.getByRole('option', { name: /Open Keyboard Shortcuts/ })).toBeVisible();
  await input.press('Enter');
  await expect
    .soft(page.getByTestId('preferences').getByRole('tab', { name: 'Keyboard' }))
    .toHaveAttribute('aria-selected', 'true');
});

test('A setting found in command mode opens at that setting', async ({ page }) => {
  await page.locator('body').press('Control+Shift+P');
  const input = page.getByPlaceholder('Type a command or the name of a setting');
  await input.fill('> interface font');
  await page.getByRole('option', { name: /Interface font$/ }).first().click();
  await expect
    .soft(page.getByTestId('preferences').getByRole('tab', { name: 'Appearance' }))
    .toHaveAttribute('aria-selected', 'true');
  await expect.soft(page.locator('[name="fontInterface"]')).toBeFocused();
});

test('Ctrl+P is still the plain search', async ({ page }) => {
  await page.locator('body').press('Control+p');
  await expect.soft(page.getByPlaceholder('Search and switch between')).toBeVisible();
});

test('General has the preferences file and backups, and Data has the folders', async ({ app, page }) => {
  await page.getByTestId('settings-button').click();
  const preferences = page.getByTestId('preferences');

  // Preferences file: a complete export is opt in
  await expect.soft(page.getByTestId('export-preferences')).toBeVisible();
  await expect.soft(page.getByTestId('import-preferences')).toBeVisible();
  await expect.soft(page.getByTestId('export-complete').getByRole('checkbox')).not.toBeChecked();

  // Backups: how many to keep, back up now, and pick one to restore
  await expect.soft(page.locator('[name="maxBackups"]')).toHaveValue('10');
  await expect.soft(page.getByTestId('restore-backup')).toBeVisible();
  await page.getByTestId('backup-now').click();
  await expect.soft(page.getByTestId('backup-count')).toContainText('1 saved, keeping the last 10');

  // Data: the folders open directly, not just show in the file manager
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    shell.openPath = async folder => {
      opened.push(folder);
      return '';
    };
    (globalThis as unknown as { __openedFolders: string[] }).__openedFolders = opened;
  });
  await preferences.getByRole('tab', { name: 'Data' }).click();
  await page.getByTestId('open-data-folder').click();
  await page.getByTestId('open-logs-folder').click();
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { __openedFolders: string[] }).__openedFolders.length))
    .toBe(2);
});

test('Appearance has the accent color under its own heading, below the themes', async ({ page }) => {
  await page.getByTestId('settings-button').click();
  await page.getByTestId('preferences').getByRole('tab', { name: 'Appearance' }).click();
  await expect.soft(page.getByRole('heading', { name: 'Accent color' })).toBeVisible();
  const headings = await page.getByTestId('preferences').getByRole('heading', { level: 2 }).allTextContents();
  expect.soft(headings.slice(0, 3)).toEqual(['Theme', 'Accent color', 'Fonts']);
  await expect.soft(page.getByRole('button', { name: 'Violet' })).toBeVisible();
});

test('The plugins note is left aligned with a ! at the start', async ({ page }) => {
  await page.getByTestId('settings-button').click();
  await page.getByTestId('preferences').getByRole('tab', { name: 'Plugins' }).click();
  const note = page.getByTestId('plugins-note');
  await expect.soft(note).toContainText('Plugins are built and maintained by third-party developers');
  await expect.soft(note).toHaveCSS('text-align', 'left');
  await expect.soft(note.locator('[aria-hidden="true"]').first()).toHaveText('!');
});
