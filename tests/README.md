# Tests

Two kinds. The automated ones run on every push; the checklist is for the things
a browser cannot judge.

## Running them

```bash
npm test              # headless, what CI runs
npm run test:ui       # a visible browser, pausing at each step — use this to debug
npm run test:headed   # visible browser, no pausing
npm run test:report   # open the last report
```

Locally they build and start the app themselves. To test a deployment instead:

```bash
BASE_URL=https://greenfind-rho.vercel.app npm test
```

## Setting up, once

The tests need an account to sign in with.

**1. Create a test user.** In the app, as a Super Admin: **Users → Add someone**.
Call it something obvious like `test@fitsol.green`, role **Operations**.

Operations rather than Super Admin, deliberately — the tests should not be able
to delete anything.

**2. Add four secrets to GitHub.** Your repo → **Settings → Secrets and variables
→ Actions → New repository secret**:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | same as Vercel |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same as Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | same as Vercel |
| `TEST_EMAIL` | the test account |
| `TEST_PASSWORD` | its password |

**3. Locally**, add the last two to `.env.local` as well.

## What is covered

**smoke.spec.ts** — pages load, signing out works, a signed-out visitor cannot
reach the vendor list.

**vendor.spec.ts** — the whole create flow: GSTIN typed, PAN derived, categories
appearing under the industry, address, geography, contacts, create. Then the
record: every tab opens, a section saves and survives a reload, contacts save,
the NDA downloads. Then the rules: creating with nothing filled in is refused and
says why, a bad GSTIN is rejected, MSME yes asks for the category and Udyam
number, a second site under the same PAN offers to link.

The tab test is the important one. A crash there — server data reaching a client
component — went undetected through four deploys.

## A warning

**These tests write to whichever database they are pointed at.** Each run creates
a vendor named `Playwright Test Vendor <number>`.

For now that is your real database, which is acceptable while the data is test
data. Before real vendors are in it, create a second Supabase project and point
the GitHub secrets at that instead.

To clear up afterwards:

```sql
delete from vendor_site
where id in (
  select s.id from vendor_site s
  join company c on c.id = s.company_id
  where c.legal_name like 'Playwright Test Vendor%'
);
delete from company where legal_name like 'Playwright Test Vendor%';
```

## When a test fails

CI keeps a report. GitHub → the failed run → **Artifacts** → `playwright-report`.
It has a screenshot, a video and a trace of the moment it failed.

Locally, `npm run test:report` opens the same thing.

## Added tests

- `npm test` — everything. `npx playwright test --project=unit` — logic only, 3 seconds, no database.
- `npm run preflight -- "file.xlsx"` — checks a real spreadsheet with no database.
- `sql/tests/06_data_fit_test.sql` — database rules; run on STAGING in the Supabase SQL Editor. Rolls back.
- `tests/dashboard.spec.ts`, `tests/import.spec.ts` — browser tests; they write rows to whatever database the app points at.
