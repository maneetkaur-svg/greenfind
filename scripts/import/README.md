# Vendor document bulk import

A **one-off, local-only** script. It reads `scripts/import/input/finance-vendors.xlsx`
and attaches the five documents it links to onto the matching `vendor_site`, using the
existing `site_document` table and the existing private `vendor-documents` bucket —
exactly the same tables and storage convention the app itself uses. It does not add any
new tables, any UI, or run on Vercel.

## Before the first run

1. `npm install` (adds `exceljs`, used only by this script).
2. Copy `.env.import.example` (repo root) to `.env.import` and fill in:
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — almost always your **staging**
     project (see `BRANCHING.md`). This script bypasses row-level security, so point it
     at a project you are prepared to bypass RLS on.
   - `PROD_SUPABASE_HOST` — your production project's host. Leave it set; without it the
     script refuses to run at all unless you pass `--allow-prod` every time.
3. Put the spreadsheet at `scripts/import/input/finance-vendors.xlsx`.

`.env.import`, the input spreadsheet and the generated reports are all gitignored —
they can carry vendor PII and a key that bypasses every access rule.

## What it does

For each data row:

1. Looks up `vendor_site` by `legacy_vendor_code = <Vendor Code>`. No match, more than
   one match, or a sheet PAN/GSTIN/name that conflicts with what's on record → the whole
   row goes to `review.csv` and nothing is touched. Codes that are missing or duplicated
   within the file are held back the same way, before any lookup is attempted.
2. For each of the five document columns, reads the **real** link from the cell's
   hyperlink (not the "Open Link" display text):

   | Excel column | `document_type.code` |
   |---|---|
   | GST / Aadhaar document | `gst` |
   | PAN document | `pan` |
   | Agreement document | `nda` — the same record the app's "signed NDA" panel uses |
   | Cancelled cheque | `cheque` |
   | MSME document | `udyam` |

3. A blank link is not a failure: it's `NOT_APPLICABLE` for the MSME document when MSME
   is No, and `MISSING` for everything else blank.
4. Downloads the file (30s timeout, 5 redirects max, http/https only, private/loopback
   addresses blocked, 10 MB cap, content sniffed by its actual bytes — never the
   extension or the HTTP status) and hashes it.
5. If a document of that type is already on file for that site, downloads *that* file
   fresh and compares hashes (nothing new is persisted for this — no `sha256` column was
   added). Same hash → `DUPLICATE`, nothing uploaded. Different hash → uploads the new
   file; the existing `doc_supersede` database trigger retires the old row automatically,
   exactly as a manual "Replace" in the app would.
6. Uploads to `vendor-documents` at `${siteId}/${docType}/${timestamp}_${filename}` —
   the same path convention `documentActions.ts` already uses — then inserts the
   `site_document` row only once the upload has actually succeeded.

One document failing never stops the rest. A timeout or a 5xx is retried once
automatically; anything else (a 404, a blocked address, a file that isn't actually a
PDF/JPG/PNG) is permanent and reported as `FAILED`.

## Running it

```bash
npm run import:docs -- --dry-run          # parse, match, check links — nothing written
npm run import:docs -- --limit 5          # only the first 5 eligible rows
npm run import:docs -- --vendor VEN-0053  # only one vendor
npm run import:docs                       # the real run
npm run import:docs -- --retry-failed     # re-run only what FAILED last time
```

`--dry-run` makes no network request for the document bodies at all (only a URL/SSRF
check) and writes neither `report.csv` nor `review.csv` — it prints a summary to the
console. A real run writes both to `scripts/import/output/`.

## Output

- **`report.csv`** — one row per document: Vendor Code, Excel row, document type,
  status, error code, HTTP status, SHA-256, storage path. Statuses: `COMPLETED`,
  `DUPLICATE`, `FAILED`, `MISSING`, `NOT_APPLICABLE`, `REVIEW_REQUIRED`.
- **`review.csv`** — one row per Vendor Code that couldn't be matched safely, with why.

Nothing in `report.csv`/`review.csv` or the console ever contains a full source URL —
only the host and path, with the query string (where a signed link's token lives)
redacted.

## Safety

- Refuses to run against `PROD_SUPABASE_HOST` (or against anything, if that's unset)
  unless `--allow-prod` is passed.
- Never disables row-level security or makes the bucket public — it uses the
  service-role key the same way the app's own server actions do (`lib/supabase/admin.ts`),
  just from a local terminal instead of a Vercel server action.
- Never invents a `document_type` code: the script checks `gst`, `pan`, `nda`, `cheque`
  and `udyam` exist before touching anything, and aborts if any are missing.
