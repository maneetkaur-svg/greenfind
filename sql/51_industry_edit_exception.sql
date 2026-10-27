-- A named, per-person exception to "changing a vendor's industry is Super
-- Admin only" (sql/09_industry_super_admin_only.sql) -- not a role
-- promotion. Madhu gets this one capability while staying Operations for
-- everything else (Users, RFQs, Analytics, vendor deletion, etc. all stay
-- out of reach). A boolean column rather than a hardcoded id, so granting
-- or revoking this for anyone later is a one-row UPDATE, not a new
-- migration.
alter table public.profile
  add column if not exists can_edit_vendor_industry boolean not null default false;

create or replace function public.guard_industry_change() returns trigger
language plpgsql as $$
begin
  if old.industry is distinct from new.industry
     and auth.role() <> 'service_role'
     and not public.is_admin()
     and not coalesce((select p.can_edit_vendor_industry from public.profile p where p.id = auth.uid()), false) then
    raise exception 'Only a Super Admin can change a vendor''s industry.';
  end if;
  return new;
end $$;

-- Grant the exception to Madhu specifically.
update public.profile set can_edit_vendor_industry = true
where email = 'madhu.sharma@fitsol.green';
