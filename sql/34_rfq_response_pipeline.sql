-- ============================================================
-- RFQ RESPONSE PIPELINE
--
-- Answers "how do vendors actually respond, and how does that reach the
-- system": every rfq_vendor row gets its own unique, unauthenticated
-- response_token. Whichever channel actually reaches the vendor --
-- email, a WhatsApp message, or a phone call where a staff member reads
-- the link out -- the link itself is the same, and lands on a public
-- page (app/rfq-respond/[token]) where the vendor submits a price (or
-- declines) with no login. That is the one piece of this flow that is
-- genuinely automatable without new paid infrastructure: a structured,
-- channel-agnostic way for a response to reach the system directly,
-- rather than a staff member re-keying whatever came back over email,
-- WhatsApp or a call.
--
-- Also adds: a real status per invited vendor (sent / responded /
-- declined / no_response -- rather than just a timestamp), a vendor
-- score computed from response rate + feedback history (feeds B2 in the
-- flow spec: "vendor ranking: score, response rate, feedback"), and
-- extends the existing audit log to every RFQ table.
-- ============================================================

do $$ begin
  create type rfq_vendor_status as enum ('sent', 'responded', 'declined', 'no_response');
exception when duplicate_object then null; end $$;

alter table public.rfq_vendor
  add column if not exists status rfq_vendor_status,
  add column if not exists response_token uuid unique default gen_random_uuid(),
  add column if not exists responded_at timestamptz;

-- Anything already marked sent under the old sent_at-only model gets a
-- real status, so the new column isn't blank for existing data.
update public.rfq_vendor set status = 'sent' where sent_at is not null and status is null;

-- ------------------------------------------------------------
-- Vendor score — response rate (of RFQs actually concluded, not still
-- pending) plus average feedback rating Fitsol itself gave. A vendor
-- with no history yet gets a neutral score rather than being penalised
-- for simply being new.
-- ------------------------------------------------------------
create or replace view public.vendor_score as
select
  s.id as site_id,
  count(*) filter (where rv.status = 'responded') as quotes_given,
  count(*) filter (where rv.status in ('responded', 'declined', 'no_response')) as rfqs_concluded,
  case when count(*) filter (where rv.status in ('responded', 'declined', 'no_response')) > 0
    then round(count(*) filter (where rv.status = 'responded')::numeric
               / count(*) filter (where rv.status in ('responded', 'declined', 'no_response')), 2)
    else null end as response_rate,
  (select round(avg(f.rating), 2) from public.rfq_feedback f
     join public.vendor_order vo on vo.id = f.order_id
     join public.purchase_order po on po.id = vo.purchase_order_id
     where po.site_id = s.id and f.from_party = 'fitsol') as avg_rating
from public.vendor_site s
left join public.rfq_vendor rv on rv.site_id = s.id
group by s.id;

alter view public.vendor_score set (security_invoker = true);
grant select on public.vendor_score to authenticated;

-- ------------------------------------------------------------
-- Vendor matching, re-ranked: score first (how reliably this vendor
-- responds and how it has performed before), geography overlap as the
-- tie-break -- matches the flow spec's split between B1 (filter by
-- field/geography) and B2 (rank by score/response rate/feedback).
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
         -- 0-100: half from response rate, half from average feedback rating,
         -- neutral (50/50) defaults for a vendor with no history to judge yet.
         round(coalesce(vs.response_rate, 0.5) * 50 + coalesce(vs.avg_rating, 3) / 5 * 50, 1) as match_score
  from overlap o
  join public.vendor_site s on s.id = o.site_id
  join public.company c on c.id = s.company_id and c.deleted_at is null
  left join public.vendor_score vs on vs.site_id = s.id
  order by match_score desc, o.geo_overlap desc, s.site_code
  limit p_limit;
$$;

-- ------------------------------------------------------------
-- The public response link's read + write — both security definer,
-- same reasoning as public_vendor_signup: an anonymous vendor has no
-- RLS-permitted path otherwise. Only ever reachable with the right
-- token; nothing here is guessable or enumerable.
-- ------------------------------------------------------------
create or replace function public.get_rfq_response_context(p_token uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'legal_name', c.legal_name,
    'site_code', s.site_code,
    'rfq_number', r.rfq_number,
    'title', r.title,
    'industry', req.industry,
    'description', req.description,
    'quantity', req.quantity,
    'unit', req.unit,
    'needed_by', req.needed_by,
    'response_deadline', r.response_deadline,
    'status', rv.status,
    'existing_quote', (select jsonb_build_object('price', q.price, 'terms', q.terms, 'valid_until', q.valid_until, 'notes', q.notes)
                        from public.rfq_quotation q where q.rfq_id = rv.rfq_id and q.site_id = rv.site_id)
  )
  from public.rfq_vendor rv
  join public.vendor_site s on s.id = rv.site_id
  join public.company c on c.id = s.company_id
  join public.rfq r on r.id = rv.rfq_id
  join public.requirement req on req.id = r.requirement_id
  where rv.response_token = p_token;
$$;

grant execute on function public.get_rfq_response_context(uuid) to anon, authenticated;

create or replace function public.submit_rfq_response(
  p_token uuid, p_action text, p_price numeric default null, p_terms text default null,
  p_valid_until date default null, p_notes text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rv record;
begin
  select rv.rfq_id, rv.site_id into v_rv
    from public.rfq_vendor rv where rv.response_token = p_token;
  if v_rv is null then
    raise exception 'This link is not valid.';
  end if;
  if p_action = 'decline' then
    update public.rfq_vendor set status = 'declined', responded_at = now()
      where response_token = p_token;
  elsif p_action = 'quote' then
    if p_price is null or p_price <= 0 then
      raise exception 'Enter a price.';
    end if;
    insert into public.rfq_quotation (rfq_id, site_id, price, terms, valid_until, notes, received_at)
    values (v_rv.rfq_id, v_rv.site_id, p_price, nullif(p_terms, ''), p_valid_until, nullif(p_notes, ''), now())
    on conflict (rfq_id, site_id) do update
      set price = excluded.price, terms = excluded.terms,
          valid_until = excluded.valid_until, notes = excluded.notes, received_at = now();
    update public.rfq_vendor set status = 'responded', responded_at = now()
      where response_token = p_token;
    update public.rfq set status = 'collecting_responses'
      where id = v_rv.rfq_id and status = 'sent';
  else
    raise exception 'Unknown action.';
  end if;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.submit_rfq_response(uuid, text, numeric, text, date, text) to anon, authenticated;

-- ------------------------------------------------------------
-- "Always on: audit log of every action" -- the existing write_audit()
-- trigger function (sql/01_schema.sql) is table-agnostic, but assumes a
-- uuid primary key (it inserts new.id into audit_log.record_id, which is
-- uuid) -- order_status_event uses a bigserial id instead, so it's left
-- out here; it is already its own append-only timeline by design.
-- ------------------------------------------------------------
do $$
declare t text;
begin
  for t in select unnest(array[
    'requirement', 'rfq', 'rfq_vendor', 'rfq_quotation',
    'purchase_order', 'vendor_order', 'rfq_feedback'
  ]) loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I
                     for each row execute function public.write_audit()', t, t);
  end loop;
end $$;
