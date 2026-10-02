import { defineConfig, devices } from '@playwright/test';

/** Runs against a local build by default. Point BASE_URL at a Vercel preview
 *  to test a deployment instead. */
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,          // these tests share one database
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'tests/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],

  // Only start a server when testing locally; a BASE_URL means it is already up.
  webServer: process.env.BASE_URL ? undefined : {
    command: 'npm run start',
    url: 'http://localhost:3000/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
