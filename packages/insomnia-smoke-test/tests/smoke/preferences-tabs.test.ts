import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const TABS = [
  'Appearance',
  'Editor',
  'Keyboard',
  'Requests',
  'Privacy & Security',
  'Data',
  'Plugins',
  'Credentials',
  'Scripting',
  'AI',
  'About',
];

test('Preferences lists the tabs in order, with About on the far right', async ({ page }) => {
  await page.getByTestId('settings-button').click();
  const modal = page.getByTestId('preference-modal');
  await modal.getByText('Restless Preferences').first().click();

  const tabs = modal.getByRole('tab');
  await expect.soft(tabs).toHaveText(TABS);

  const about = await modal.getByRole('tab', { name: 'About' }).boundingBox();
  const modalBox = await modal.boundingBox();
  expect.soft(about!.x + about!.width).toBeGreaterThan(modalBox!.x + modalBox!.width - 60);
});

test('Settings live in the tab that matches their name', async ({ page }) => {
  await page.getByTestId('settings-button').click();
  const modal = page.getByTestId('preference-modal');
  await modal.getByText('Restless Preferences').first().click();

  const placements: [string, string][] = [
    ['Appearance', 'Interface font'],
    ['Editor', 'Autocomplete popup delay (ms)'],
    ['Keyboard', 'Key map'],
    ['Requests', 'Enable proxy'],
    ['Privacy & Security', 'Reveal passwords'],
    ['Plugins', 'Additional plugin path'],
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
  const modal = page.getByTestId('preference-modal');
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
  const modal = page.getByTestId('preference-modal');
  await expect.soft(modal.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true');
});
