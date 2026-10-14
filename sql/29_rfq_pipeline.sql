-- ============================================================
-- RFQ / ORDER JOURNEY PIPELINE
-- Requirement -> RFQ -> vendor matching -> (manual send) -> quotations
-- (manually entered) -> Purchase Order -> Order -> status timeline ->
-- feedback (vendor/fitsol/client).
--
-- "Fired via WhatsApp community and email" is NOT live automation here —
-- that needs a verified Meta WhatsApp Business API account (a paid BSP,
-- business verification, pre-approved message templates) and a proper
-- transactional email provider, neither of which exist yet. The app
-- generates the RFQ content and the selected vendors' contact details;
-- a human sends it through their own WhatsApp/email and marks it sent.
-- Same for responses: there is no inbound parsing, so quotations are
-- entered by a person after they arrive.
-- ============================================================

do $$ begin create type requirement_status as enum ('open', 'closed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin create type rfq_status as enum (
  'draft', 'vendors_selected', 'sent', 'collecting_responses',
  'quote_selected', 'po_sent', 'po_signed', 'order_created',
  'in_progress', 'shipped', 'delivered', 'completed', 'cancelled'
);
exception when duplicate_object then null; end $$;

do $$ begin create type po_status as enum ('draft', 'sent', 'signed', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin create type order_status as enum (
  'created', 'in_progress', 'shipped', 'delivered', 'completed', 'cancelled'
);
exception when duplicate_object then null; end $$;

do $$ begin create type feedback_party as enum ('vendor', 'fitsol', 'client');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- A client need. Created by hand for now; "later we connect to CRM" means
-- a future import/sync path writes into this same table, not a new one.
-- ------------------------------------------------------------
create table if not exists public.requirement (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  industry      industry_type not null,
  description   text,
  geography     text[] not null default '{}',   -- states this need applies to
  quantity      numeric,
  unit          varchar(30),
  target_price  numeric,
  needed_by     date,
  status        requirement_status not null default 'open',
  created_by    uuid references public.profile(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create sequence if not exists public.rfq_number_seq;
create or replace function public.next_rfq_number() returns text
language sql as $$
  select 'RFQ-' || lpad(nextval('public.rfq_number_seq')::text, 5, '0')
$$;

create table if not exists public.rfq (
  id                 uuid primary key default gen_random_uuid(),
  rfq_number         text unique not null default public.next_rfq_number(),
  requirement_id     uuid not null references public.requirement(id),
  title              text not null,
  status             rfq_status not null default 'draft',
  response_deadline  timestamptz,
  created_by         uuid references public.profile(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  sent_at            timestamptz
);
create index if not exists rfq_requirement_idx on public.rfq (requirement_id);

-- Candidate vendors for an RFQ. The matching pass inserts every vendor
-- that qualifies (ranked), a human then ticks `selected` on the ones to
-- actually send to.
create table if not exists public.rfq_vendor (
  id           uuid primary key default gen_random_uuid(),
  rfq_id       uuid not null references public.rfq(id) on delete cascade,
  site_id      uuid not null references public.vendor_site(id),
  match_rank   int,
  match_score  numeric,
  selected     boolean not null default false,
  sent_at      timestamptz,
  unique (rfq_id, site_id)
);
create index if not exists rfq_vendor_rfq_idx on public.rfq_vendor (rfq_id);

-- A vendor's quotation — entered by a person once the response arrives
-- by whatever channel it actually came through.
create table if not exists public.rfq_quotation (
  id           uuid primary key default gen_random_uuid(),
  rfq_id       uuid not null references public.rfq(id) on delete cascade,
  site_id      uuid not null references public.vendor_site(id),
  price        numeric,
  currency     varchar(8) not null default 'INR',
  terms        text,
  valid_until  date,
  notes        text,
  received_at  timestamptz not null default now(),
  entered_by   uuid references public.profile(id),
  is_selected  boolean not null default false,
  unique (rfq_id, site_id)
);
create index if not exists rfq_quotation_rfq_idx on public.rfq_quotation (rfq_id);

create sequence if not exists public.po_number_seq;
create or replace function public.next_po_number() returns text
language sql as $$
  select 'PO-' || lpad(nextval('public.po_number_seq')::text, 5, '0')
$$;

create table if not exists public.purchase_order (
  id                   uuid primary key default gen_random_uuid(),
  rfq_id               uuid not null references public.rfq(id),
  site_id              uuid not null references public.vendor_site(id),
  po_number            text unique not null default public.next_po_number(),
  amount               numeric,
  terms                text,
  status               po_status not null default 'draft',
  signed_document_path text,
  sent_at              timestamptz,
  signed_at            timestamptz,
  created_by           uuid references public.profile(id),
  created_at           timestamptz not null default now()
);
create index if not exists purchase_order_rfq_idx on public.purchase_order (rfq_id);

create table if not exists public.vendor_order (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid not null references public.purchase_order(id),
  rfq_id             uuid not null references public.rfq(id),
  status             order_status not null default 'created',
  tracking_info      text,
  created_at         timestamptz not null default now(),
  delivered_at       timestamptz
);
create index if not exists vendor_order_rfq_idx on public.vendor_order (rfq_id);

create table if not exists public.order_status_event (
  id          bigserial primary key,
  order_id    uuid not null references public.vendor_order(id) on delete cascade,
  status      order_status not null,
  note        text,
  changed_by  uuid references public.profile(id),
  at          timestamptz not null default now()
);
create index if not exists order_status_event_order_idx on public.order_status_event (order_id, at desc);

-- Three-sided feedback once an order is delivered — feeds vendor
-- evaluation/scoring (not built yet; this is the data it will read).
create table if not exists public.rfq_feedback (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.vendor_order(id) on delete cascade,
  from_party    feedback_party not null,
  rating        smallint check (rating between 1 and 5),
  comments      text,
  submitted_by  uuid references public.profile(id),
  submitted_at  timestamptz not null default now(),
  unique (order_id, from_party)
);

-- ------------------------------------------------------------
-- RLS — same floor as the rest of this schema: can_read() to see it,
-- can_write() to create/edit, is_admin() to delete.
-- ------------------------------------------------------------
do $$
declare t text;
begin
  for t in select unnest(array[
    'requirement', 'rfq', 'rfq_vendor', 'rfq_quotation',
    'purchase_order', 'vendor_order', 'order_status_event', 'rfq_feedback'
  ]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select using (public.can_read())', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for insert with check (public.can_write())', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('create policy %I_update on public.%I for update using (public.can_write()) with check (public.can_write())', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('create policy %I_delete on public.%I for delete using (public.is_admin())', t, t);
  end loop;
end $$;

grant select on public.rfq_number_seq, public.po_number_seq to authenticated;

-- ------------------------------------------------------------
-- Vendor matching — industry must match exactly; ranked by how many of
-- the requirement's needed states the vendor actually serves. Simple and
-- auditable on purpose: every number here is visible on the page, not a
-- black box.
-- ------------------------------------------------------------
create or replace function public.match_vendors_for_requirement(p_requirement_id uuid, p_limit int default 10)
returns table (
  site_id uuid, company_id uuid, site_code text, legal_name text,
  state text, city text, geo_overlap int, match_score numeric
)
language sql stable security invoker as $$
  with req as (
    select industry, geography from public.requirement where id = p_requirement_id
  ),
  overlap as (
    select s.id as site_id,
           count(*) filter (where sg.state::text = any (req.geography)) as geo_overlap
    from public.vendor_site s
    cross join req
    left join public.site_geography sg on sg.site_id = s.id
    where s.deleted_at is null and s.status = 'active'
      and s.industry = req.industry
    group by s.id
  )
  select s.id, s.company_id, s.site_code, c.legal_name, s.state, s.city,
         o.geo_overlap::int,
         o.geo_overlap::numeric as match_score
  from overlap o
  join public.vendor_site s on s.id = o.site_id
  join public.company c on c.id = s.company_id and c.deleted_at is null
  order by o.geo_overlap desc, s.site_code
  limit p_limit;
$$;

grant execute on function public.match_vendors_for_requirement(uuid, int) to authenticated;
