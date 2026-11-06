import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const TABS = [
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
    ['Appearance', 'Interface font'],
    ['Editor', 'Autocomplete popup delay (ms)'],
    ['Keyboard', 'Key map'],
    ['Requests', 'Enable proxy'],
    ['Security', 'Reveal passwords'],
    ['Plugins', 'Additional plugin path'],
    ['Plugins', 'Open Insomnia web links'],
    ['Scripting', 'Show legacy unit tests'],
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
