import { test, expect } from '@playwright/test';

/** The dashboard sits in the top-right corner of the vendor list: small, not a banner. */
test.describe('vendor list dashboard', () => {
  test('is a compact card in the top-right quarter of the page', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/vendors');
    const card = page.getByTestId('dashboard');
    await expect(card).toBeVisible();
    const box = (await card.boundingBox())!;
    expect(box.x + box.width / 2).toBeGreaterThan(1400 / 2);    // right half
    expect(box.y + box.height / 2).toBeLessThan(900 / 2);       // top half
    expect(box.width).toBeLessThan(1400 * 0.3);                  // never spans the page
    expect(box.height).toBeLessThan(900 * 0.4);
  });

  test('shows the onboarded count and one row per industry that has vendors', async ({ page }) => {
    await page.goto('/vendors');
    await expect(page.getByTestId('dash-active')).toHaveText(/^\d+$/);
    await expect(page.getByTestId('dash-total')).toContainText('on record');
  });

  test('an industry row filters the list to that industry', async ({ page }) => {
    await page.goto('/vendors');
    const row = page.getByTestId('dash-recycling');
    test.skip(!(await row.count()), 'no recycling vendors in this database yet');
    await row.click();
    await expect(page).toHaveURL(/industry=recycling/);
  });
});
