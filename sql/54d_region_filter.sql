-- Run after sql/54a/54b/54c have committed.
--
-- Replaces Analytics' City filter with a Region filter. Region is derived
-- from each vendor's own registered site state (the same data City used),
-- NOT from the separate "serviceable states" geography-reach data
-- collected at onboarding (site_geography / geo_outside_india) -- that's a
-- different question (where a vendor can SERVE, not where it IS).
--
-- Two overrides take priority over the plain state-to-region mapping,
-- because they're real, already-collected signals rather than invented
-- ones:
--   - a site that ticked "Outside India" on the onboarding Geography step
--     (vendor_site.geo_outside_india) is bucketed 'outside_india' outright,
--     regardless of its own registered state.
--   - a site whose declared serviceable states cover literally every
--     state is bucketed 'pan_india' -- the exact same "Pan India" test the
--     onboarding forms already use (Wizard.tsx / FullOnboardForm.tsx:
--     geo.length === STATES.length, 36, the length of
--     lib/constants.ts's STATES/GST_STATES).
-- Every other site falls into exactly one of five directional regions by
-- its own state -- the same grouping lib/constants.ts's REGIONS already
-- uses, with Madhya Pradesh/Chhattisgarh (REGIONS' own "Central" group)
-- folded into North, since the brief asked for five directional regions,
-- not six.
--
-- Trailing columns again, same sql/50_vendor_tier_schema.sql rule as
-- sql/54b's own created_at/created_by: CREATE OR REPLACE VIEW cannot
-- reorder or remove a column, only append.
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
    c.bank_account_name, c.bank_account_number, c.ifsc, c.bank_branch,
    s.created_at, s.created_by,
    s.geo_outside_india,
    (select count(distinct sg2.state) from public.site_geography sg2 where sg2.site_id = s.id) >= 36 as serves_pan_india
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
  ) as banking_complete,
  base.created_at, base.created_by,
  base.geo_outside_india,
  (case
     when base.geo_outside_india then 'outside_india'
     when base.serves_pan_india then 'pan_india'
     when base.state in (
       'Jammu & Kashmir','Ladakh','Himachal Pradesh','Punjab','Chandigarh','Uttarakhand',
       'Haryana','Delhi','Rajasthan','Uttar Pradesh','Madhya Pradesh','Chhattisgarh'
     ) then 'north'
     when base.state in ('Gujarat','Maharashtra','Goa','DNH & Daman Diu') then 'west'
     when base.state in (
       'Karnataka','Kerala','Tamil Nadu','Telangana','Andhra Pradesh','Puducherry',
       'Lakshadweep','Andaman & Nicobar'
     ) then 'south'
     when base.state in ('Bihar','Jharkhand','Odisha','West Bengal','Sikkim') then 'east'
     when base.state in (
       'Assam','Arunachal Pradesh','Manipur','Meghalaya','Mizoram','Nagaland','Tripura'
     ) then 'northeast'
     else null
   end) as region
from base;

alter view public.site_summary set (security_invoker = true);
revoke all on public.site_summary from anon;
grant select on public.site_summary to authenticated;
grant select on public.site_summary to service_role;

create index if not exists site_geo_outside_idx on public.vendor_site (geo_outside_india) where deleted_at is null;
