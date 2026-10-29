-- ============================================================
-- TEST for sql/54a/54b/54c — run in the Supabase SQL Editor on STAGING,
-- after all three have been applied there.
--
-- Every analytics_* function is security definer and starts with
-- `if not public.is_admin() then raise exception`, which reads
-- auth.uid() -- empty when this script runs as the SQL Editor's own
-- postgres role. The set_config() call below fakes a real JWT for the
-- rest of this transaction, the same trick Supabase's own docs use for
-- testing RLS from the SQL Editor.
--
-- public.profile.id is a foreign key into auth.users (01_schema.sql), so
-- this test impersonates REAL, already-existing profiles rather than
-- inserting fake ones -- a fake row here would fail that FK (or, if you
-- worked around it by faking auth.users too, would leave a login-capable
-- ghost user behind). It needs at least one real super_admin profile to
-- run at all, and gets more complete coverage with a second, non-admin
-- profile; either way, rollback at the end undoes every test row (ZZ-A54-*)
-- and leaves every real profile exactly as it was.
--
-- Success: the last message says "ALL CHECKS PASSED".
-- Failure: it stops at the first broken rule and names it.
-- ============================================================
begin;

do $$
declare v_admin uuid;
begin
  select id into v_admin from public.profile where role = 'super_admin' and is_active limit 1;
  if v_admin is null then
    raise exception 'FAIL - no active super_admin profile exists in this environment to run this test as';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('zz.dbtest_admin', v_admin::text, true);
  set local role authenticated;
end $$;

-- Two companies, three sites: two in Recycling/Rajasthan/import (one last
-- month, one eleven months ago), one in Packaging/Gujarat/manual, created
-- by a real profile (any other than the admin above, if one exists) so the
-- "addedBy" filter has something real to match against.
do $$
declare
  v_staff  uuid;
  v_co1    uuid; v_co2 uuid;
  v_cat    uuid;
begin
  select id into v_staff from public.profile
  where is_active and id <> current_setting('zz.dbtest_admin')::uuid
  limit 1;
  if v_staff is null then
    v_staff := current_setting('zz.dbtest_admin')::uuid;
    raise notice 'note - only one active profile exists in this environment; reusing it to attribute the test sites';
  end if;
  perform set_config('zz.dbtest_staff', v_staff::text, true);

  insert into public.company (company_code, pan, legal_name)
  values ('ZZ-A54-1', 'ZZAT549991A', 'ZZ DBTEST Recyc Co')
  returning id into v_co1;
  insert into public.company (company_code, pan, legal_name)
  values ('ZZ-A54-2', 'ZZAT549992B', 'ZZ DBTEST Pack Co')
  returning id into v_co2;

  insert into public.vendor_site (
    company_id, site_code, gstin, industry, address_line1, city, state, pincode,
    source, created_by, created_at
  ) values
    (v_co1, 'ZZ-A54-1-A', '08ZZAT549991A1ZA', 'recycling', 'x', 'Jaipur', 'Rajasthan', '302001',
     'import', v_staff, now() - interval '20 days'),
    (v_co1, 'ZZ-A54-1-B', '08ZZAT549991A1ZB', 'recycling', 'x', 'Jaipur', 'Rajasthan', '302001',
     'import', v_staff, now() - interval '11 months'),
    (v_co2, 'ZZ-A54-2-A', '24ZZAT549992B1ZC', 'packaging', 'x', 'Surat', 'Gujarat', '395001',
     'manual', null, now() - interval '5 days');

  select id into v_cat from public.service_category where industry = 'recycling' limit 1;
  if v_cat is not null then
    insert into public.site_service_category (site_id, category_id)
    select id, v_cat from public.vendor_site where site_code = 'ZZ-A54-1-A';
  end if;
end $$;

-- 1. KPI total matches a plain count of the three test sites (scoped by
--    state so pre-existing vendors in the real data don't throw this off).
do $$
declare v_total int;
begin
  select (public.analytics_summary(jsonb_build_object('state', 'Rajasthan'))->'kpi'->>'total')::int into v_total;
  if v_total <> 2 then raise exception 'FAIL - KPI total for Rajasthan is %, expected 2', v_total; end if;
  raise notice 'ok   - KPI total respects the state filter';
end $$;

-- 2. By-source ignores its own filter: filtering to source=manual must not
--    zero out the import row's count in the by_source breakdown.
do $$
declare v_import_count int;
begin
  select coalesce((
    select (row->>'count')::int
    from jsonb_array_elements(public.analytics_summary(
      jsonb_build_object('state', 'Rajasthan', 'source', 'manual')
    )->'by_source') row
    where row->>'source' = 'import'
  ), -1) into v_import_count;
  if v_import_count <> 2 then
    raise exception 'FAIL - by_source ignoring its own filter gave import=%, expected 2', v_import_count;
  end if;
  raise notice 'ok   - by_source ignores the Source filter on itself';
end $$;

-- 3. Vertical tabs ignore the vertical filter: Packaging's tab count must
--    still show 1 even while the page is filtered to vertical=recycling.
do $$
declare v_packaging int;
begin
  select coalesce((
    select (row->>'count')::int
    from jsonb_array_elements(public.analytics_summary(
      jsonb_build_object('vertical', 'recycling', 'state', 'Gujarat')
    )->'by_vertical') row
    where row->>'id' = 'packaging'
  ), -1) into v_packaging;
  if v_packaging <> 1 then
    raise exception 'FAIL - by_vertical ignoring the vertical filter gave packaging=%, expected 1', v_packaging;
  end if;
  raise notice 'ok   - by_vertical tab counts ignore the vertical/category/sub-category filters';
end $$;

-- 4. By-geography: State mode ignores State AND City; City mode ignores
--    only City (so it still respects a chosen State).
do $$
declare v_state_count int; v_city_count int;
begin
  select coalesce((
    select (row->>'count')::int from jsonb_array_elements(
      public.analytics_summary(jsonb_build_object('state', 'Gujarat'))->'by_state'
    ) row where row->>'state' = 'Rajasthan'
  ), -1) into v_state_count;
  if v_state_count <> 2 then
    raise exception 'FAIL - by_state ignoring State/City gave Rajasthan=%, expected 2', v_state_count;
  end if;

  select coalesce((
    select (row->>'count')::int from jsonb_array_elements(
      public.analytics_summary(jsonb_build_object('state', 'Rajasthan', 'city', 'Jaipur'))->'by_city'
    ) row where row->>'city' = 'Jaipur'
  ), -1) into v_city_count;
  if v_city_count <> 2 then
    raise exception 'FAIL - by_city within a chosen state gave Jaipur=%, expected 2', v_city_count;
  end if;
  raise notice 'ok   - by_geography ignore-rules (State mode ignores State+City, City mode ignores City only)';
end $$;

-- 5. Window filter: 12m excludes the site created 11 months ago is FALSE
--    (11 months is within a 12-month window) but a tight 30d window must
--    exclude it while keeping the 20-day-old one.
do $$
declare v_30d int;
begin
  select (public.analytics_summary(jsonb_build_object('state', 'Rajasthan', 'window', '30d'))->'kpi'->>'total')::int
    into v_30d;
  if v_30d <> 1 then raise exception 'FAIL - 30-day window gave %, expected 1 (only the 20-day-old site)', v_30d; end if;
  raise notice 'ok   - the Added window filter narrows correctly';
end $$;

-- 6. Trend: default (include_imports=false) must drop the two import rows
--    from Rajasthan; forcing include_imports=true must count them.
do $$
declare v_excl_total int; v_incl_total int;
begin
  select coalesce(sum((b->>'count')::int), 0) into v_excl_total
  from jsonb_array_elements(
    public.analytics_trend(jsonb_build_object('state', 'Rajasthan'), 'monthly', false)->'buckets'
  ) b;
  select coalesce(sum((b->>'count')::int), 0) into v_incl_total
  from jsonb_array_elements(
    public.analytics_trend(jsonb_build_object('state', 'Rajasthan'), 'monthly', true)->'buckets'
  ) b;
  if v_excl_total <> 0 then
    raise exception 'FAIL - trend with include_imports=false counted % import rows, expected 0', v_excl_total;
  end if;
  if v_incl_total <> 2 then
    raise exception 'FAIL - trend with include_imports=true counted %, expected 2', v_incl_total;
  end if;
  raise notice 'ok   - bulk-import exclusion toggle works both ways';
end $$;

-- 7. addedBy: the staff id finds both Rajasthan sites; 'external' finds
--    the Gujarat site (created_by is null). Scoped to state=Rajasthan /
--    Gujarat respectively, same as every other check here, because the
--    staff id is a REAL profile (see the note at the top of this file) and
--    may already be attributed to unrelated real vendors elsewhere.
do $$
declare v_staff_id uuid := current_setting('zz.dbtest_staff')::uuid; v_by_staff int; v_external int;
begin
  select (public.analytics_summary(jsonb_build_object('addedBy', v_staff_id::text, 'state', 'Rajasthan'))->'kpi'->>'total')::int
    into v_by_staff;
  select (public.analytics_summary(jsonb_build_object('addedBy', 'external', 'state', 'Gujarat'))->'kpi'->>'total')::int
    into v_external;
  if v_by_staff <> 2 then raise exception 'FAIL - addedBy=staff gave %, expected 2', v_by_staff; end if;
  if v_external <> 1 then raise exception 'FAIL - addedBy=external gave %, expected 1', v_external; end if;
  raise notice 'ok   - addedBy filter handles both a real profile id and the "external" sentinel';
end $$;

-- 8. Taxonomy reflects a live rename with no code change: relabel a
--    category, re-call analytics_taxonomy(), see the new label.
do $$
declare v_cat_id uuid; v_old_label text; v_seen_label text;
begin
  select id, label into v_cat_id, v_old_label from public.service_category where industry = 'recycling' limit 1;
  if v_cat_id is null then
    raise notice 'skip - no recycling category to rename in this environment';
  else
    update public.service_category set label = 'ZZ DBTEST RENAMED' where id = v_cat_id;
    select cat->>'label' into v_seen_label
    from jsonb_array_elements(public.analytics_taxonomy()->'verticals') v,
         jsonb_array_elements(v->'categories') cat
    where v->>'id' = 'recycling' and cat->>'id' = v_cat_id::text;
    if v_seen_label <> 'ZZ DBTEST RENAMED' then
      raise exception 'FAIL - analytics_taxonomy() still shows "%", expected the renamed label', v_seen_label;
    end if;
    raise notice 'ok   - analytics_taxonomy() picks up a category rename with no code change';
  end if;
end $$;

-- 9. A vertical with no categories (Warehouse) returns an empty array, not
--    an error or a null.
do $$
declare v_cats jsonb;
begin
  select v->'categories' into v_cats
  from jsonb_array_elements(public.analytics_taxonomy()->'verticals') v
  where v->>'id' = 'warehouse';
  if v_cats is null or jsonb_typeof(v_cats) <> 'array' or jsonb_array_length(v_cats) <> 0 then
    raise exception 'FAIL - Warehouse should have an empty categories array, got %', v_cats;
  end if;
  raise notice 'ok   - a vertical with no categories (Warehouse) is an empty array, not an error';
end $$;

-- 10. A non-admin is refused. Impersonates a real, already-existing
--     non-super_admin profile rather than inserting one (same FK reason as
--     the admin/staff lookups above); skips if this environment somehow
--     has only super_admin profiles.
do $$
declare v_user uuid;
begin
  select id into v_user from public.profile where role <> 'super_admin' and is_active limit 1;
  if v_user is null then
    raise notice 'skip - no non-super_admin profile exists in this environment to test the refusal against';
    return;
  end if;
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  begin
    perform public.analytics_summary('{}'::jsonb);
    raise exception 'FAIL - a non-super_admin caller was allowed to read analytics_summary';
  exception when others then
    if sqlerrm like 'Only a super admin%' then
      raise notice 'ok   - a non-admin is refused';
    else
      raise exception 'FAIL - unexpected error for a non-admin caller: %', sqlerrm;
    end if;
  end;
end $$;

do $$ begin raise notice '========== ALL CHECKS PASSED =========='; end $$;
rollback;
