-- Onboarded / Unverified / Verified tier, per vendor_status_schema.xlsx
-- (sheet 1). Replaces the Completeness (Complete/Incomplete/No documents)
-- and Active/Inactive tags shown on the vendor master view, the vendor
-- record page, and Analytics. vendor_site.status itself is NOT dropped --
-- it stays in the schema for internal use (e.g. Blocked); it is just no
-- longer surfaced anywhere in the UI.
--
-- Computed fresh on every read, from two new boolean columns:
--   core_complete    -- identity, address, primary contact, at least one
--                        service category (skipped if the industry has none
--                        set up at all -- e.g. Warehouse today), at least
--                        one serviceable state (or geo_outside_india), and
--                        every REQUIRED document for the industry attached.
--   banking_complete -- all four banking fields on company.
-- The three-way label itself (Onboarded / Unverified / Verified) is left
-- to the app (lib/vendorTier.ts) to compute from these two booleans --
-- relabelling or moving the boundary is a one-line TS change with no SQL
-- involved; changing which fields count towards completeness is the one
-- case that still means editing this view.
--
-- Column order: every existing column is preserved exactly as it was
-- (CREATE OR REPLACE VIEW forbids reordering or removing one) -- new
-- columns are appended at the end only.
create or replace view public.site_summary as
with base as (
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
      when s.created_by is not null then (select p.full_name from public.profile p where p.id = s.created_by)
      else null
    end as added_by_name,
    -- new, for the tier computation below
    coalesce(s.address_line1, '') <> '' as has_address_line1,
    exists (select 1 from public.site_contact sc
              where sc.site_id = s.id and sc.rank = 1
                and coalesce(sc.name, '') <> '' and coalesce(sc.mobile, '') <> '') as has_primary_contact,
    (
      exists (select 1 from public.site_service_category ssc where ssc.site_id = s.id)
      or not exists (select 1 from public.service_category cat
                       where cat.industry = s.industry and cat.is_active)
    ) as has_service_category,
    (
      coalesce(s.geo_outside_india, false)
      or exists (select 1 from public.site_geography sg where sg.site_id = s.id)
    ) as has_geography,
    c.bank_account_name, c.bank_account_number, c.ifsc, c.bank_branch
  from public.vendor_site s
  join public.company c on c.id = s.company_id
  where s.deleted_at is null and c.deleted_at is null
)
select
  base.id, base.site_code, base.site_name, base.gstin, base.industry, base.state, base.city, base.pincode,
  base.company_id, base.company_code, base.legal_name, base.trade_name, base.pan,
  base.is_msme, base.msme_category,
  base.sibling_sites, base.docs_attached, base.docs_verified, base.docs_required, base.reverification_due,
  base.years_in_market, base.has_pending_request,
  base.migrated_from_portal, base.updated_at,
  base.status, base.legacy_vendor_code, base.services_text, base.credit_period_days,
  base.aadhaar_last4, base.source, base.added_by_name,
  (
    coalesce(base.legal_name, '') <> ''
    and (coalesce(base.gstin, '') <> '' or coalesce(base.aadhaar_last4, '') <> '')
    and base.industry is not null
    and base.has_address_line1
    and coalesce(base.city, '') <> '' and coalesce(base.state, '') <> '' and coalesce(base.pincode, '') <> ''
    and base.has_primary_contact
    and base.has_service_category
    and base.has_geography
    and (base.docs_required = 0 or base.docs_attached >= base.docs_required)
  ) as core_complete,
  (
    coalesce(base.bank_account_name, '') <> '' and coalesce(base.bank_account_number, '') <> ''
    and coalesce(base.ifsc, '') <> '' and coalesce(base.bank_branch, '') <> ''
  ) as banking_complete
from base;

alter view public.site_summary set (security_invoker = true);
revoke all on public.site_summary from anon;
grant select on public.site_summary to authenticated;
grant select on public.site_summary to service_role;
