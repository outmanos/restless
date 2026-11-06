import { expect } from '@playwright/test';

import { loadFixture } from '../../playwright/paths';
import { test } from '../../playwright/test';

test('Command palette - can switch between requests and workspaces', async ({ app, page, insomnia }) => {
  test.slow(process.platform === 'darwin' || process.platform === 'win32', 'Slow app start on these platforms');

  // Import a document
  const swaggerDoc = await loadFixture('swagger2.yaml');
  await app.evaluate(async ({ clipboard }, swaggerDoc) => clipboard.writeText(swaggerDoc), swaggerDoc);

  await page.getByLabel('Import').click();
  await page.locator('[data-test-id="import-from-clipboard"]').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByTestId('workspace-breadcrumb-level-0').click();

  // Import a collection
  const text = await loadFixture('smoke-test-collection.yaml');
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), text);

  await page.getByLabel('Import').click();
  await page.locator('[data-test-id="import-from-clipboard"]').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();

  await insomnia.navigationSidebar.clickRequestOrFolder('sends request with cookie and get cookie in response');
  await page.getByTestId('OneLineEditor').getByText('http://127.0.0.1:4010/cookies').click();
  await page.locator('body').press(process.platform === 'darwin' ? 'Meta+p' : 'Control+p');
  await page.getByPlaceholder('Search and switch between').fill('send js');
  await page.getByPlaceholder('Search and switch between').press('ArrowDown');
  await page.getByPlaceholder('Search and switch between').press('Enter');
  await page.getByTestId('OneLineEditor').getByText('http://127.0.0.1:4010/pets/').click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('200 OK').click();

  await page.locator('body').press(process.platform === 'darwin' ? 'Meta+p' : 'Control+p');
  await page.getByPlaceholder('Search and switch between').fill('E2E testing');
  // The new search runs asynchronously via IPC; wait for the result before navigating.
  await page.getByRole('option', { name: /E2E testing/ }).waitFor();
  await page.getByRole('option', { name: /E2E testing/ }).click();
  await expect
    .soft(page.getByTestId('workspace-breadcrumb-level-1').locator('span'))
    .toContainText('E2E testing specification - swagger 2 1.0.0');
});

test('Command palette - the title bar button is just a label and its shortcut', async ({ page }) => {
  const button = page.getByTestId('quick-search');

  await expect.soft(button).toContainText('Search');
  await expect.soft(button).not.toContainText('Search..');
  await expect.soft(button.locator('svg')).toHaveCount(0);
});

test('Command palette - Enter opens the top result without arrowing to it', async ({ app, page, insomnia }) => {
  test.slow(process.platform === 'darwin' || process.platform === 'win32', 'Slow app start on these platforms');

  const swaggerDoc = await loadFixture('swagger2.yaml');
  await app.evaluate(async ({ clipboard }, swaggerDoc) => clipboard.writeText(swaggerDoc), swaggerDoc);
  await page.getByLabel('Import').click();
  await page.locator('[data-test-id="import-from-clipboard"]').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByTestId('workspace-breadcrumb-level-0').click();

  const text = await loadFixture('smoke-test-collection.yaml');
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), text);
  await page.getByLabel('Import').click();
  await page.locator('[data-test-id="import-from-clipboard"]').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();

  await insomnia.navigationSidebar.clickRequestOrFolder('sends request with cookie and get cookie in response');
  const shortcut = process.platform === 'darwin' ? 'Meta+p' : 'Control+p';
  const search = page.getByPlaceholder('Search and switch between');

  // Enter straight after typing, before the debounced search has returned
  await page.locator('body').press(shortcut);
  await search.fill('send js');
  await search.press('Enter');
  await expect.soft(page.getByTestId('OneLineEditor').getByText('http://127.0.0.1:4010/pets/')).toBeVisible();
  await expect.soft(search).toBeHidden();

  // Enter once the results are showing
  await page.locator('body').press(shortcut);
  await search.fill('E2E testing');
  await page.getByRole('option', { name: /E2E testing/ }).waitFor();
  await search.press('Enter');
  await expect
    .soft(page.getByTestId('workspace-breadcrumb-level-1').locator('span'))
    .toContainText('E2E testing specification - swagger 2 1.0.0');

  // Ctrl+Enter (Cmd+Enter on macOS) opens the top result in a new tab instead of replacing the current one,
  // and must not send the request behind the dialog, which is what that shortcut does elsewhere
  const newTabShortcut = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
  const tabs = page.getByTestId('tab-title');
  await insomnia.navigationSidebar.clickRequestOrFolder('sends request with cookie and get cookie in response');
  const tabsBefore = await tabs.count();

  await page.locator('body').press(shortcut);
  await search.fill('send js');
  await search.press(newTabShortcut);
  await expect.soft(tabs).toHaveCount(tabsBefore + 1);
  await expect.soft(page.getByTestId('response-pane').getByTestId('response-status-tag')).toBeHidden();

  // The same with a result that was highlighted with the arrow keys
  await page.locator('body').press(shortcut);
  await search.fill('delayed request');
  // The unfiltered list also contains it, so wait until it is the first row
  await expect.soft(page.getByRole('listbox', { name: 'Commands' }).getByRole('option').first()).toContainText('delayed request');
  await search.press('ArrowDown');
  await search.press(newTabShortcut);
  await expect.soft(tabs).toHaveCount(tabsBefore + 2);
});
