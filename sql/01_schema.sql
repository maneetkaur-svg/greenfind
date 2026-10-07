-- ============================================================
-- GREENFIND VENDOR MASTER — 01 SCHEMA
-- Supabase SQL Editor → New query → paste → Run.
-- Safe to re-run, and now safe on a BRAND-NEW project too (the earlier
-- version stopped on a fresh database; see the note at "COMPANY_ID_PAN").
--
-- Supersedes the earlier single-table schema. The company/site
-- split is explained in PRD §4; the short version is that GSTIN
-- is unique neither per company nor per plant, so PAN keys the
-- company and the site carries the registration.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- ENUMS
-- ------------------------------------------------------------
do $$ begin create type industry_type as enum ('recycling','packaging','transportation');
exception when duplicate_object then null; end $$;

do $$ begin create type entity_type as enum
  ('proprietorship','partnership','llp','llc','pvt_ltd','public_ltd','trust','foreign');
exception when duplicate_object then null; end $$;

do $$ begin create type msme_category as enum ('micro','small','medium');
exception when duplicate_object then null; end $$;

do $$ begin create type nda_status as enum ('yes','no','inprocess');
exception when duplicate_object then null; end $$;

-- Three roles. super_admin decides, operations does the work, user reads.
do $$ begin create type app_role as enum ('super_admin','operations','user');
exception when duplicate_object then null; end $$;

do $$ begin create type requirement_level as enum ('required','conditional','recommended','optional');
exception when duplicate_object then null; end $$;

do $$ begin create type uploaded_by_party as enum ('vendor','fitsol');
exception when duplicate_object then null; end $$;

do $$ begin create type request_type as enum ('edit','delete');
exception when duplicate_object then null; end $$;

do $$ begin create type request_status as enum ('pending','approved','rejected');
exception when duplicate_object then null; end $$;


-- ------------------------------------------------------------
-- PROFILE — who can sign in, and as what.
-- Every policy in 02_security.sql reads this table. A signed-in
-- user with no row here can do nothing at all.
-- ------------------------------------------------------------
create table if not exists public.profile (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  email      text,
  role       app_role not null default 'user',
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);


-- ------------------------------------------------------------
-- COMPANY — one row per legal entity, keyed on PAN.
-- Holds what a company has exactly one of.
-- ------------------------------------------------------------
create table if not exists public.company (
  id           uuid primary key default gen_random_uuid(),
  company_code text unique not null,                    -- VEN 007
  pan          char(10) unique not null,

  legal_name   text not null,
  trade_name   text,
  entity       entity_type,
  cin          varchar(21),
  is_msme      boolean not null default false,
  msme_category msme_category,
  udyam_number varchar(19),
  year_established smallint,
  website      text,

  -- banking: all required before a vendor can be paid
  bank_account_name   varchar(150),
  bank_account_number varchar(18),
  ifsc                char(11),
  bank_branch         varchar(150),
  cheque_on_file      boolean not null default false,

  -- agreements
  authorised_signatory varchar(100),
  nda_status           nda_status,
  nda_signed_date      date,

  -- commercial
  turnover_current  numeric(16,2),
  turnover_previous numeric(16,2),
  key_clients       text,
  serves_tier1_oem  boolean,

  migrated_from_portal boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profile(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profile(id),
  deleted_at timestamptz,

  constraint pan_format  check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  constraint ifsc_format check (ifsc is null or ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  constraint year_range  check (year_established is null
    or year_established between 1900 and extract(year from now())::int),
  -- MSME yes => category and Udyam number both present
  constraint msme_complete check (is_msme is not true
    or (msme_category is not null and udyam_number is not null)),
  -- a registered company must carry a CIN
  constraint cin_when_company check (entity is null
    or entity not in ('pvt_ltd','public_ltd','llp') or cin is not null)
);

-- COMPANY_ID_PAN
-- vendor_site's foreign key points at (id, pan), which needs this unique
-- constraint to exist first. The earlier version of this file tried to drop and
-- recreate it by altering vendor_site BEFORE vendor_site existed, which stops the
-- script on a new project. This form works on both a new and an existing database.
do $$ begin
  alter table public.company add constraint company_id_pan unique (id, pan);
exception when duplicate_object or duplicate_table then null; end $$;

create index if not exists company_name_idx on public.company
  using gin (to_tsvector('simple', coalesce(legal_name,'')||' '||coalesce(trade_name,'')||' '||coalesce(company_code,'')));


-- ------------------------------------------------------------
-- VENDOR_SITE — one row per plant.
-- pan is GENERATED from the GSTIN, and the composite foreign key
-- below means the database itself refuses to attach a site to the
-- wrong company. A typo cannot create an orphan.
-- ------------------------------------------------------------
create table if not exists public.vendor_site (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  site_code  text unique not null,                      -- VEN 007-A
  site_name  varchar(120),

  gstin      char(15) not null,
  pan        char(10) generated always as (substring(gstin from 3 for 10)) stored,

  industry   industry_type not null,

  address_line1 varchar(255) not null,
  city          varchar(100) not null,
  state         varchar(100) not null,
  pincode       char(6) not null,
  is_registered_address boolean not null default true,
  geo_outside_india     boolean not null default false,

  migrated_from_portal boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profile(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profile(id),
  deleted_at timestamptz,

  constraint gstin_format   check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$'),
  constraint pincode_format check (pincode ~ '^[1-9][0-9]{5}$'),

  constraint site_belongs_to_company
    foreign key (company_id, pan) references public.company (id, pan) on delete cascade,

  -- two plants in one state are fine; the same plant twice is not
  constraint site_unique unique (gstin, pincode)
);

create index if not exists site_company_idx  on public.vendor_site (company_id) where deleted_at is null;
create index if not exists site_industry_idx on public.vendor_site (industry)   where deleted_at is null;
create index if not exists site_state_idx    on public.vendor_site (state)      where deleted_at is null;
create index if not exists site_gstin_idx    on public.vendor_site (gstin)      where deleted_at is null;


-- ------------------------------------------------------------
-- CONTACTS — three per site, ranks 1 and 2 required by the app
-- ------------------------------------------------------------
create table if not exists public.site_contact (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references public.vendor_site(id) on delete cascade,
  rank        smallint not null check (rank between 1 and 3),
  name        varchar(100) not null,
  designation varchar(100),
  mobile      char(10),
  email       varchar(255),
  constraint contact_mobile_format check (mobile is null or mobile ~ '^[6-9][0-9]{9}$'),
  constraint contact_email_format  check (email  is null or email  ~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),
  unique (site_id, rank)
);


-- ------------------------------------------------------------
-- GEOGRAPHY AND CATEGORIES
-- ------------------------------------------------------------
create table if not exists public.site_geography (
  site_id uuid not null references public.vendor_site(id) on delete cascade,
  state   varchar(100) not null,
  primary key (site_id, state)
);

create table if not exists public.service_category (
  id        uuid primary key default gen_random_uuid(),
  industry  industry_type not null,
  code      text not null,
  label     text not null,
  sort      smallint not null default 0,
  is_active boolean not null default true,
  unique (industry, code)
);

create table if not exists public.service_subcategory (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.service_category(id) on delete cascade,
  code        text not null,
  label       text not null,
  sort        smallint not null default 0,
  is_active   boolean not null default true,
  unique (category_id, code)
);

create table if not exists public.site_service_category (
  site_id     uuid not null references public.vendor_site(id) on delete cascade,
  category_id uuid not null references public.service_category(id),
  primary key (site_id, category_id)
);

create table if not exists public.site_service_subcategory (
  site_id        uuid not null references public.vendor_site(id) on delete cascade,
  subcategory_id uuid not null references public.service_subcategory(id),
  primary key (site_id, subcategory_id)
);


-- ------------------------------------------------------------
-- OPERATIONS — industry-dependent, entirely optional
-- ------------------------------------------------------------
create table if not exists public.site_operations (
  site_id uuid primary key references public.vendor_site(id) on delete cascade,
  -- plant industries
  installed_capacity numeric(14,2),
  capacity_unit      text,
  utilisation_pct    numeric(5,2),
  storage_capacity   numeric(14,2),
  products_made      text,
  minimum_order_qty  numeric(14,2),
  lead_time_days     smallint,
  machines           smallint,
  workers            integer,
  employees          integer,
  shifts_per_day     smallint,
  hours_per_shift    numeric(3,1),
  working_days_week  smallint,
  floor_area         numeric(12,2),
  power_backup       boolean,
  -- transportation (PROPOSED: not in the approved schema)
  fleet_owned    integer,
  fleet_attached integer,
  fleet_ev       integer,
  fleet_cng      integer,
  vehicle_types  text[],
  charging_infra text,
  telematics_provider varchar(100),
  drivers_on_roll integer,
  depots          integer,
  lanes_served    text,
  constraint utilisation_range  check (utilisation_pct is null or utilisation_pct between 0 and 100),
  constraint capacity_positive  check (installed_capacity is null or installed_capacity > 0)
);


-- ------------------------------------------------------------
-- DOCUMENTS — metadata here, the file in Storage
-- ------------------------------------------------------------
create table if not exists public.document_type (
  code  text primary key,
  label text not null,
  applies_to text,
  expiry_tracked boolean not null default false,
  uploaded_by_party uploaded_by_party not null default 'vendor',
  is_certificate boolean not null default false,
  sort smallint not null default 0
);

create table if not exists public.document_requirement (
  doc_type text not null references public.document_type(code) on delete cascade,
  industry industry_type not null,
  level    requirement_level not null default 'optional',
  condition_note text,
  primary key (doc_type, industry)
);

create table if not exists public.site_document (
  id           uuid primary key default gen_random_uuid(),
  site_id      uuid not null references public.vendor_site(id) on delete cascade,
  doc_type     text not null references public.document_type(code),
  storage_path text not null,
  file_name    text not null,
  file_size    bigint,
  mime_type    text,
  doc_number   varchar(60),
  issued_on    date,
  valid_until  date,
  uploaded_by  uuid references public.profile(id),
  uploaded_at  timestamptz not null default now(),
  verified_by  uuid references public.profile(id),
  verified_at  timestamptz,
  verify_note  text,
  superseded_at timestamptz,
  constraint file_size_limit check (file_size is null or file_size <= 10485760),
  constraint verified_pair   check ((verified_by is null) = (verified_at is null))
);

create index if not exists doc_site_idx   on public.site_document (site_id)     where superseded_at is null;
create index if not exists doc_expiry_idx on public.site_document (valid_until) where superseded_at is null and valid_until is not null;


-- ------------------------------------------------------------
-- CERTIFICATE DATA — read off the CTO and the EPR registration
-- ------------------------------------------------------------
create table if not exists public.site_certificate_data (
  site_id uuid primary key references public.vendor_site(id) on delete cascade,
  -- Consent to Operate
  cto_order_no varchar(60), cto_file_no varchar(90), cto_board varchar(90), cto_unit_id varchar(30),
  cto_valid_from date, cto_valid_to date,
  cto_category text, cto_category_sr varchar(60), cto_product varchar(150),
  cto_capacity numeric(14,2), cto_capacity_unit text,
  cto_fresh_water_kld numeric(10,2), cto_groundwater boolean,
  cto_trade_effluent_kld numeric(10,2), cto_effluent_recycled_kld numeric(10,2),
  cto_zld boolean, cto_etp boolean, cto_fuels text[],
  cto_green_belt_pct numeric(5,2), cto_project_cost_lakh numeric(12,2),
  cto_cgwa_required boolean, cto_cgwa_obtained boolean, cto_conditions text,
  -- EPR / PWP registration
  epr_reg_no varchar(60), epr_board varchar(90), epr_type text,
  epr_issue_date date, epr_valid_to date, epr_processing_code varchar(20),
  epr_auth_cats text[],
  epr_cat1 numeric(12,2), epr_cat2 numeric(12,2), epr_cat3 numeric(12,2), epr_cat4 numeric(12,2),
  epr_product varchar(120), epr_product_qty numeric(12,2), epr_outstanding text,
  -- what Fitsol needs from this site
  need_cats text[], intended_volume_tpa numeric(12,2),
  updated_at timestamptz not null default now()
);


-- ------------------------------------------------------------
-- CHANGE REQUESTS — the approval queue (PRD §10)
-- ------------------------------------------------------------
create table if not exists public.change_request (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid references public.vendor_site(id) on delete cascade,
  company_id uuid references public.company(id) on delete cascade,
  type       request_type not null,
  status     request_status not null default 'pending',
  diff       jsonb,              -- [{field, label, from, to}]
  proposed   jsonb,              -- {field: newValue}
  reason     text not null,
  requested_by uuid not null references public.profile(id),
  requested_at timestamptz not null default now(),
  decided_by   uuid references public.profile(id),
  decided_at   timestamptz,
  decision_note text,
  constraint reason_not_empty check (length(trim(reason)) >= 10),
  constraint rejection_has_note check (status <> 'rejected'
    or (decision_note is not null and length(trim(decision_note)) > 0)),
  constraint targets_something check (site_id is not null or company_id is not null)
);

-- only one open request per site at a time
create unique index if not exists one_open_request_per_site
  on public.change_request (site_id) where status = 'pending' and site_id is not null;

create index if not exists cr_pending_idx on public.change_request (requested_at desc) where status = 'pending';


-- ------------------------------------------------------------
-- AUDIT — append-only
-- ------------------------------------------------------------
create table if not exists public.audit_log (
  id         bigserial primary key,
  table_name text not null,
  record_id  uuid not null,
  action     text not null,
  changed    jsonb,
  actor      uuid,
  at         timestamptz not null default now()
);
create index if not exists audit_record_idx on public.audit_log (table_name, record_id, at desc);


-- ------------------------------------------------------------
-- TRIGGERS
-- ------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists company_touch on public.company;
create trigger company_touch before update on public.company
for each row execute function public.touch_updated_at();

drop trigger if exists site_touch on public.vendor_site;
create trigger site_touch before update on public.vendor_site
for each row execute function public.touch_updated_at();

-- Every change to a vendor writes an audit row. In the trigger, not in
-- application code, because application code can be bypassed.
create or replace function public.write_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare changes jsonb := '{}'::jsonb; k text; oldv jsonb; newv jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log(table_name, record_id, action, changed, actor)
    values (tg_table_name, new.id, 'insert', to_jsonb(new), auth.uid());
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log(table_name, record_id, action, changed, actor)
    values (tg_table_name, old.id, 'delete', to_jsonb(old), auth.uid());
    return old;
  else
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      oldv := to_jsonb(old) -> k; newv := to_jsonb(new) -> k;
      if oldv is distinct from newv and k not in ('updated_at','updated_by') then
        changes := changes || jsonb_build_object(k, jsonb_build_array(oldv, newv));
      end if;
    end loop;
    if changes <> '{}'::jsonb then
      insert into public.audit_log(table_name, record_id, action, changed, actor)
      values (tg_table_name, new.id, 'update', changes, auth.uid());
    end if;
    return new;
  end if;
end $$;

drop trigger if exists company_audit on public.company;
create trigger company_audit after insert or update or delete on public.company
for each row execute function public.write_audit();

drop trigger if exists site_audit on public.vendor_site;
create trigger site_audit after insert or update or delete on public.vendor_site
for each row execute function public.write_audit();

drop trigger if exists doc_audit on public.site_document;
create trigger doc_audit after insert or update or delete on public.site_document
for each row execute function public.write_audit();

-- Replacing a document supersedes the old row rather than overwriting it,
-- so the verification trail survives.
create or replace function public.supersede_previous_document() returns trigger
language plpgsql as $$
begin
  update public.site_document
     set superseded_at = now()
   where site_id = new.site_id and doc_type = new.doc_type
     and id <> new.id and superseded_at is null;
  return new;
end $$;

drop trigger if exists doc_supersede on public.site_document;
create trigger doc_supersede after insert on public.site_document
for each row execute function public.supersede_previous_document();


-- ------------------------------------------------------------
-- VIEWS
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
  s.migrated_from_portal, s.updated_at
from public.vendor_site s
join public.company c on c.id = s.company_id
where s.deleted_at is null and c.deleted_at is null;

-- The screen that stops a certificate lapsing unnoticed.
create or replace view public.expiring_documents as
select s.site_code, c.legal_name, s.industry, s.state,
       t.label as document, d.valid_until, (d.valid_until - current_date) as days_left
from public.site_document d
join public.vendor_site s on s.id = d.site_id
join public.company c on c.id = s.company_id
join public.document_type t on t.code = d.doc_type
where d.superseded_at is null and s.deleted_at is null
  and d.valid_until is not null and d.valid_until <= current_date + 60
order by d.valid_until;


-- ------------------------------------------------------------
-- CODE GENERATION — VEN 007 and VEN 007-A
-- ------------------------------------------------------------
create sequence if not exists public.company_code_seq start 1;

create or replace function public.next_company_code() returns text
language sql as $$
  select 'VEN ' || lpad(nextval('public.company_code_seq')::text, 3, '0')
$$;

create or replace function public.next_site_code(p_company uuid) returns text
language plpgsql as $$
declare base text; n int;
begin
  select company_code into base from public.company where id = p_company;
  select count(*) into n from public.vendor_site where company_id = p_company;
  return base || '-' || chr(65 + n);          -- -A, -B, -C
end $$;

-- Find the company that a GSTIN belongs to. This is what powers the
-- "already on record under this PAN" prompt.
create or replace function public.company_for_gstin(p_gstin text)
returns table (id uuid, company_code text, legal_name text, site_count bigint)
language sql stable as $$
  select c.id, c.company_code, c.legal_name,
         (select count(*) from public.vendor_site s
            where s.company_id = c.id and s.deleted_at is null)
  from public.company c
  where c.pan = substring(upper(p_gstin) from 3 for 10)
    and c.deleted_at is null
$$;


select 'tables' as check, count(*)::text as value from information_schema.tables where table_schema='public'
union all select 'enums', count(*)::text from pg_type where typtype='e' and typnamespace='public'::regnamespace
union all select 'views', count(*)::text from information_schema.views where table_schema='public';
