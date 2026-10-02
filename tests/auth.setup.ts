import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';

const FILE = 'tests/.auth/user.json';

/** Signs in once and saves the session, so every other test starts
 *  signed in rather than repeating the login. */
setup('sign in', async ({ page }) => {
  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;

  if (!email || !password)
    throw new Error(
      'TEST_EMAIL and TEST_PASSWORD are not set. Create a test account in Supabase ' +
      'with the operations role, then add both as GitHub secrets.'
    );

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Landing on /vendors is what proves both the login and the profile row.
  await expect(page).toHaveURL(/\/vendors/, { timeout: 20_000 });

  fs.mkdirSync('tests/.auth', { recursive: true });
  await page.context().storageState({ path: FILE });
});
