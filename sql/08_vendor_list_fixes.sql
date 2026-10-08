-- ============================================================
-- GREENFIND — 08 VENDOR LIST FIXES
-- Run AFTER 07_import_function.sql. Safe to re-run.
--
-- Two fixes to the vendor list (site_summary), both noticed after the
-- document bulk import:
--
-- A) An Aadhaar-only vendor (no GSTIN) showed a blank space where the
--    GSTIN normally appears, because site_summary never carried
--    aadhaar_last4. Appended at the end — a view may only grow, never
--    reorder or drop a column.
--
-- B) The "Documents" count on the list compared documents attached
--    against document_requirement's industry-specific REQUIRED
--    certificates — the mechanism built for CTO/EPR evaluation gating.
--    That made an unclassified vendor always show "n/0", and a
--    classified vendor with every basic KYC document on file could
--    still show something like "5/3". The list now compares against the
--    five basic documents every vendor actually needs — GST, PAN, NDA,
--    cancelled cheque, and MSME/Udyam only when the company is
--    registered as an MSME — the same set and the same MSME rule the
--    bulk import itself used. This does not touch document_requirement
--    or the per-vendor Documents tab, which still drives the CTO/EPR
--    REQUIRED/CONDITIONAL chips exactly as before — nothing else reads
--    docs_attached/docs_required from this view.
-- ============================================================

create or replace view public.site_summary as
select
  s.id, s.site_code, s.site_name, s.gstin, s.industry, s.state, s.city, s.pincode,
  c.id as company_id, c.company_code, c.legal_name, c.trade_name, c.pan,
  c.is_msme, c.msme_category,
  (select count(*) from public.vendor_site x
     where x.company_id = c.id and x.deleted_at is null) as sibling_sites,
  (select count(*) from public.site_document d
     where d.site_id = s.id and d.superseded_at is null
       and d.doc_type = any (case when c.is_msme
             then array['gst', 'pan', 'nda', 'cheque', 'udyam']
             else array['gst', 'pan', 'nda', 'cheque'] end)) as docs_attached,
  (select count(*) from public.site_document d
     where d.site_id = s.id and d.superseded_at is null and d.verified_at is not null) as docs_verified,
  (case when c.is_msme then 5 else 4 end)::bigint as docs_required,
  (select min(d.valid_until) - 30 from public.site_document d
     where d.site_id = s.id and d.superseded_at is null and d.valid_until is not null) as reverification_due,
  case when c.year_established is null then null
       else extract(year from now())::int - c.year_established end as years_in_market,
  exists (select 1 from public.change_request cr
            where cr.site_id = s.id and cr.status = 'pending') as has_pending_request,
  s.migrated_from_portal, s.updated_at,
  s.status, s.legacy_vendor_code, s.services_text, c.credit_period_days,
  -- new: lets the list show an Aadhaar-only vendor's last four digits
  -- where a GSTIN would otherwise be blank
  s.aadhaar_last4
from public.vendor_site s
join public.company c on c.id = s.company_id
where s.deleted_at is null and c.deleted_at is null;

-- create or replace view does not reliably carry reloptions across — reassert
-- the security fix from 06_data_fit.sql so this never regresses.
alter view public.site_summary set (security_invoker = true);
revoke all on public.site_summary from anon;
grant select on public.site_summary to authenticated;
grant select on public.site_summary to service_role;


-- ------------------------------------------------------------
-- CHECK — should list the new aadhaar_last4 column, and security_invoker
-- ------------------------------------------------------------
select column_name, ordinal_position
from information_schema.columns
where table_schema = 'public' and table_name = 'site_summary'
order by ordinal_position;

select c.relname as view, coalesce(array_to_string(c.reloptions, ','), '*** NOT security_invoker ***') as options
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'site_summary';
