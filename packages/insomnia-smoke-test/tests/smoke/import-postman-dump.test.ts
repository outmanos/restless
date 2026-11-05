import { expect } from '@playwright/test';

import { getFixturePath } from '../../playwright/paths';
import { test } from '../../playwright/test';

// A real dump exported from Postman: 7 collections and 6 environments in one zip
const dump = getFixturePath('import/postman-data-dump.zip');

test.describe('import a Postman data dump', () => {
  test('moves every collection and environment out of the zip', async ({ page, insomnia }) => {
    test.setTimeout(120_000);
    await page.getByRole('button', { name: 'New Project' }).waitFor();

    await page.getByLabel('Import').click();
    await page.locator('[data-test-id="import-from-file"]').click();
    await page.locator('[data-test-id="import-file-input"]').setInputFiles(dump);
    await page.getByRole('button', { name: 'Scan' }).click();

    // The scan reads each file in the archive and names the zip it came from
    const dialog = page.getByRole('dialog', { name: 'Modal' });
    await expect.soft(dialog).toContainText('Postman resources to be imported from', { timeout: 30_000 });
    await expect.soft(dialog).toContainText('in postman-data-dump.zip');
    await expect.soft(dialog).toContainText('41 Requests');

    await dialog.getByRole('button', { name: /Import$/ }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 60_000 });

    // Every collection becomes a workspace, and so does every environment
    await expect.soft(insomnia.navigationSidebar.workspaceRow('Device Collection')).toHaveCount(1);
    await expect.soft(insomnia.navigationSidebar.workspaceRow('GetSubscriberIdAPI')).toHaveCount(1);
    await expect.soft(insomnia.navigationSidebar.workspaceRow('Project2Env1')).toHaveCount(1);
    await expect.soft(insomnia.navigationSidebar.workspaceRow('GlobalSubEnv4')).toHaveCount(1);
  });
});
