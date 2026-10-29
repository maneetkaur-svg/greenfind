-- Run after sql/54a has committed on its own.
--
-- Schema for the rebuilt Analytics page (app/(app)/analytics). Two things:
--
-- 1. A lightweight `vertical` table. industry_type itself stays a plain
--    Postgres enum everywhere else in the app (forms, RLS, document
--    requirements, import scripts) -- changing that is a much larger,
--    separate migration that was deliberately scoped out. This table only
--    gives Analytics a place to store a vertical's display label and sort
--    order without a code change, and a row for 'others' to sit alongside
--    Warehouse as a second "no categories yet" example. Adding a brand
--    new *industry* (a 7th value after recycling/packaging/transportation/
--    warehouse/scrap_trading/others) still needs a code change --
--    `alter type industry_type add value`, a row here, and wiring it into
--    lib/constants.ts wherever vendors should be allowed to pick it.
--
-- 2. Two columns appended to site_summary (created_at, created_by) --
--    appended, not inserted, per sql/50_vendor_tier_schema.sql's own rule
--    that CREATE OR REPLACE VIEW forbids reordering or removing a column.
--    Analytics needs a real timestamp and a real staff id to filter/bucket
--    by signup date and by who added a vendor; today's view only exposes
--    updated_at and a resolved added_by_name string, neither of which is
--    enough (a name is ambiguous and isn't a stable filter key).

create table if not exists public.vertical (
  id         uuid primary key default gen_random_uuid(),
  code       industry_type unique not null,
  label      text not null,
  sort_order smallint not null default 0,
  is_active  boolean not null default true
);

insert into public.vertical (code, label, sort_order) values
  ('recycling',      'Recycling',      1),
  ('packaging',       'Packaging',      2),
  ('transportation',  'Transportation', 3),
  ('warehouse',       'Warehouse',      4),
  ('scrap_trading',   'Scrap Trading',  5),
  ('others',          'Others',         6)
on conflict (code) do nothing;

alter table public.vertical enable row level security;
drop policy if exists vertical_read on public.vertical;
create policy vertical_read on public.vertical for select using (public.can_read());
grant select on public.vertical to authenticated;

-- Everything below is the sql/50 view verbatim, with base.created_at and
-- base.created_by appended at the very end.
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
    s.created_at, s.created_by
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
  base.created_at, base.created_by
from base;

alter view public.site_summary set (security_invoker = true);
revoke all on public.site_summary from anon;
grant select on public.site_summary to authenticated;
grant select on public.site_summary to service_role;

-- Filtering/grouping columns the new aggregate functions (sql/54c) need,
-- beyond the industry/state/gstin indexes sql/01 already has.
create index if not exists site_source_idx  on public.vendor_site (source)     where deleted_at is null;
create index if not exists site_created_idx on public.vendor_site (created_at) where deleted_at is null;
create index if not exists site_city_idx    on public.vendor_site (city)       where deleted_at is null;
create index if not exists ssc_category_idx    on public.site_service_category    (category_id);
create index if not exists sss_subcategory_idx on public.site_service_subcategory (subcategory_id);
