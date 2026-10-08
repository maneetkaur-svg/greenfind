-- ============================================================
-- GREENFIND — 09 INDUSTRY: SUPER ADMIN ONLY
-- Run AFTER 08_vendor_list_fixes.sql. Safe to re-run.
--
-- Reclassifying an existing vendor's industry changes which document rules,
-- categories and tabs apply to it — Operations can create vendors and set
-- their industry, but changing it on an EXISTING record is Super Admin
-- only. The app already hides/disables the control for anyone else (see
-- lib/schema.ts, SectionForm.tsx, actions.ts) — this is the enforcement
-- that holds even if the app is bypassed, matching how every other
-- permission in this project works: Postgres decides, not application code.
--
-- This only fires on UPDATE, so creating a new vendor (an INSERT) and
-- choosing its industry is completely unaffected.
--
-- service_role (local scripts run with the service-role key, e.g.
-- scripts/import/classify-industry.ts) is deliberately exempt: whoever
-- holds that key already bypasses every row-level security rule in this
-- project, so this is not a new hole — it is the same trust boundary the
-- rest of the schema already draws.
-- ============================================================

create or replace function public.guard_industry_change() returns trigger
language plpgsql as $$
begin
  if old.industry is distinct from new.industry
     and auth.role() <> 'service_role'
     and not public.is_admin() then
    raise exception 'Only a Super Admin can change a vendor''s industry.';
  end if;
  return new;
end $$;

drop trigger if exists site_industry_guard on public.vendor_site;
create trigger site_industry_guard before update on public.vendor_site
for each row execute function public.guard_industry_change();
