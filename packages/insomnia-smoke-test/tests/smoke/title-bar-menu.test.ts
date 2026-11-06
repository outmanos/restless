import { expect, type Page } from '@playwright/test';

import { test } from '../../playwright/test';

const softly = expect.configure({ soft: true });

// A click that moves focus makes React Aria's popover close by itself, so the click has to land on
// something nobody can focus, which is what a click on plain space does in real use
async function clickEmptySpace(page: Page) {
  const point = await page.evaluate(() => {
    const interactive = 'a, button, input, textarea, select, summary, [tabindex], [role="button"], [contenteditable]';
    for (let y = 70; y < innerHeight - 20; y += 20) {
      for (let x = 20; x < innerWidth - 20; x += 20) {
        const element = document.elementFromPoint(x, y);
        if (element && !element.closest(interactive) && !element.closest('[role="menu"], [role="menubar"]')) {
          return { x, y };
        }
      }
    }
    return null;
  });
  expect.soft(point, 'a point with nothing focusable under it').not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
}

test.describe('title bar menu', () => {
  test.skip(process.platform === 'darwin', 'macOS uses the native menu');

  test('closes when clicking empty space in the app', async ({ page }) => {
    const menubar = page.getByRole('menubar', { name: 'Application menu' });
    await menubar.getByRole('button', { name: 'File' }).click();
    await softly(page.getByRole('menu')).toBeVisible();

    await clickEmptySpace(page);

    await softly(page.getByRole('menu')).toBeHidden();
  });

  test('closes when clicking the preferences button', async ({ page }) => {
    const menubar = page.getByRole('menubar', { name: 'Application menu' });
    await menubar.getByRole('button', { name: 'Edit' }).click();
    await softly(page.getByRole('menu')).toBeVisible();

    await page.getByTestId('settings-button').click();

    await softly(page.getByRole('menu')).toBeHidden();
    await softly(page.locator('text=Restless Preferences').first()).toBeVisible();
  });

  test('closes when clicking the empty title bar', async ({ page }) => {
    const menubar = page.getByRole('menubar', { name: 'Application menu' });
    await menubar.getByRole('button', { name: 'View' }).click();
    await softly(page.getByRole('menu')).toBeVisible();

    const box = await page.locator('.app-titlebar').boundingBox();
    await page.mouse.click(box!.x + box!.width / 2 + 200, box!.y + box!.height / 2);

    await softly(page.getByRole('menu')).toBeHidden();
  });

  test('is not a window drag region while a menu is open, since a drag region swallows clicks', async ({ page }) => {
    const titleBar = page.locator('.app-titlebar');
    const region = () => titleBar.evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region'));
    await softly.poll(region).toBe('drag');

    await page.getByRole('menubar', { name: 'Application menu' }).getByRole('button', { name: 'View' }).click();
    await softly.poll(region).toBe('no-drag');

    await page.keyboard.press('Escape');
    await softly.poll(region).toBe('drag');
  });

  test('still switches menus on hover and closes on Escape', async ({ page }) => {
    const menubar = page.getByRole('menubar', { name: 'Application menu' });
    await menubar.getByRole('button', { name: 'File' }).click();
    await softly(menubar.getByRole('button', { name: 'File' })).toHaveAttribute('aria-expanded', 'true');

    await menubar.getByRole('button', { name: 'Edit' }).hover();
    await softly(menubar.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-expanded', 'true');
    await softly(menubar.getByRole('button', { name: 'File' })).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('Escape');
    await softly(page.getByRole('menu')).toBeHidden();
  });
});
