# Database files — run order

Run in the Supabase **SQL Editor**, one file at a time, in this order:

| # | File | What it does | Safe to re-run |
|---|---|---|---|
| 1 | `01_schema.sql` | Tables, rules, triggers, views. Works on a brand-new project. | Yes |
| 2 | `02_security.sql` | Row-level security, roles, the private documents bucket. | Yes |
| 3 | `03_reference_data.sql` | Categories and document rules. **Your own file — not in this folder.** | Yes |
| 4 | `06_data_fit.sql` | Fits the legacy vendor sheet: new columns, "required unless migrated", PAN stored, dashboard view, **closes the view leak**. | Yes |
| 5 | `07_import_function.sql` | The import function (replaces the earlier `05_import.sql`). | Yes |
| 6 | `08_vendor_list_fixes.sql` | Vendor list: Aadhaar-only vendors show their number instead of a blank GSTIN; the Documents count compares against the five basic KYC documents (MSME-aware) instead of industry CTO/EPR requirements. | Yes |
| 7 | `09_industry_super_admin_only.sql` | Changing an existing vendor's industry becomes Super Admin only, enforced by a trigger (not just the UI). | Yes |
| 8 | `10_default_geography_from_gstin.sql` | A vendor's GSTIN state is marked as a serviceable state automatically — triggers for every future vendor, plus a one-time catch-up for existing ones. | Yes |
| 9 | `11_drop_trade_name.sql` | Removes company.trade_name (confirmed blank on every record) and the Identity tab's Trade name field. | Yes |

Then, on **staging only**, run `tests/06_data_fit_test.sql`. It checks every rule
06 changed, then rolls everything back. The last line should say `ALL CHECKS PASSED`.

Order for a project that already has data (your production): take a backup,
run 06, then 07. Do not skip staging first.
