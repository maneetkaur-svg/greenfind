-- Fixes a real discrepancy reported against production: the vendor list
-- (site_summary) showed a different "attached/required" fraction than the
-- vendor's own Documents tab for the same vendor (Shri Shyam Plastic
-- Industries, VEN-0118: list said docs_required=4, the Documents tab's own
-- count — level='required' AND uploaded_by_party='vendor' rows for the
-- site's industry — said 5, because recycling needs CTO and EPR on top of
-- GST/PAN/cheque).
--
-- Root cause: 08_vendor_list_fixes.sql and 11_drop_trade_name.sql both
-- redefined docs_required as a hardcoded guess, "4 required docs, 5 if
-- MSME" — the same for every industry. That guess is wrong for any
-- industry whose real document_requirement rows differ (recycling needs
-- 5 regardless of MSME: gst, pan, cheque, cto, epr). docs_attached was
-- also counting a different, hardcoded set of doc_types than docs_required
-- was counting against, so the two numbers were never really comparable.
--
-- This replaces both with the same per-industry, per-site calculation the
-- Documents tab already uses (app/(app)/vendors/[id]/DocumentsTab.tsx):
-- required = document_requirement rows for this site's industry, level =
-- 'required', document_type.uploaded_by_party = 'vendor'; attached = how
-- many of exactly those doc_types this site has on file (not superseded).
create or replace view public.site_summary as
select
  s.id, s.site_code, s.site_name, s.gstin, s.industry, s.state, s.city, s.pincode,
  c.id as company_id, c.company_code, c.legal_name, c.pan,
  c.is_msme, c.msme_category,
  (select count(*) from public.vendor_site x
     where x.company_id = c.id and x.deleted_at is null) as sibling_sites,
  (select count(*) from public.site_document d
     where d.site_id = s.id and d.superseded_at is null
       and d.doc_type in (
         select r.doc_type from public.document_requirement r
         join public.document_type t on t.code = r.doc_type
         where r.industry = s.industry and r.level = 'required'
           and t.uploaded_by_party = 'vendor'
       )) as docs_attached,
  (select count(*) from public.site_document d
     where d.site_id = s.id and d.superseded_at is null and d.verified_at is not null) as docs_verified,
  (select count(*) from public.document_requirement r
     join public.document_type t on t.code = r.doc_type
     where r.industry = s.industry and r.level = 'required'
       and t.uploaded_by_party = 'vendor') as docs_required,
  (select min(d.valid_until) - 30 from public.site_document d
     where d.site_id = s.id and d.superseded_at is null and d.valid_until is not null) as reverification_due,
  case when c.year_established is null then null
       else extract(year from now())::int - c.year_established end as years_in_market,
  exists (select 1 from public.change_request cr
            where cr.site_id = s.id and cr.status = 'pending') as has_pending_request,
  s.migrated_from_portal, s.updated_at,
  s.status, s.legacy_vendor_code, s.services_text, c.credit_period_days,
  s.aadhaar_last4
from public.vendor_site s
join public.company c on c.id = s.company_id
where s.deleted_at is null and c.deleted_at is null;

alter view public.site_summary set (security_invoker = true);
revoke all on public.site_summary from anon;
grant select on public.site_summary to authenticated;
grant select on public.site_summary to service_role;
