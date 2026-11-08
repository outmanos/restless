import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('The collection picked in the New request box is remembered', async ({ page, insomnia }) => {
  const trigger = () => page.getByRole('button', { name: 'Select target API collection' });
  const toProjectPage = async () => {
    await insomnia.navigationSidebar.backToAllProjects();
    await insomnia.navigationSidebar.selectProject('My Project');
    await expect.soft(trigger()).toBeVisible();
  };
  // Opening a collection and coming back builds the box again, as a later visit does
  const visitAgain = async () => {
    await insomnia.navigationSidebar.selectWorkspace('My First Collection');
    await toProjectPage();
  };

  // The first collection is made from inside the box, then the project's own page has the box again
  await page.getByRole('button', { name: 'Create request collection', exact: true }).click();
  await page.waitForURL(/\/workspace\//);
  await toProjectPage();

  // A collection made from the box is the one chosen, and stays chosen
  await trigger().click();
  await page.getByRole('button', { name: 'New API Collection' }).click();
  await page.getByRole('dialog').getByPlaceholder('Enter a name for your API Collection').fill('Beta');
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await expect.soft(trigger()).toContainText('Beta');
  await visitAgain();
  await expect.soft(trigger()).toContainText('Beta');

  // Whichever one is chosen, it is the one still chosen after the page loads again
  for (const name of ['My First Collection', 'Beta']) {
    await trigger().click();
    await page.getByRole('option', { name }).click();
    await expect.soft(trigger()).toContainText(name);
    await visitAgain();
    await expect.soft(trigger()).toContainText(name);
  }
});
