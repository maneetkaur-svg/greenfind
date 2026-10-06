import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';

/** Browser tests for the import screens. Like vendor.spec.ts, these write to
 *  whichever database the app points at. Every row they create is flagged
 *  "migrated" and named "Playwright Import <number>". */

const run = Date.now().toString().slice(-6);
const letters = () => Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
const digits = () => String(Math.floor(1000 + Math.random() * 9000));
const one = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));

/** Two valid GSTINs under one PAN: same characters 3-12, different state code. */
function twoGstinsOnePan() {
  const pan = `${letters()}${digits()}${one()}`;
  return [`27${pan}1Z${one()}`, `24${pan}1Z${one()}`];
}

function workbook(rows: (string | number)[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Vendor data');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
const HEAD = ['Company Name', 'GST No', 'Industry', 'Address', 'City', 'Pincode'];
const xlsxFile = (buffer: Buffer) => ({ name: 'vendors.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });

test.describe('import', () => {
  test('the template downloads', async ({ page }) => {
    await page.goto('/vendors/import');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download the Excel template' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('greenfind-vendor-import-template.xlsx');
  });

  test('a valid file imports; two rows sharing a PAN make one company with two sites', async ({ page }) => {
    const [g1, g2] = twoGstinsOnePan();
    const name = `Playwright Import ${run}`;
    await page.goto('/vendors/import');
    await page.getByTestId('import-file').setInputFiles(xlsxFile(workbook([
      HEAD,
      [name, g1, 'Logistics', 'Plot 1, Test Estate', 'Pune', '411001'],
      [name, g2, 'Logistics', 'Plot 2, Test Estate', 'Surat', '395003'],
    ])));

    await expect(page.getByText('Match the columns')).toBeVisible();
    await page.getByRole('button', { name: 'Check the data' }).click();
    await expect(page.getByTestId('stat-will-import')).toHaveText('2');
    await expect(page.getByTestId('stat-held-back')).toHaveText('0');

    await page.getByRole('button', { name: /^Import 2 rows$/ }).click();
    await expect(page.getByTestId('import-done')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('done-sites')).toHaveText('2');
    await expect(page.getByTestId('done-companies')).toHaveText('1');

    // and the rows are really there, as one company with two sites
    await page.goto(`/vendors?q=${encodeURIComponent(name)}`);
    await expect(page.getByText(name)).toHaveCount(2);
    await expect(page.getByText('2 sites')).toHaveCount(2);
  });

  test('a file with bad rows reports them instead of dropping them silently', async ({ page }) => {
    const [good] = twoGstinsOnePan();
    await page.goto('/vendors/import');
    await page.getByTestId('import-file').setInputFiles(xlsxFile(workbook([
      HEAD,
      [`Playwright Import Good ${run}`, good, 'Packing', 'Plot 3', 'Pune', '411001'],
      [`Playwright Import Bad ${run}`, 'NOT-A-GSTIN', 'Packing', 'Plot 4', 'Pune', '411001'],
    ])));
    await page.getByRole('button', { name: 'Check the data' }).click();
    await expect(page.getByTestId('stat-will-import')).toHaveText('1');
    await expect(page.getByTestId('stat-held-back')).toHaveText('1');
    await expect(page.getByText('GSTIN format wrong')).toBeVisible();
    await expect(page.getByText('Rows: 3')).toBeVisible();           // the bad row, by its spreadsheet row number
  });
});
