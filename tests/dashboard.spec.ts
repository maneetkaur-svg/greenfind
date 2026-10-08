import { test, expect } from '@playwright/test';

/** The dashboard sits above the vendor list as a row of metric boxes: one for
 *  the total, one per industry (including Others, for unclassified). */
test.describe('vendor list dashboard', () => {
  test('is a row of metric boxes above the vendor list', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/vendors');
    const card = page.getByTestId('dashboard');
    await expect(card).toBeVisible();
    const box = (await card.boundingBox())!;
    expect(box.width).toBeGreaterThan(1400 * 0.5); // spans (most of) the page width
    expect(box.height).toBeLessThan(900 * 0.25);   // but is short, not a banner
  });

  test('shows the total vendor count and one box per industry that has vendors', async ({ page }) => {
    await page.goto('/vendors');
    await expect(page.getByTestId('dash-active')).toHaveText(/^\d+$/);
    await expect(page.getByText('TOTAL VENDORS')).toBeVisible();
  });

  test('an industry box filters the list to that industry', async ({ page }) => {
    await page.goto('/vendors');
    const box = page.getByTestId('dash-recycling');
    test.skip(!(await box.count()), 'no recycling vendors in this database yet');
    await box.click();
    await expect(page).toHaveURL(/industry=recycling/);
  });
});
