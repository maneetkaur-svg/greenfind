-- Vendor master view: show who added a vendor, for the sources where that
-- actually means a person. 'manual' (now shown as "Internal") always
-- records the staff member on vendor_site.created_by. 'public_form' (now
-- shown as "External") only has a created_by when a signed-in staff
-- member filled the public form themselves in their own browser (see
-- sql/39_remove_public_msme.sql) -- a genuinely external vendor's own
-- submission has no session, so created_by is null and no name is ever
-- shown for it, just the "External" label on its own. 'import' and
-- 'old_portal' carry no single meaningful name, so they stay blank too.
--
-- Based on sql/33_restore_trade_name.sql's column list (the live shape --
-- sql/20's version this was first drafted against had already dropped
-- trade_name, which CREATE OR REPLACE VIEW rejects reordering/removing).
-- added_by_name is appended at the end, which is all CREATE OR REPLACE VIEW
-- allows for an existing view.
create or replace view public.site_summary as
select
  s.id, s.site_code, s.site_name, s.gstin, s.industry, s.state, s.city, s.pincode,
  c.id as company_id, c.company_code, c.legal_name, c.trade_name, c.pan,
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
  s.aadhaar_last4, s.source,
  case
    when s.source in ('manual', 'public_form')
      then (select p.full_name from public.profile p where p.id = s.created_by)
    else null
  end as added_by_name
from public.vendor_site s
join public.company c on c.id = s.company_id
where s.deleted_at is null and c.deleted_at is null;

alter view public.site_summary set (security_invoker = true);
revoke all on public.site_summary from anon;
grant select on public.site_summary to authenticated;
grant select on public.site_summary to service_role;
