-- Verified directly against the live database while building the new
-- Adoption & Usage view: login_log (sql/28) and onboard_visit (sql/32)
-- were both never actually run -- same "written but never applied" pattern
-- as sql/27/37 and sql/24/42 earlier. This means two of the three sections
-- on the existing /activity page ("Sign-ins" and "Vendor sign-up link
-- opens") have been silently empty or erroring this whole time; only
-- "Changes made" (audit_log, which was part of the original 01_schema.sql)
-- has actually been working.
--
-- Combined, one-paste run of all three tables the Adoption & Usage view
-- (and /activity) need: sql/28, sql/32 and sql/44, unchanged, wrapped in
-- one transaction. Safe to re-run.

begin;

-- ============================================================
-- sql/28_login_log.sql
-- ============================================================

create table if not exists public.login_log (
  id          bigserial primary key,
  profile_id  uuid not null references public.profile(id) on delete cascade,
  logged_in_at timestamptz not null default now()
);
create index if not exists login_log_profile_idx on public.login_log (profile_id, logged_in_at desc);

alter table public.login_log enable row level security;

drop policy if exists login_log_insert on public.login_log;
create policy login_log_insert on public.login_log for insert
  with check (profile_id = auth.uid());

drop policy if exists login_log_select on public.login_log;
create policy login_log_select on public.login_log for select
  using (public.is_admin());


-- ============================================================
-- sql/32_onboard_visit_log.sql
-- ============================================================

create table if not exists public.onboard_visit (
  id         bigserial primary key,
  visited_at timestamptz not null default now(),
  ip         text,
  user_agent text
);

alter table public.onboard_visit enable row level security;
drop policy if exists onboard_visit_read on public.onboard_visit;
create policy onboard_visit_read on public.onboard_visit for select using (public.is_admin());

create or replace function public.log_onboard_visit(p_ip text, p_user_agent text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.onboard_visit (ip, user_agent) values (p_ip, p_user_agent);
$$;

grant execute on function public.log_onboard_visit(text, text) to anon, authenticated;


-- ============================================================
-- sql/44_adoption_usage.sql
-- ============================================================

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

commit;
