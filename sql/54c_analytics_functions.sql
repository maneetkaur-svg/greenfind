-- Run after sql/54b has committed. Super-admin-only aggregate functions for
-- the rebuilt Analytics page -- every count below comes from a SQL GROUP BY
-- against site_summary, never from loading every vendor into the app and
-- counting there (the old page's approach).
--
-- Every function here takes the same filter shape, a jsonb object with any
-- of these keys, all optional:
--   vertical      industry_type code, e.g. "recycling"
--   category      service_category.id
--   subcategory   service_subcategory.id
--   state         vendor_site.state
--   region        site_summary.region (sql/54d) -- north/south/east/west/
--                 northeast/pan_india/outside_india
--   source        vendor_source code, e.g. "import"
--   addedBy       profile.id, or the literal string "external" for a
--                 vendor with no staff attribution (created_by is null)
--   window        "30d" | "90d" | "12m" | "all" (default)
--
-- analytics_filtered_sites is the one place that turns that jsonb into a
-- set of matching site ids; p_ignore names which of the keys above to skip,
-- which is how "this table's own filter doesn't zero out its own rows"
-- (the by-source table ignoring Source, a vertical tab ignoring vertical/
-- category/subcategory, by-geography ignoring state/region) is implemented
-- once, correctly, instead of six times with six chances to drift apart.
create or replace function public.analytics_filtered_sites(p jsonb, p_ignore text[] default '{}')
returns table (site_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select ss.id
  from public.site_summary ss
  where
    (
      'vertical' = any(p_ignore) or p->>'vertical' is null
      or ss.industry = (p->>'vertical')::industry_type
    )
    and (
      'state' = any(p_ignore) or p->>'state' is null or ss.state = p->>'state'
    )
    and (
      'region' = any(p_ignore) or p->>'region' is null or ss.region = p->>'region'
    )
    and (
      'source' = any(p_ignore) or p->>'source' is null
      or ss.source = (p->>'source')::vendor_source
    )
    and (
      'addedBy' = any(p_ignore) or p->>'addedBy' is null
      or (p->>'addedBy' = 'external' and ss.created_by is null)
      or ss.created_by = nullif(p->>'addedBy', 'external')::uuid
    )
    and (
      'window' = any(p_ignore) or p->>'window' is null or p->>'window' = 'all'
      or ss.created_at >= case p->>'window'
           when '30d' then now() - interval '30 days'
           when '90d' then now() - interval '90 days'
           when '12m' then now() - interval '12 months'
           else '-infinity'::timestamptz
         end
    )
    and (
      'category' = any(p_ignore) or p->>'category' is null
      or exists (
        select 1 from public.site_service_category c2
        where c2.site_id = ss.id and c2.category_id = (p->>'category')::uuid
      )
    )
    and (
      'subcategory' = any(p_ignore) or p->>'subcategory' is null
      or exists (
        select 1 from public.site_service_subcategory sc2
        where sc2.site_id = ss.id and sc2.subcategory_id = (p->>'subcategory')::uuid
      )
    );
$$;


-- Verticals, each with their categories and sub-categories (ordered,
-- including inactive ones so the UI can still label a vendor's existing
-- choice "(inactive)" instead of showing nothing), plus the staff list for
-- the "Added by" filter. Fetched once by the page and cached client-side --
-- nothing here changes except when an admin edits the taxonomy itself.
create or replace function public.analytics_taxonomy()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only a super admin can read analytics.';
  end if;

  select jsonb_build_object(
    'verticals', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.code,
        'label', v.label,
        'is_active', v.is_active,
        'categories', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', cat.id,
            'label', cat.label,
            'is_active', cat.is_active,
            'subcategories', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', sub.id, 'label', sub.label, 'is_active', sub.is_active
              ) order by sub.sort, sub.label), '[]'::jsonb)
              from public.service_subcategory sub
              where sub.category_id = cat.id
            )
          ) order by cat.sort, cat.label), '[]'::jsonb)
          from public.service_category cat
          where cat.industry = v.code
        )
      ) order by v.sort_order), '[]'::jsonb)
      from public.vertical v
    ),
    'added_by', (
      select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.full_name) order by pr.full_name), '[]'::jsonb)
      from public.profile pr
      where pr.is_active
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.analytics_taxonomy() from public;
grant execute on function public.analytics_taxonomy() to authenticated;


-- One call, everything the dashboard needs: KPIs, by-source, by-vertical
-- (tab counts), by-category/sub-category for whichever vertical is active,
-- and by-state/by-region -- each computed with its own ignore-list per the
-- rules in the comment above analytics_filtered_sites.
create or replace function public.analytics_summary(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only a super admin can read analytics.';
  end if;

  with
  all_sites as (
    select ss.* from public.analytics_filtered_sites(p) f join public.site_summary ss on ss.id = f.site_id
  ),
  source_sites as (
    select ss.* from public.analytics_filtered_sites(p, array['source']) f join public.site_summary ss on ss.id = f.site_id
  ),
  vertical_sites as (
    select ss.* from public.analytics_filtered_sites(p, array['vertical','category','subcategory']) f
    join public.site_summary ss on ss.id = f.site_id
  ),
  category_sites as (
    select ss.* from public.analytics_filtered_sites(p, array['category','subcategory']) f
    join public.site_summary ss on ss.id = f.site_id
  ),
  state_sites as (
    select ss.* from public.analytics_filtered_sites(p, array['state','region']) f join public.site_summary ss on ss.id = f.site_id
  ),
  region_sites as (
    select ss.* from public.analytics_filtered_sites(p, array['region']) f join public.site_summary ss on ss.id = f.site_id
  ),
  active_vertical as (
    select (p->>'vertical')::industry_type as code
  ),
  vertical_counts as (
    select
      v.code, v.label, v.sort_order, v.is_active,
      count(vs.id) as cnt,
      count(vs.id) filter (where vs.core_complete and vs.banking_complete) as verified_cnt
    from public.vertical v
    left join vertical_sites vs on vs.industry = v.code
    group by v.code, v.label, v.sort_order, v.is_active
  ),
  category_counts as (
    select
      cat.id, cat.label, cat.sort, cat.is_active,
      exists(select 1 from public.service_subcategory sc where sc.category_id = cat.id) as has_subs,
      count(cs.id) as cnt,
      count(cs.id) filter (where cs.core_complete and cs.banking_complete) as verified_cnt
    from public.service_category cat
    join active_vertical av on cat.industry = av.code
    left join public.site_service_category ssc on ssc.category_id = cat.id
    left join category_sites cs on cs.id = ssc.site_id
    group by cat.id, cat.label, cat.sort, cat.is_active
  ),
  subcategory_counts as (
    select
      sub.id, sub.category_id, sub.label, sub.sort, sub.is_active,
      count(cs.id) as cnt,
      count(cs.id) filter (where cs.core_complete and cs.banking_complete) as verified_cnt
    from public.service_subcategory sub
    join category_counts cc on cc.id = sub.category_id
    left join public.site_service_subcategory sss on sss.subcategory_id = sub.id
    left join category_sites cs on cs.id = sss.site_id
    group by sub.id, sub.category_id, sub.label, sub.sort, sub.is_active
  )
  select jsonb_build_object(
    'kpi', (
      select jsonb_build_object(
        'total', count(*),
        'added_this_month', count(*) filter (
          where timezone('Asia/Kolkata', created_at) >= date_trunc('month', timezone('Asia/Kolkata', now()))
        ),
        'onboarded', count(*) filter (where not core_complete),
        'verified', count(*) filter (where core_complete and banking_complete),
        'unverified', count(*) filter (where core_complete and not banking_complete)
      )
      from all_sites
    ),
    'by_source', (
      select coalesce(jsonb_agg(jsonb_build_object('source', source, 'count', cnt) order by cnt desc), '[]'::jsonb)
      from (select source, count(*) as cnt from source_sites group by source) t
    ),
    'by_vertical', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', code, 'label', label, 'is_active', is_active,
        'count', cnt, 'verified', verified_cnt
      ) order by sort_order), '[]'::jsonb)
      from vertical_counts
    ),
    'by_category', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'label', label, 'is_active', is_active, 'has_subcategories', has_subs,
        'count', cnt, 'verified', verified_cnt
      ) order by sort, label), '[]'::jsonb)
      from category_counts
    ),
    'by_subcategory', (
      select coalesce(jsonb_object_agg(category_id::text, subs), '{}'::jsonb)
      from (
        select category_id, jsonb_agg(jsonb_build_object(
          'id', id, 'label', label, 'is_active', is_active, 'count', cnt, 'verified', verified_cnt
        ) order by sort, label) as subs
        from subcategory_counts
        group by category_id
      ) t
    ),
    'by_state', (
      select coalesce(jsonb_agg(jsonb_build_object('state', state, 'count', cnt) order by cnt desc), '[]'::jsonb)
      from (select state, count(*) as cnt from state_sites group by state) t
    ),
    'by_region', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'region', region,
        'label', case region
          when 'north' then 'North' when 'south' then 'South' when 'east' then 'East'
          when 'west' then 'West' when 'northeast' then 'North East'
          when 'pan_india' then 'Pan India' when 'outside_india' then 'Outside India'
          else region
        end,
        'count', cnt
      ) order by cnt desc), '[]'::jsonb)
      from (select region, count(*) as cnt from region_sites where region is not null group by region) t
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.analytics_summary(jsonb) from public;
grant execute on function public.analytics_summary(jsonb) to authenticated;


-- Bucketed counts for the "Vendors added over time" chart. Every bucket in
-- the fixed window is present even at zero (generate_series), so a quiet
-- month still draws a bar. p_include_imports=false drops source='import'
-- entirely from the count UNLESS the filter set already pins source to
-- 'import' (the app forces the checkbox on and disables it in that case --
-- this is the matching server-side rule, so a direct call can't disagree
-- with what the UI shows).
create or replace function public.analytics_trend(p jsonb, p_granularity text, p_include_imports boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  v_from timestamptz;
  v_step interval;
  v_trunc text;
  v_drop_imports boolean;
begin
  if not public.is_admin() then
    raise exception 'Only a super admin can read analytics.';
  end if;

  case p_granularity
    when 'daily' then
      v_from := date_trunc('day', timezone('Asia/Kolkata', now())) - interval '29 days';
      v_step := interval '1 day'; v_trunc := 'day';
    when 'weekly' then
      v_from := date_trunc('week', timezone('Asia/Kolkata', now())) - interval '11 weeks';
      v_step := interval '1 week'; v_trunc := 'week';
    when 'monthly' then
      v_from := date_trunc('month', timezone('Asia/Kolkata', now())) - interval '11 months';
      v_step := interval '1 month'; v_trunc := 'month';
    else
      raise exception 'Unknown granularity: %', p_granularity;
  end case;

  v_drop_imports := not p_include_imports and (p->>'source') is distinct from 'import';

  with
  eligible as (
    select ss.created_at
    from public.analytics_filtered_sites(p, array['window']) f
    join public.site_summary ss on ss.id = f.site_id
    where not (v_drop_imports and ss.source = 'import')
  ),
  series as (
    select generate_series(v_from, date_trunc(v_trunc, timezone('Asia/Kolkata', now())), v_step)::date as bucket
  ),
  grouped as (
    select date_trunc(v_trunc, timezone('Asia/Kolkata', created_at))::date as bucket, count(*) as cnt
    from eligible
    group by 1
  ),
  excluded as (
    select count(*) as cnt
    from public.analytics_filtered_sites(p, array['window']) f
    join public.site_summary ss on ss.id = f.site_id
    where v_drop_imports and ss.source = 'import'
      and timezone('Asia/Kolkata', ss.created_at) >= v_from
  )
  select jsonb_build_object(
    'granularity', p_granularity,
    'buckets', (
      select coalesce(jsonb_agg(jsonb_build_object('bucket', series.bucket, 'count', coalesce(grouped.cnt, 0)) order by series.bucket), '[]'::jsonb)
      from series left join grouped using (bucket)
    ),
    'excluded_imports', (select cnt from excluded)
  ) into result;

  return result;
end;
$$;

revoke all on function public.analytics_trend(jsonb, text, boolean) from public;
grant execute on function public.analytics_trend(jsonb, text, boolean) to authenticated;


-- Paged rows for the vendor drawer (and, with p_page_size null, the CSV
-- export of either the drawer or the page header -- LIMIT NULL in Postgres
-- means no limit, so the same function serves both without a second code
-- path). p->>'from' / p->>'to' narrow to a clicked trend-chart bar's date
-- range; both are plain ISO timestamps, inclusive/exclusive.
create or replace function public.analytics_vendors(p jsonb, p_q text default null, p_page int default 1, p_page_size int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only a super admin can read analytics.';
  end if;

  with matched as (
    select ss.*
    from public.analytics_filtered_sites(p) f
    join public.site_summary ss on ss.id = f.site_id
    where (p->>'from' is null or ss.created_at >= (p->>'from')::timestamptz)
      and (p->>'to' is null or ss.created_at < (p->>'to')::timestamptz)
      and (
        coalesce(p_q, '') = ''
        or ss.legal_name ilike '%' || p_q || '%'
        or ss.city ilike '%' || p_q || '%'
        or ss.state ilike '%' || p_q || '%'
      )
  ),
  paged as (
    select * from matched
    order by created_at desc
    limit p_page_size
    offset case when p_page_size is null then 0 else (greatest(p_page, 1) - 1) * p_page_size end
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'legal_name', legal_name, 'city', city, 'state', state,
        'core_complete', core_complete, 'banking_complete', banking_complete,
        'source', source, 'created_at', created_at
      ) order by created_at desc)
      from paged
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.analytics_vendors(jsonb, text, int, int) from public;
grant execute on function public.analytics_vendors(jsonb, text, int, int) to authenticated;


-- Backs the kept-from-the-old-page "Data quality details" panel (missing
-- required documents, and the policy gaps the portal doesn't yet enforce)
-- -- same checks the old Analytics page ran in JS after loading every
-- vendor, now one GROUP BY against the current filter set instead.
create or replace function public.analytics_detail_gaps(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only a super admin can read analytics.';
  end if;

  with
  scoped as (
    select s.id, s.industry, s.company_id
    from public.analytics_filtered_sites(p) f
    join public.vendor_site s on s.id = f.site_id
  ),
  -- per scoped SITE, not per distinct company (a company with two matching
  -- sites and a blank field counts twice — same as the old page's own
  -- per-site loop over companyById.get(s.company_id)).
  per_site as (
    select s.id as site_id, c.entity, c.is_msme, c.msme_category, c.udyam_number,
           c.year_established, c.authorised_signatory, c.cheque_on_file, c.trade_name
    from scoped s
    join public.company c on c.id = s.company_id
  ),
  required_docs as (
    select r.industry, r.doc_type, t.label
    from public.document_requirement r
    join public.document_type t on t.code = r.doc_type
    where r.level = 'required' and t.uploaded_by_party = 'vendor'
  ),
  attached as (
    select site_id, doc_type from public.site_document
    where superseded_at is null and site_id in (select id from scoped)
  ),
  missing as (
    select rd.label, count(*) as cnt
    from scoped s
    join required_docs rd on rd.industry = s.industry
    where not exists (select 1 from attached a where a.site_id = s.id and a.doc_type = rd.doc_type)
    group by rd.label
  ),
  contact_gap as (
    select count(distinct s.id) as cnt
    from scoped s
    join public.site_contact sc on sc.site_id = s.id and sc.rank in (1, 2)
    where coalesce(sc.designation, '') = '' or coalesce(sc.email, '') = ''
  ),
  zero_cat as (
    select count(*) as cnt from scoped s
    where not exists (select 1 from public.site_service_category ssc where ssc.site_id = s.id)
  )
  select jsonb_build_object(
    'total', (select count(*) from scoped),
    'missing_documents', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'count', cnt) order by cnt desc) from missing), '[]'::jsonb),
    'entity_blank', (select count(*) from per_site where entity is null),
    'msme_incomplete', (select count(*) from per_site where is_msme and (msme_category is null or udyam_number is null)),
    'year_blank', (select count(*) from per_site where year_established is null),
    'signatory_blank', (select count(*) from per_site where coalesce(authorised_signatory, '') = ''),
    'cheque_false', (select count(*) from per_site where not cheque_on_file),
    'trade_name_blank', (select count(*) from per_site where coalesce(trade_name, '') = ''),
    'zero_categories', (select cnt from zero_cat),
    'contact_gap', (select cnt from contact_gap)
  ) into result;

  return result;
end;
$$;

revoke all on function public.analytics_detail_gaps(jsonb) from public;
grant execute on function public.analytics_detail_gaps(jsonb) to authenticated;
