# GreenFind Vendor Master — handover

**Written** 1 October 2026
**For** whoever picks this up next, human or AI
**Live at** https://greenfind-rho.vercel.app
**Code** https://github.com/maneetkaur-svg/greenfind

This exists so the project can continue without the conversation that produced
it. Read sections 1 to 3 before changing anything. Section 7 will save you a day.

---

## 1. What this is

An internal tool for Fitsol staff to record and maintain the vendors GreenFind
buys from: recyclers, packaging suppliers and transporters.

**It is not vendor-facing.** Vendors never log in. Fitsol staff enter everything,
including data read off certificates the vendor emails across.

It replaces a spreadsheet and a folder of PDFs. Three problems it solves: nobody
knows what documents are missing, certificates lapse without anyone noticing, and
vendors cannot be compared when a client requirement arrives.

---

## 2. The stack, and where everything lives

| Layer | What | Where |
|---|---|---|
| Code | Next.js 15, React 19, TypeScript, Tailwind 4 | GitHub |
| Hosting | Vercel, rebuilds on every push to `main` | vercel.com |
| Database | PostgreSQL | Supabase |
| Files | Supabase Storage, private bucket `vendor-documents` | Supabase |
| Auth | Supabase Auth, email and password | Supabase |

There is **no separate backend**. Supabase is the backend. Permissions are
enforced by Postgres row-level security, not by application code — see §4.

### Environment variables

| Name | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel, `.env.local` | Safe in the browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel, `.env.local` | Safe in the browser **because** RLS is on |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel, `.env.local` | **Server only.** Bypasses every rule. Never prefix it `NEXT_PUBLIC_` |

---

## 3. The one idea that explains the data model

**Characters 3 to 12 of any GSTIN are the PAN.** `08AYEPP3943P1ZK` → `AYEPP3943P`.

GST registration is state-wise. A company in three states holds three GSTINs
under one PAN, and two plants in one state share a single GSTIN. So **GSTIN is
unique neither per company nor per plant** and cannot be the key.

Hence two tables:

**`company`** — one row per PAN. Legal name, entity, MSME status, bank details,
NDA. Things a company has exactly one of.

**`vendor_site`** — one row per plant. Address, GSTIN, certificates, contacts,
geography, categories. Things that belong to a location.

The test for which table a field belongs in: **was it issued to an address?**
A Consent to Operate is granted by a state board to a specific plant, so it is a
site field. A bank account is not.

### How the link is enforced

```sql
pan char(10) generated always as (substring(gstin from 3 for 10)) stored,
constraint site_belongs_to_company
  foreign key (company_id, pan) references company (id, pan)
```

Because `pan` is generated from the GSTIN and the foreign key covers both
columns, **the database refuses to attach a site to the wrong company**. It is
not a rule the app has to remember.

The app uses `company_for_gstin()` to spot the relationship as soon as a GSTIN
is typed, and offers to link rather than duplicate.

### Why it matters commercially

A 15,000 TPA recycler recorded as three separate vendors reads as 45,000 TPA.
Any matching or evaluation built on that recommends a vendor who cannot deliver.

---

## 4. Security

**Row-level security is on for every table.** The anon key ships to every
browser; without RLS it would read every vendor's bank details.

Three roles:

| Role | Can |
|---|---|
| `super_admin` | Everything. Delete, manage users and reference data |
| `operations` | Create vendors, edit, upload documents. Cannot delete |
| `user` | Read only |

A signed-in user **with no row in `profile` can do nothing**. That is deliberate,
and it is the single most common "it looks broken" cause.

Files are served through signed URLs that expire in five minutes. The bucket is
private and must stay that way — it holds PAN cards and cancelled cheques.

---

## 5. What is built

| Area | State |
|---|---|
| Sign in, sign out, session handling | Done |
| `/setup` — creates the first Super Admin, refuses afterwards | Done |
| `/users` — add people, set roles, disable accounts | Done |
| Vendor list, search, industry filter, document counts | Done |
| Add vendor wizard, 11 steps, branching by industry | Done |
| Automatic company detection and linking from the PAN | Done |
| Vendor record, tabbed, every tab saves | Done |
| Documents: upload, view, replace, remove, expiry warnings | Done |
| NDA: generated filled in, signed copy uploaded back | Done |
| Playwright tests and GitHub Actions | Done |

### Not built

| Area | Note |
|---|---|
| Vendor evaluation — gates and score | Specified in the PRD §9. Reads CTO and EPR fields already captured |
| Change-request approval workflow | PRD §10. Operations currently edits directly |
| Import and export, Excel template | PRD §11. Needed for migrating existing vendors |
| Document verification | Built, then removed at the client's request. Tables still have the columns |
| Transportation and recycling sub-category lists | Four recycling and all three transportation categories have none |

---

## 6. The file map

```
app/
  login/              sign in, sign out
  setup/              first account only
  (app)/
    layout.tsx        header, nav, role chip
    error.tsx         catches render errors and shows the message
    users/            add people, roles
    vendors/
      page.tsx        the list
      FieldGrid.tsx   shared field renderer
      new/            the wizard — Wizard.tsx is the whole flow
      [id]/           the record — page.tsx plus one component per tab
  api/nda/[siteId]/   generates the NDA filled in for that vendor

lib/
  constants.ts        states, regions, regexes, panFromGstin
  schema.ts           every field, its type, which table it belongs to
  supabase/           client, server, admin

tests/                Playwright
.github/workflows/    CI
```

**`lib/schema.ts` is the spine.** Add a field there and to the database, and it
appears in both the wizard and the record editor without further work.

---

## 7. Traps that cost us a day each

### Functions cannot cross from server to client

`lib/schema.ts` contains `showIf` functions. Passing a whole section from a
server component to a client component throws a render error that **a try/catch
will not catch**, because it happens after your function returns.

Pass the section **id** and look it up on the client. This caused a crash that
took four attempts to find.

### `exited with 1` is never the error

It only means something failed. The real message is 20 to 30 lines above it in
the Vercel build log, usually with a filename and a line number.

### Production hides server error messages

You get a digest number instead. Find the real message in Vercel → Deployments →
the deployment → **Runtime Logs**, searching for the digest.

### Re-running reference data

`03_reference_data.sql` must never `delete from service_category` — a vendor
linked to a category makes Postgres refuse, correctly. The current version
upserts instead and is safe to re-run.

### Supabase's Add user button

It defaults to *Send invitation*, which emails a link pointing at whatever
**Site URL** is set to — localhost, if nobody changed it. Use `/setup` and
`/users` in the app instead. Both create accounts pre-confirmed.

### After changing environment variables

Vercel only reads them at build time. Redeploy, or nothing changes.

### Previews share production data

Every branch gets its own Vercel URL but the same environment variables, and
therefore the same database. A preview is not a sandbox.

---

## 8. Day-to-day

```bash
npm run dev          # localhost:3000
npm run build        # what Vercel runs — do this before pushing
npm test             # Playwright
npm run test:ui      # Playwright with a visible browser
```

Deploying:

```bash
git add -A
git commit -m "what changed"
git push
```

Vercel rebuilds itself. Two to three minutes.

---

## 9. Still open

| | Question | Blocks |
|---|---|---|
| 1 | Sub-categories for FTL, PTL, VTL | Transport vendors having complete categories |
| 2 | Sub-categories for C&D, non-ferrous, used oil, ELV | Those four being complete |
| 3 | Is the evaluation used to approve, rank or price vendors? | Building it |
| 4 | CPCB EPR portal access — yes or no? | Whether certificates can be verified at all |
| 5 | NDA legal defect, see below | Sending any NDA |
| 6 | DPDP retention and erasure policy | Compliance |

**The NDA defect.** The supplied document names Fitsol as the Disclosing Party,
then defines the counterparty as *"the Receiving Party or 'Fitsol'"* — so
"Fitsol" means both. Clause 6 then reads "Fitsol shall return or destroy all
Confidential Information", which is the opposite of the intent. The generator
substitutes "the Receiving Party". **Legal must confirm before it is sent.**

---

## 10. Working on this with an AI assistant

What to paste at the start of a new conversation:

1. This document
2. The PRD, for full field-level detail
3. `lib/schema.ts` and `01_schema.sql`, for the data model
4. The specific file you are changing

What to insist on:

- **Run `npm run build` before claiming anything works.** Most failures here
  were type errors that only the build catches.
- **One change at a time.** Several of our worst sessions came from changing
  four things and not knowing which broke it.
- **Ask for the whole file, not a patch**, unless the change is one line.
  Partial edits pasted into GitHub caused at least two build failures.
- **Check what a file imports** before replacing it. A page referencing a
  component that does not exist fails the build with `Module not found`.

What to be sceptical of:

- Confident claims that something works without a build having been run
- Any suggestion to turn off row-level security or put the service key in the
  browser
- Deleting rows from reference tables rather than upserting


---

## 11. Added since: legacy data, dashboard, branches

- **Database order is now** `01_schema.sql`, `02_security.sql`, `03_reference_data.sql`, `06_data_fit.sql`,
  `07_import_function.sql` (the SQL now lives in `sql/`; see `sql/README.md`).
- **`06_data_fit.sql` also closes a leak**: the views `site_summary` and `expiring_documents` ran with their
  owner's rights, so the public (anon) key could read vendor names, PANs and GSTINs through them even though the
  tables refused. They are now `security_invoker` and revoked from `anon`.
- **Imported vendors may be incomplete** ("required, unless migrated"). See `DATA-FIT.md`.
- **Aadhaar numbers are never stored in full** — last four digits only.
- **Branches:** work on `dev` (staging database), release to `prod` by pull request. See `BRANCHING.md`.
- **Before any real upload:** `npm run preflight -- "file.xlsx"`.
