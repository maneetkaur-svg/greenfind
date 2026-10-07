-- ============================================================
-- TEST for 06_data_fit.sql — run in the Supabase SQL Editor on STAGING.
-- It inserts test rows, checks every rule the migration changed, and then
-- ROLLS EVERYTHING BACK, so it leaves no data behind. It does not use the
-- code counters, so it does not burn VEN numbers either.
--
-- Success: the last message says  "ALL CHECKS PASSED".
-- Failure: it stops at the first broken rule and names it.
-- ============================================================
begin;

create or replace function pg_temp.expect_fail(sql text, expected_state text, label text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlstate = expected_state then
      raise notice 'ok   - % (refused as it should be)', label; return;
    end if;
    raise exception 'FAIL - %: refused, but with %, expected % (%)', label, sqlstate, expected_state, sqlerrm;
  end;
  raise exception 'FAIL - %: this was accepted but should have been refused', label;
end $$;

create or replace function pg_temp.expect_ok(sql text, label text) returns void
language plpgsql as $$
begin
  execute sql;
  raise notice 'ok   - %', label;
exception when others then
  raise exception 'FAIL - %: should have been accepted, got % (%)', label, sqlstate, sqlerrm;
end $$;

-- two test companies
insert into public.company (company_code, pan, legal_name) values
  ('ZZ-T1', 'TESTA9999A', 'ZZ DBTEST Alpha'),
  ('ZZ-T2', 'TESTB9999B', 'ZZ DBTEST Beta');

-- 1. A migrated site may lack GSTIN, address, industry — it only needs a PAN to belong to a company
select pg_temp.expect_ok($q$
  insert into public.vendor_site (company_id, site_code, pan, migrated_from_portal)
  select id, 'ZZ-T1-A', 'TESTA9999A', true from public.company where company_code = 'ZZ-T1'
$q$, 'migrated site with only a PAN is accepted');

-- 2. A NEW site must still be complete
select pg_temp.expect_fail($q$
  insert into public.vendor_site (company_id, site_code, gstin, industry, address_line1, city, state, pincode)
  select id, 'ZZ-T1-B', '08TESTA9999A1ZA', 'recycling', null, 'Alwar', 'Rajasthan', '301707'
  from public.company where company_code = 'ZZ-T1'
$q$, '23514', 'a new site with no address is refused');

select pg_temp.expect_fail($q$
  insert into public.vendor_site (company_id, site_code, pan, industry, address_line1, city, state, pincode)
  select id, 'ZZ-T1-B', 'TESTA9999A', 'recycling', 'x', 'Alwar', 'Rajasthan', '301707'
  from public.company where company_code = 'ZZ-T1'
$q$, '23514', 'a new site with no GSTIN is refused');

-- 3. PAN follows the GSTIN, even if the insert does not supply it
select pg_temp.expect_ok($q$
  insert into public.vendor_site (company_id, site_code, gstin, industry, address_line1, city, state, pincode)
  select id, 'ZZ-T1-C', '08TESTA9999A1ZA', 'recycling', 'Plot 1', 'Alwar', 'Rajasthan', '301707'
  from public.company where company_code = 'ZZ-T1'
$q$, 'a complete new site, inserted without a PAN, is accepted');

do $$ begin
  if (select pan from public.vendor_site where site_code = 'ZZ-T1-C') <> 'TESTA9999A' then
    raise exception 'FAIL - the PAN was not taken from the GSTIN'; end if;
  raise notice 'ok   - the PAN was taken from the GSTIN';
end $$;

-- 4. The company/site guarantee still holds: a GSTIN under another PAN cannot attach
select pg_temp.expect_fail($q$
  insert into public.vendor_site (company_id, site_code, gstin, industry, address_line1, city, state, pincode)
  select id, 'ZZ-T2-X', '08TESTA9999A1ZA', 'recycling', 'x', 'Alwar', 'Rajasthan', '301708'
  from public.company where company_code = 'ZZ-T2'
$q$, '23503', 'a site cannot attach to a company with a different PAN');

-- 5. A site with no GSTIN must still say which company it is by PAN: and the PAN must exist
select pg_temp.expect_fail($q$
  insert into public.vendor_site (company_id, site_code, pan, migrated_from_portal)
  select id, 'ZZ-T2-Y', 'TESTA9999A', true from public.company where company_code = 'ZZ-T2'
$q$, '23503', 'a site with no GSTIN cannot claim another company''s PAN');

-- 6. Same GSTIN + pincode is still the same plant
select pg_temp.expect_fail($q$
  insert into public.vendor_site (company_id, site_code, gstin, industry, address_line1, city, state, pincode)
  select id, 'ZZ-T1-D', '08TESTA9999A1ZA', 'recycling', 'again', 'Alwar', 'Rajasthan', '301707'
  from public.company where company_code = 'ZZ-T1'
$q$, '23505', 'the same GSTIN and pincode twice is refused');

-- 7. Old-system vendor codes are unique
select pg_temp.expect_ok($q$
  update public.vendor_site set legacy_vendor_code = 'V-100' where site_code = 'ZZ-T1-A'
$q$, 'a legacy vendor code can be recorded');
select pg_temp.expect_fail($q$
  update public.vendor_site set legacy_vendor_code = 'V-100' where site_code = 'ZZ-T1-C'
$q$, '23505', 'the same legacy vendor code twice is refused');

-- 8. MSME rule: strict for new companies, relaxed for migrated ones
select pg_temp.expect_fail($q$
  insert into public.company (company_code, pan, legal_name, is_msme) values ('ZZ-T3', 'TESTC9999C', 'ZZ DBTEST Gamma', true)
$q$, '23514', 'a new MSME with no category or Udyam number is refused');
select pg_temp.expect_ok($q$
  insert into public.company (company_code, pan, legal_name, is_msme, migrated_from_portal)
  values ('ZZ-T4', 'TESTD9999D', 'ZZ DBTEST Delta', true, true)
$q$, 'a migrated MSME with no category or Udyam number is accepted');

-- 9. Credit period and status
select pg_temp.expect_ok($q$ update public.company set credit_period_days = 45, credit_period_note = null where company_code = 'ZZ-T1' $q$, 'credit period of 45 days');
select pg_temp.expect_fail($q$ update public.company set credit_period_days = 400 where company_code = 'ZZ-T1' $q$, '23514', 'credit period over 365 days is refused');
select pg_temp.expect_fail($q$ update public.vendor_site set status = 'maybe' where site_code = 'ZZ-T1-A' $q$, '22P02', 'an unknown status is refused');
select pg_temp.expect_fail($q$ update public.vendor_site set aadhaar_last4 = '12345678' where site_code = 'ZZ-T1-A' $q$, '22001', 'a full Aadhaar number cannot be stored');

-- 10. Dashboard: totals agree with what is there
do $$
declare t int; u int; r int;
begin
  select vendors into t from public.vendor_dashboard where industry = 'total';
  select vendors into u from public.vendor_dashboard where industry = 'unclassified';
  select vendors into r from public.vendor_dashboard where industry = 'recycling';
  if u is null or u < 1 then raise exception 'FAIL - migrated site with no industry is not counted as unclassified'; end if;
  if r is null or r < 1 then raise exception 'FAIL - recycling vendor missing from the dashboard'; end if;
  if t < greatest(u, r) then raise exception 'FAIL - dashboard total (%) is smaller than a single industry', t; end if;
  raise notice 'ok   - dashboard: total % vendors, % recycling, % unclassified', t, r, u;
end $$;

-- 11. The views obey the signed-in user's permissions
do $$
declare n int;
begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'v'
     and c.relname in ('site_summary','expiring_documents','vendor_dashboard')
     and coalesce(c.reloptions::text, '') like '%security_invoker=true%';
  if n <> 3 then raise exception 'FAIL - only % of 3 views are security_invoker', n; end if;
  raise notice 'ok   - all three views are security_invoker';
end $$;

do $$ begin raise notice '========== ALL CHECKS PASSED =========='; end $$;
rollback;
