-- Backs the new Adoption & Usage view (visible to Maneet only, same pattern
-- as app/(app)/activity -- gated by ACTIVITY_LOG_EMAIL at the app layer,
-- is_admin() at the database layer).
--
-- Everything else that view needs already exists: login_log (sql/28) for
-- staff DAU/MAU, onboard_visit (sql/32) for the public sign-up form's
-- opens-vs-submits funnel. The one gap: nothing logs a staff member opening
-- the Add Vendor wizard, so there was no way to compare that against how
-- many Internal vendors actually get created. This table closes that gap,
-- the same shape as onboard_visit but for a signed-in user instead of an
-- anonymous one -- so a plain insert under the normal can_write() policy is
-- enough; no security-definer RPC needed here.
create table if not exists public.wizard_visit (
  id         bigserial primary key,
  visited_at timestamptz not null default now(),
  profile_id uuid references public.profile(id)
);

alter table public.wizard_visit enable row level security;

drop policy if exists wizard_visit_read on public.wizard_visit;
create policy wizard_visit_read on public.wizard_visit for select using (public.is_admin());

drop policy if exists wizard_visit_write on public.wizard_visit;
create policy wizard_visit_write on public.wizard_visit for insert with check (public.can_write());
