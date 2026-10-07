-- ============================================================
-- GREENFIND — 06 DATA FIT
-- Run AFTER 01, 02, 03 and 05. Safe to re-run.
-- Run on STAGING first, then production.
--
-- Why this exists
--   The legacy vendor sheet has 17 columns. Four things in it do not fit the
--   schema as it stood: it has no address, no industry, a column that is either
--   a GSTIN or an Aadhaar number, and fields the schema never had (vendor code,
--   services, credit period, projects, status, document references).
--
--   Nothing here deletes or rewrites existing data. It adds columns, relaxes
--   rules, and adds the same rules back for new records only.
--
-- The one idea
--   "Required, unless the record came from the old portal."
--   Every vendor created in the app is still held to the full rule. A migrated
--   record may be incomplete and is flagged so it can be completed in place.
--
-- A) SECURITY — the two views were readable without signing in (see the notes)
-- B) New columns
-- C) Required-unless-migrated rules
-- D) PAN becomes a stored column, still tied to the GSTIN
-- E) Views carry the new fields
-- F) The dashboard view
-- ============================================================


-- ------------------------------------------------------------
-- B) NEW COLUMNS
-- ------------------------------------------------------------
do $$ begin create type vendor_status as enum ('active','inactive','pending','blocked');
exception when duplicate_object then null; end $$;

-- company: terms that belong to the legal entity
alter table public.company
  add column if not exists credit_period_days smallint,
  add column if not exists credit_period_note varchar(100);   -- the original wording when it is not a plain number of days

alter table public.company drop constraint if exists credit_period_range;
alter table public.company add  constraint credit_period_range
  check (credit_period_days is null or credit_period_days between 0 and 365);

-- site: what belongs to one registration / plant
alter table public.vendor_site
  add column if not exists legacy_vendor_code varchar(60),    -- the code the old system used
  add column if not exists services_text      text,           -- "Services", as recorded
  add column if not exists projects_text      text,           -- "Projects", as recorded
  add column if not exists status             vendor_status not null default 'active',
  add column if not exists aadhaar_last4      char(4),        -- NEVER the full number; see DATA-FIT.md
  add column if not exists legacy_documents   jsonb;         -- references to documents that still live elsewhere

alter table public.vendor_site drop constraint if exists aadhaar_last4_format;
alter table public.vendor_site add  constraint aadhaar_last4_format
  check (aadhaar_last4 is null or aadhaar_last4 ~ '^[0-9]{4}$');

-- one site per old-system code
create unique index if not exists site_legacy_code_uq
  on public.vendor_site (legacy_vendor_code) where legacy_vendor_code is not null;

create index if not exists site_status_idx
  on public.vendor_site (status) where deleted_at is null;


-- ------------------------------------------------------------
-- C) REQUIRED, UNLESS MIGRATED
-- ------------------------------------------------------------
-- An MSME needs a category and a Udyam number — unless it was migrated, in
-- which case the old data may only say "MSME: Yes".
alter table public.company drop constraint if exists msme_complete;
alter table public.company add  constraint msme_complete
  check (is_msme is not true
         or (msme_category is not null and udyam_number is not null)
         or migrated_from_portal);

-- The legacy sheet has no address, industry or (for some vendors) GSTIN.
alter table public.vendor_site
  alter column gstin         drop not null,
  alter column industry      drop not null,
  alter column address_line1 drop not null,
  alter column city          drop not null,
  alter column state         drop not null,
  alter column pincode       drop not null;

alter table public.vendor_site drop constraint if exists required_unless_migrated;
alter table public.vendor_site add  constraint required_unless_migrated
  check (migrated_from_portal
         or (gstin is not null and industry is not null and address_line1 is not null
             and city is not null and state is not null and pincode is not null));


-- ------------------------------------------------------------
-- D) PAN: STORED, NOT GENERATED
-- A generated column cannot exist without a GSTIN, and a vendor identified only
-- by Aadhaar has none. The PAN still keys the company, and the foreign key to
-- (company_id, pan) still stops a site attaching to the wrong company.
-- ------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_attribute
              where attrelid = 'public.vendor_site'::regclass
                and attname = 'pan' and attgenerated = 's') then
    alter table public.vendor_site alter column pan drop expression;
  end if;
end $$;

alter table public.vendor_site alter column pan set not null;

-- Existing code inserts a site with a GSTIN and no PAN. This keeps that working:
-- whenever a GSTIN is present, the PAN is taken from it, always.
create or replace function public.vendor_site_derive_pan() returns trigger
language plpgsql as $$
begin
  if new.gstin is not null then
    new.pan := substring(new.gstin from 3 for 10);
  end if;
  return new;
end $$;

drop trigger if exists vendor_site_pan on public.vendor_site;
create trigger vendor_site_pan before insert or update on public.vendor_site
for each row execute function public.vendor_site_derive_pan();

alter table public.vendor_site drop constraint if exists pan_matches_gstin;
alter table public.vendor_site add  constraint pan_matches_gstin
  check (gstin is null or pan = substring(gstin from 3 for 10));


-- ------------------------------------------------------------
-- E) VIEWS — new fields appended at the end (a view may only grow that way)
-- ------------------------------------------------------------
create or replace view public.site_summary as
select
  s.id, s.site_code, s.site_name, s.gstin, s.industry, s.state, s.city, s.pincode,
  c.id as company_id, c.company_code, c.legal_name, c.trade_name, c.pan,
  c.is_msme, c.msme_category,
  (select count(*) from public.vendor_site x
     where x.company_id = c.id and x.deleted_at is null) as sibling_sites,
  (select count(*) from public.site_document d
     where d.site_id = s.id and d.superseded_at is null) as docs_attached,
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
  -- new
  s.status, s.legacy_vendor_code, s.services_text, c.credit_period_days
from public.vendor_site s
join public.company c on c.id = s.company_id
where s.deleted_at is null and c.deleted_at is null;


-- ------------------------------------------------------------
-- F) THE DASHBOARD — one row per industry, plus a 'total' row.
-- A company with plants in two industries counts once in each industry and once
-- in the total, which is why the industries do not simply add up to the total.
-- ------------------------------------------------------------
create or replace view public.vendor_dashboard with (security_invoker = true) as
with live as (
  select s.company_id, s.industry, s.status
  from public.vendor_site s
  join public.company c on c.id = s.company_id
  where s.deleted_at is null and c.deleted_at is null
)
select coalesce(industry::text, 'unclassified') as industry,
       count(distinct company_id)::int                                         as vendors,
       count(distinct company_id) filter (where status = 'active')::int        as active_vendors,
       count(*)::int                                                            as sites
from live group by 1
union all
select 'total',
       count(distinct company_id)::int,
       count(distinct company_id) filter (where status = 'active')::int,
       count(*)::int
from live;


-- ------------------------------------------------------------
-- A) SECURITY FIX — views ran with their owner's rights, which skip row-level
-- security. Anyone holding the public (anon) key could read the vendor list
-- through them even though the tables themselves refused. These make each view
-- obey the signed-in user's permissions, and close the door for signed-out users.
-- (Needs Postgres 15 or later; every current Supabase project has it.)
-- ------------------------------------------------------------
alter view public.site_summary       set (security_invoker = true);
alter view public.expiring_documents set (security_invoker = true);
alter view public.vendor_dashboard   set (security_invoker = true);

revoke all on public.site_summary, public.expiring_documents, public.vendor_dashboard from anon;
grant select on public.site_summary, public.expiring_documents, public.vendor_dashboard to authenticated;
grant select on public.site_summary, public.expiring_documents, public.vendor_dashboard to service_role;


-- ------------------------------------------------------------
-- CHECK — should list every view as security_invoker and the new columns
-- ------------------------------------------------------------
select c.relname as view, coalesce(array_to_string(c.reloptions, ','), '*** NOT security_invoker ***') as options
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v' order by 1;
