-- A vendor with no formal industry (imported without one, or given a
-- not-yet-formal one via "+ Add a new industry type") was matching ZERO
-- document_requirement rows in sql/14's fix (r.industry = s.industry is
-- never true when s.industry is null), so every "Others" vendor showed
-- 0/0 attached and an empty Documents tab, same symptom as the warehouse
-- gap in sql/16 but for a different reason — here there is no industry
-- value to seed rows against at all.
--
-- Every industry but recycling has the identical gst/pan/cheque/udyam/
-- profile/nda baseline (confirmed: transportation, packaging, warehouse
-- are byte-for-byte the same set) — 'transportation' stands in for "the
-- baseline" for a null industry, matching what
-- app/(app)/vendors/[id]/page.tsx now does for the same case.
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
         where r.industry = coalesce(s.industry, 'transportation') and r.level = 'required'
           and t.uploaded_by_party = 'vendor'
       )) as docs_attached,
  (select count(*) from public.site_document d
     where d.site_id = s.id and d.superseded_at is null and d.verified_at is not null) as docs_verified,
  (select count(*) from public.document_requirement r
     join public.document_type t on t.code = r.doc_type
     where r.industry = coalesce(s.industry, 'transportation') and r.level = 'required'
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
