import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('Right-clicking selected text does not offer a web search', async ({ app, page }) => {
  // The menu is native, so Playwright cannot see it. Record the items it is built from instead, and do not show it.
  await app.evaluate(({ Menu }) => {
    const shown: string[][] = [];
    const build = Menu.buildFromTemplate.bind(Menu);
    Menu.buildFromTemplate = template => {
      shown.push(template.map(item => item.label ?? ''));
      const menu = build(template);
      menu.popup = () => {};
      return menu;
    };
    (globalThis as unknown as { __shownMenus: string[][] }).__shownMenus = shown;
  });

  const text = page.getByRole('heading').first();
  await text.click({ clickCount: 3 });
  await text.click({ button: 'right' });

  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { __shownMenus: string[][] }).__shownMenus.length))
    .toBeGreaterThan(0);
  const labels = await app.evaluate(() =>
    (globalThis as unknown as { __shownMenus: string[][] }).__shownMenus.flat().filter(Boolean),
  );

  // Proves the menu was built for selected text, so the next check is not passing on an empty menu
  expect.soft(labels.some(label => /^&?copy$/i.test(label))).toBe(true);
  expect.soft(labels.filter(label => /google|search/i.test(label))).toEqual([]);
});
