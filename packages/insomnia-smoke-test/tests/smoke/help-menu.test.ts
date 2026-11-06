import { expect, type Page } from '@playwright/test';

import { test } from '../../playwright/test';

interface MenuItem {
  type: string;
  label: string;
  path: number[];
  submenu?: MenuItem[];
}

const readMenu = (page: Page) => page.evaluate(() => window.main.getAppMenu()) as Promise<MenuItem[]>;
const clean = (label: string) => label.replace('&', '').replace(/^(Enable|Disable) Debug Mode$/, 'Debug Mode');
const flatten = (items: MenuItem[]): MenuItem[] => items.flatMap(item => [item, ...flatten(item.submenu ?? [])]);

test.describe('help menu', () => {
  test('groups help, troubleshooting, legal and updates', async ({ page }) => {
    const menu = await readMenu(page);
    const help = menu.find(item => clean(item.label) === 'Help');
    const labels = (help?.submenu ?? []).map(item => (item.type === 'separator' ? '---' : clean(item.label)));

    // On macOS, About, updates and the changelog live in the application menu instead
    const updates = process.platform === 'darwin' ? [] : ['---', 'Check for Updates', 'Changelog', 'About'];
    expect.soft(labels).toEqual([
      'Help and Support',
      'Keyboard Shortcuts',
      '---',
      'Show App Data Folder',
      'Show App Logs Folder',
      'Debug Mode',
      '---',
      'Show Software License',
      'Show Software Bill of Materials',
      ...updates,
    ]);

    if (process.platform === 'darwin') {
      const application = flatten(menu).map(item => clean(item.label));
      expect.soft(application.indexOf('Changelog')).toBe(application.indexOf('Check for Updates') + 1);
    }
  });

  test('every link opens restless, not Kong', async ({ app, page }) => {
    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      shell.openExternal = async url => {
        opened.push(url);
      };
      (globalThis as unknown as { __opened: string[] }).__opened = opened;
    });

    const items = flatten(await readMenu(page));
    const links = ['Help and Support', 'Changelog', 'Show Software License', 'Show Software Bill of Materials'];
    for (const label of links) {
      const item = items.find(candidate => clean(candidate.label) === label);
      expect.soft(item, `a menu item called ${label}`).toBeDefined();
      if (item) {
        await page.evaluate(path => window.main.clickAppMenuItem(path), item.path);
      }
    }

    const opened = await app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened);
    expect.soft(opened).toHaveLength(links.length);
    for (const url of opened) {
      expect.soft(url).toContain('github.com/outmanos/restless');
      expect.soft(url.toLowerCase()).not.toContain('kong');
    }
  });
});
