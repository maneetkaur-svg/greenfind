-- ============================================================
-- GREENFIND — 10 DEFAULT GEOGRAPHY FROM GSTIN
-- Run AFTER 09_industry_super_admin_only.sql. Safe to re-run.
--
-- A GSTIN's first two digits name the state it was registered in — the
-- same fact lib/constants.ts already uses to fill a blank State field on
-- import. This does the equivalent for Geography (site_geography,
-- "serviceable states"): the home state is marked as served automatically.
--
-- This is NOT a one-off. Two triggers make it permanent for every future
-- vendor, whatever creates it — the "Add vendor" wizard, the legacy bulk
-- importer (import_vendor_group), or anything added later:
--   - after a vendor_site is INSERTed with a GSTIN
--   - after an existing vendor_site's GSTIN is set or changed
-- The one-time INSERT at the bottom catches every vendor already on
-- record today. Everything here is purely additive (ON CONFLICT DO
-- NOTHING) — it only ever adds the home state, never removes or
-- overrides whatever else is already picked on the Geography tab.
-- ============================================================

create or replace function public.state_from_gstin(p_gstin text) returns text
language sql immutable as $$
  select case substring(upper(p_gstin) from 1 for 2)
    when '01' then 'Jammu & Kashmir' when '02' then 'Himachal Pradesh' when '03' then 'Punjab'
    when '04' then 'Chandigarh'      when '05' then 'Uttarakhand'      when '06' then 'Haryana'
    when '07' then 'Delhi'           when '08' then 'Rajasthan'        when '09' then 'Uttar Pradesh'
    when '10' then 'Bihar'           when '11' then 'Sikkim'           when '12' then 'Arunachal Pradesh'
    when '13' then 'Nagaland'        when '14' then 'Manipur'          when '15' then 'Mizoram'
    when '16' then 'Tripura'         when '17' then 'Meghalaya'        when '18' then 'Assam'
    when '19' then 'West Bengal'     when '20' then 'Jharkhand'        when '21' then 'Odisha'
    when '22' then 'Chhattisgarh'    when '23' then 'Madhya Pradesh'   when '24' then 'Gujarat'
    when '26' then 'DNH & Daman Diu' when '27' then 'Maharashtra'      when '29' then 'Karnataka'
    when '30' then 'Goa'             when '31' then 'Lakshadweep'      when '32' then 'Kerala'
    when '33' then 'Tamil Nadu'      when '34' then 'Puducherry'       when '35' then 'Andaman & Nicobar'
    when '36' then 'Telangana'       when '37' then 'Andhra Pradesh'   when '38' then 'Ladakh'
    else null
  end
$$;

create or replace function public.site_default_geography() returns trigger
language plpgsql as $$
declare v_state text;
begin
  if new.gstin is not null and (tg_op = 'INSERT' or old.gstin is distinct from new.gstin) then
    v_state := public.state_from_gstin(new.gstin);
    if v_state is not null then
      insert into public.site_geography (site_id, state) values (new.id, v_state)
      on conflict do nothing;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists site_default_geography_ins on public.vendor_site;
create trigger site_default_geography_ins after insert on public.vendor_site
for each row execute function public.site_default_geography();

drop trigger if exists site_default_geography_upd on public.vendor_site;
create trigger site_default_geography_upd after update of gstin on public.vendor_site
for each row execute function public.site_default_geography();


-- ------------------------------------------------------------
-- ONE-TIME CATCH-UP — every vendor already on record
-- ------------------------------------------------------------
insert into public.site_geography (site_id, state)
select s.id, public.state_from_gstin(s.gstin)
from public.vendor_site s
where s.gstin is not null and s.deleted_at is null
  and public.state_from_gstin(s.gstin) is not null
on conflict do nothing;


-- ------------------------------------------------------------
-- CHECK — how many sites now have at least one serviceable state
-- ------------------------------------------------------------
select count(distinct site_id) as sites_with_geography from public.site_geography;
