import { test, expect } from '@playwright/test';

test.describe('the app loads at all', () => {
  test('vendor list opens', async ({ page }) => {
    await page.goto('/vendors');
    await expect(page.getByRole('heading', { name: 'Vendor Master' })).toBeVisible();
  });

  test('add vendor opens with its steps', async ({ page }) => {
    await page.goto('/vendors/new');
    await expect(page.getByRole('heading', { name: 'Add a vendor' })).toBeVisible();
    await expect(page.getByText('Identity and registration')).toBeVisible();
    await expect(page.getByText('Documents', { exact: true })).toBeVisible();
  });

  test('signing out sends you back to the login page', async ({ page }) => {
    await page.goto('/vendors');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('a signed-out visitor cannot reach the vendor list', async ({ browser }) => {
    const fresh = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await fresh.newPage();
    await page.goto('/vendors');
    await expect(page).toHaveURL(/\/login/);
    await fresh.close();
  });
});
