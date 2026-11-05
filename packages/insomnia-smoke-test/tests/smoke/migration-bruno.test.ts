import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { expect } from '@playwright/test';

import { getFixturePath } from '../../playwright/paths';
import { test } from '../../playwright/test';

const source = getFixturePath('bruno-public-apis');

/** Hashes every file below a folder, to prove the migration never changes the source. */
const hashFolder = (folder: string): string => {
  const hash = createHash('sha256');
  const walk = (directory: string) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        hash.update(path.relative(folder, full)).update(fs.readFileSync(full)).update('\0');
      }
    }
  };
  walk(folder);
  return hash.digest('hex');
};

test.describe('migration from Bruno', () => {
  test('imports a collection, then runs its translated scripts', async ({ app, page, insomnia }) => {
    test.setTimeout(120_000);
    const before = hashFolder(source);

    await page.getByRole('button', { name: 'New Project' }).waitFor();

    await insomnia.queueOpenDialogResponse([source]);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach(window => window.webContents.send('open-migration'));
    });

    const modal = page.getByTestId('migration-modal');
    await expect.soft(modal).toHaveAttribute('data-step', 'detect');

    // review: counts, and a secret whose value cannot be read
    await page.getByTestId('migration-choose-bruno').click();
    await expect.soft(modal).toHaveAttribute('data-step', 'review');
    await expect.soft(page.getByTestId('migration-review-title')).toContainText('Public APIs');
    await expect.soft(page.getByTestId('migration-review-counts')).toContainText('6 requests');
    await expect.soft(page.getByTestId('migration-review-issues')).toContainText('api_key');

    // import: the report shows the same counts
    await page.getByTestId('migration-import').click();
    await expect.soft(modal).toHaveAttribute('data-step', 'report');
    await expect.soft(page.getByTestId('migration-report-counts')).toContainText('6 requests');
    await page.getByTestId('migration-done').click();

    await insomnia.navigationSidebar.selectProject('Public APIs');
    await insomnia.navigationSidebar.selectWorkspace('Public APIs');

    // The collection's variables live in the imported Local environment, so pick it like a person would
    await page.getByLabel('Select an API Collection Environment').click();
    await page.getByRole('option', { name: 'Local', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect.soft(page.getByRole('dialog', { name: 'Select an API Collection Environment' })).toBeHidden();

    // a translated pre-request script adds a header, and three translated tests check the response
    await insomnia.navigationSidebar.clickRequestOrFolder('get');
    await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();

    const statusTag = page.locator('[data-testid="response-status-tag"]:visible');
    await expect.soft(statusTag).toContainText('200 OK');

    const responsePane = page.getByTestId('response-pane');
    await responsePane.getByRole('tab', { name: 'Tests' }).click();
    const rows = page.getByTestId('test-result-row');
    await expect.soft(rows).toHaveCount(3);
    await expect.soft(rows.nth(0)).toContainText('PASS');
    await expect.soft(rows.nth(1)).toContainText('PASS');
    await expect.soft(rows.nth(2)).toContainText('PASS');
    await expect.soft(responsePane).toContainText('pre-request header was sent');

    // the second request keeps its JSON body and its 201 assertion
    await insomnia.navigationSidebar.clickRequestOrFolder('create post');
    await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();
    await expect.soft(statusTag).toContainText('201');

    // never written to, even though the source is read twice
    expect.soft(hashFolder(source)).toBe(before);
  });
});
