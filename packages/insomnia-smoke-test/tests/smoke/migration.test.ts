import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const T = 1_700_000_000_000;

const line = (type: string, _id: string, parentId: string | null, fields: Record<string, unknown>) =>
  JSON.stringify({ _id, type, parentId, created: T, modified: T, ...fields }) + '\n';

test.describe('migration', () => {
  let configHome: string;
  let source: string;
  let previousConfigHome: string | undefined;

  test.beforeAll(() => {
    previousConfigHome = process.env.XDG_CONFIG_HOME;
    configHome = mkdtempSync(path.join(tmpdir(), 'restless-smoke-migration-'));
    source = path.join(configHome, 'Insomnia');
    mkdirSync(source);
    process.env.XDG_CONFIG_HOME = configHome;
    writeFileSync(
      path.join(source, 'insomnia.Project.db'),
      line('Project', 'proj_moved', 'org_someone', { name: 'Moved project', remoteId: null }),
    );
    writeFileSync(
      path.join(source, 'insomnia.Workspace.db'),
      line('Workspace', 'wrk_moved', 'proj_moved', { name: 'Moved collection', scope: 'collection' }),
    );
    writeFileSync(
      path.join(source, 'insomnia.Request.db'),
      line('Request', 'req_moved', 'wrk_moved', {
        name: 'Moved request',
        method: 'GET',
        url: 'http://127.0.0.1:4010/echo',
      }),
    );
  });

  test.afterAll(() => {
    if (previousConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = previousConfigHome;
    }
    rmSync(configHome, { recursive: true, force: true });
  });

  test('moves an Insomnia install into restless', async ({ app, page }) => {
    test.skip(process.platform !== 'linux', 'The source folder is found through XDG_CONFIG_HOME');

    await page.getByRole('button', { name: 'New Project' }).waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      // The hidden script window ignores this
      BrowserWindow.getAllWindows().forEach(window => window.webContents.send('open-migration'));
    });

    const modal = page.getByTestId('migration-modal');
    await expect.soft(modal).toHaveAttribute('data-step', 'detect');
    await page.getByTestId('migration-review-insomnia').click();
    await expect.soft(modal).toHaveAttribute('data-step', 'review');

    await page.getByTestId('migration-import').click();
    await expect.soft(modal).toHaveAttribute('data-step', 'report');
    await expect.soft(page.getByTestId('migration-report-counts')).toContainText('1 request');

    await page.getByTestId('migration-done').click();
    await expect.soft(page.getByText('Moved project')).toBeVisible();
  });
});
