import { test, expect, type Page } from '@playwright/test';

/** A valid GSTIN, unique per run so repeat runs do not collide on the
 *  (gstin, pincode) constraint. Characters 3–12 are the PAN. */
function makeGstin() {
  const letters = () => Array.from({ length: 5 },
    () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
  const digits = () => String(Math.floor(1000 + Math.random() * 9000));
  const one = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `27${letters()}${digits()}${one()}1Z${one()}`;
}

const run = Date.now().toString().slice(-6);

async function step(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: false }).first().click();
}

test.describe('creating a vendor', () => {
  const gstin = makeGstin();
  const legalName = `Playwright Test Vendor ${run}`;

  test('walks the wizard and saves', async ({ page }) => {
    await page.goto('/vendors/new');

    // --- Step 1: registration and identity together ---
    await page.getByLabel('GSTIN').fill(gstin);
    await expect(page.getByText(gstin.slice(2, 12))).toBeVisible();   // PAN derived
    await page.getByLabel('Industry type').selectOption('recycling');

    // categories appear under industry, in the same step
    await expect(page.getByText('Service category')).toBeVisible();
    await page.getByRole('button', { name: 'Plastic waste management' }).click();
    await page.getByRole('button', { name: 'Cat 1 — Rigid plastic' }).click();

    await page.getByLabel('Legal name').fill(legalName);
    await page.getByLabel('Registered as an MSME').selectOption('false');

    // --- Address ---
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Address').fill('Plot 14, Test Industrial Area');
    await page.getByLabel('City').fill('Alwar');
    await page.getByLabel('State').selectOption('Rajasthan');
    await page.getByLabel('Pincode').fill('301707');

    // --- Geography ---
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'North', exact: false }).first().click();

    // --- Contacts ---
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('#c0_name').fill('Test Primary');
    await page.locator('#c0_mobile').fill('9876543210');
    await page.locator('#c1_name').fill('Test Secondary');

    // --- straight to the end ---
    await page.getByRole('button', { name: 'Skip to review' }).click();
    await expect(page.getByText(legalName)).toBeVisible();

    await page.getByRole('button', { name: 'Create vendor' }).click();

    // landing on the record means every table was written
    await expect(page).toHaveURL(/\/vendors\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: legalName })).toBeVisible();
  });

  test('appears in the list', async ({ page }) => {
    await page.goto('/vendors');
    await expect(page.getByText(legalName)).toBeVisible();
  });

  test('every tab on the record opens', async ({ page }) => {
    await page.goto('/vendors');
    await page.getByText(legalName).click();
    await expect(page).toHaveURL(/\/vendors\/[0-9a-f-]{36}/);

    // This is the one that was crashing: server data reaching a client component.
    for (const tab of ['Identity', 'Site', 'Commercial', 'Banking',
                       'Agreements', 'Operations', 'Contacts', 'Geography', 'Documents']) {
      await page.getByRole('link', { name: tab, exact: true }).click();
      await expect(page.locator('text=Something went wrong')).toHaveCount(0);
      await expect(page.locator('text=could not be loaded')).toHaveCount(0);
    }
  });

  test('a section saves and the value survives a reload', async ({ page }) => {
    await page.goto('/vendors');
    await page.getByText(legalName).click();
    await page.getByRole('link', { name: 'Commercial', exact: true }).click();

    await page.getByLabel('Key clients').fill('Tested by Playwright');
    await page.getByRole('button', { name: /Save commercial/i }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Key clients')).toHaveValue('Tested by Playwright');
  });

  test('contacts save', async ({ page }) => {
    await page.goto('/vendors');
    await page.getByText(legalName).click();
    await page.getByRole('link', { name: 'Contacts', exact: true }).click();

    await page.locator('#c3_name').fill('Test Third');
    await page.locator('#c3_designation').fill('Accounts');
    await page.getByRole('button', { name: 'Save contacts' }).click();
    await expect(page.getByText('Contacts saved.')).toBeVisible();
  });

  test('the NDA downloads with the vendor filled in', async ({ page }) => {
    await page.goto('/vendors');
    await page.getByText(legalName).click();
    await page.getByRole('link', { name: 'Agreements', exact: true }).click();

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toContain('NDA');
  });
});

test.describe('the rules hold', () => {
  test('creating without the required fields is refused, and says why', async ({ page }) => {
    await page.goto('/vendors/new');
    await page.getByRole('button', { name: 'Skip to review' }).click();
    await page.getByRole('button', { name: 'Create vendor' }).click();

    await expect(page.getByText(/still to fix/i)).toBeVisible();
    await expect(page.getByText('Enter a valid GSTIN.')).toBeVisible();
    await expect(page).not.toHaveURL(/\/vendors\/[0-9a-f-]{36}/);
  });

  test('a bad GSTIN is rejected', async ({ page }) => {
    await page.goto('/vendors/new');
    await page.getByLabel('GSTIN').fill('NOTAVALIDGSTIN');
    await expect(page.getByText(/Fifteen characters/)).toBeVisible();
  });

  test('MSME yes asks for the category and the Udyam number', async ({ page }) => {
    await page.goto('/vendors/new');
    await page.getByLabel('Industry type').selectOption('packaging');
    await page.getByLabel('Registered as an MSME').selectOption('true');
    await expect(page.getByLabel('Enterprise category')).toBeVisible();
    await expect(page.getByLabel('Udyam number')).toBeVisible();
  });

  test('a second site under the same PAN offers to link', async ({ page }) => {
    await page.goto('/vendors');
    const first = page.locator('tbody tr').first();
    await expect(first).toBeVisible();
    const gstinText = await first.locator('td').first().innerText();
    const match = gstinText.match(/[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]/);
    test.skip(!match, 'No existing vendor with a GSTIN to test linking against.');

    await page.goto('/vendors/new');
    await page.getByLabel('GSTIN').fill(match![0]);
    await expect(page.getByText(/already on record under this PAN/)).toBeVisible({ timeout: 15_000 });
  });
});
