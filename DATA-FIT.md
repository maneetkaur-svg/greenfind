# Fitting the legacy vendor sheet

The sheet has 17 columns. This is where each one goes, what was added to the
database, what became optional, and what is deliberately still required.

## Where each column goes

| Sheet column | Goes to | Notes |
|---|---|---|
| Vendor Code | `vendor_site.legacy_vendor_code` | **New.** Unique. Searchable. The system still generates its own `VEN 007-A` codes. |
| Vendor Name | `company.legal_name` | |
| Services | `vendor_site.services_text` | **New.** Free text. Also used to work out the industry (see below). |
| Credit Period | `company.credit_period_days` (+ `credit_period_note`) | **New.** `45`, `45 days`, `1 month` → days. `Advance`/`Immediate` → 0 days, wording kept. `30-45 days` → kept as a note only. |
| GST / Aadhaar | `vendor_site.gstin` **or** `aadhaar_last4` | A GSTIN is kept. An Aadhaar number is reduced to its **last four digits**; the full number is never stored, shown or reported. |
| PAN Number | `company.pan` | The company key. Taken from the GSTIN when blank. |
| Account Number, IFSC Code | `company.bank_account_number`, `ifsc` | Bank account name and branch are not in the sheet; they stay blank. |
| Projects | `vendor_site.projects_text` | **New.** Free text. |
| MSME | `company.is_msme` | Yes/No, **or** a Udyam number, **or** a category — all understood. |
| Status | `vendor_site.status` | **New.** Active / Inactive / Pending / Blocked. Blank or unknown → **Pending**, never Active. |
| GST/Aadhaar, PAN, Agreement, MSME Document; Cancelled Cheque | `vendor_site.legacy_documents` | **New.** The reference text only (link or file name). Files cannot travel in a spreadsheet, so each record lists what must be uploaded. A cheque reference also marks "cancelled cheque on file". |
| Created Date | `company.created_at`, `vendor_site.created_at` | The original onboarding date is kept. Future dates are ignored. |

## What was missing from the sheet (and is now optional for imported vendors)

Industry · address · city · state · pincode · contacts · bank account name · bank branch ·
MSME category · Udyam number · entity type · CIN.

The rule is **"required, unless imported"** (`migrated_from_portal`). Every vendor created
in the app is still held to the full rule; an imported record may be incomplete, shows an
"Still to fill in" note, and can be completed tab by tab.

## What is still required

- **A vendor name.**
- **A PAN, or a valid GSTIN** (the PAN is read from it). The PAN is the key that groups
  rows into a company, and a vendor cannot be paid without one. A row with neither is held
  back and listed — most often an Aadhaar-only vendor with no PAN.
- A status value that the database recognises (blank/unknown → Pending).

## Industry

The sheet has no industry column. It is worked out from **Services**:
`recycl / EPR / waste / scrap / battery …` → Recycling · `packag / corrugat / carton / pallet / foam …`
→ Packaging · `transport / logistic / freight / FTL / PTL …` → Transportation.
If Services match **none or more than one**, the vendor imports as **Unclassified** and is
listed on the dashboard so it can be classified by hand.

## Dashboard

Top right of the vendor list. **Onboarded = Active.** The grey bar is vendors on record, the
green part is active ones. Click an industry to filter. A company with plants in two industries
counts once in each, so the industries can add up to more than the total.

## Things to confirm (the preflight run answers most of these)

1. **Status values** — the actual list in your data. Anything unrecognised becomes Pending.
2. **MSME column** — Yes/No, or the Udyam number itself?
3. **Document columns** — links, file names, or Yes/No?
4. **Projects** — client projects, internal projects, or both?
5. **Is one row one vendor, or one plant?** Rows sharing a PAN become one company with several sites.
6. **Aadhaar:** storing only the last four digits is the default. Whether Fitsol may hold more
   is a question for legal / the DPDP policy, not something to decide in code.
7. **Vendors without GST in future:** the app still requires a GSTIN for vendors created in it.
