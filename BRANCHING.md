# Branches and environments — dev and prod

**The goal:** nothing you are still working on can reach real vendors, and a bad
change can be undone in one click.

## The one thing to understand first

Splitting the code into two branches does **not** protect your data on its own.
Vercel gives every branch a working copy of the site, but by default that copy
talks to the **same database**. A mistake made on `dev` would still delete real
vendors. The protection comes from giving `dev` its **own database** (staging).

| | Code branch | Website | Database | Who sees it |
|---|---|---|---|---|
| **Production** | `prod` | your live address | production Supabase project | everyone |
| **Staging** | `dev` | a separate Vercel address | **staging** Supabase project | you, to test |

## One-time setup (about 45 minutes)

### 1. Create the staging database
1. Supabase → **New project** → name it `greenfind-staging`, same region as production.
2. SQL Editor, in this order (see `sql/README.md`): `01_schema.sql`, `02_security.sql`,
   `03_reference_data.sql` (your own file), `06_data_fit.sql`, `07_import_function.sql`.
3. Then run `sql/tests/06_data_fit_test.sql`. Last line must say **ALL CHECKS PASSED**.
4. Authentication → Providers → Email: turn **Confirm email** off (the app creates accounts itself).
5. Note the staging **Project URL**, **anon key** and **service_role key** (Project Settings → API).

### 2. Create the branches on GitHub
1. Repository → branch dropdown → type `dev` → **Create branch: dev from main**.
2. Repository → **Settings → Branches** → rename `main` to `prod` (the pencil icon).
   GitHub redirects old links. On your PC afterwards:
   ```
   git fetch origin
   git branch -m main prod
   git branch -u origin/prod prod
   git checkout dev
   ```
3. **Settings → General → Default branch** → switch to `dev`, so new work and pull requests start there.
4. If your plan allows it (**Settings → Branches → Add rule**): protect `prod` —
   require a pull request and require the **Tests** check to pass. On a free *private*
   repository this option may not exist; if so, the rule is simply *never push to prod directly*.

### 3. Tell Vercel which branch is production
1. Vercel → your project → **Settings → Git → Production Branch** → `prod`.
2. **Settings → Environment Variables.** For each of the three Supabase variables
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`):
   - Edit the existing one so it applies to **Production only**.
   - Add it again with the **staging** value, applied to **Preview only**.
3. **Redeploy** (Deployments → the latest → ⋯ → Redeploy). Variables are read at build time.
4. The `dev` branch now has a stable address under the project's **Domains** (it looks like
   `greenfind-git-dev-<your-name>.vercel.app`). Bookmark it.
5. Create your first account on staging: open `<dev address>/setup`.

### 4. Point the automated tests at staging
GitHub → **Settings → Secrets and variables → Actions**: the five secrets
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`TEST_EMAIL`, `TEST_PASSWORD`) must hold the **staging** values. Create `test@fitsol.green`
(Operations) on staging. The browser tests create real rows, so they must never see production.

## Every day

```
git checkout dev
# ...make changes...
npm run build          # must pass
git add -A
git commit -m "what changed"
git push               # → dev address updates in ~2 minutes, on STAGING data
```
Test on the dev address. When you are happy:

1. GitHub → **Pull requests → New** → base `prod`, compare `dev`.
2. Wait for the green **Tests** tick. Merge.
3. Vercel deploys `prod` to the live site.

## Database changes

Always staging first, then production, in a quiet moment, after a backup:
1. Run the new SQL on **staging**, then `sql/tests/06_data_fit_test.sql` (or the newer test).
2. Use the dev address; check the feature works.
3. Production: Supabase → Database → **Backups** (confirm a recent one exists; on the free plan, also
   export `company` and `vendor_site` from the Table Editor as CSV). Then run the same SQL.

## Undoing a bad release

Vercel → **Deployments** → find the last good production deployment → ⋯ → **Promote to Production**.
That is instant and does not touch the database. (If the bad release also changed the
database, that part has to be undone by hand — which is why SQL goes to staging first.)

## What does NOT change
- `DEV_AUTH_BYPASS` still only works on your own PC. It cannot switch on in Vercel.
- Never put the service-role key in a `NEXT_PUBLIC_` variable, or in a file that is committed.
