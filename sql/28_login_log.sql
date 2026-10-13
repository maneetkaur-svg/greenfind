-- Supabase's own auth.users.last_sign_in_at only ever holds the most
-- recent login, not a history — this table is the history, written by
-- the app itself (app/login/actions.ts) right after a successful,
-- authorized sign-in. "What changes did they make" already has a home:
-- the existing audit_log table (sql/01_schema.sql), on company,
-- vendor_site and site_document.

create table if not exists public.login_log (
  id          bigserial primary key,
  profile_id  uuid not null references public.profile(id) on delete cascade,
  logged_in_at timestamptz not null default now()
);
create index if not exists login_log_profile_idx on public.login_log (profile_id, logged_in_at desc);

alter table public.login_log enable row level security;

-- Anyone can log their own sign-in — never someone else's.
drop policy if exists login_log_insert on public.login_log;
create policy login_log_insert on public.login_log for insert
  with check (profile_id = auth.uid());

-- Reading the full history is an admin-only report, same floor as every
-- other sensitive read in this schema. The /activity page itself narrows
-- this further to one specific account.
drop policy if exists login_log_select on public.login_log;
create policy login_log_select on public.login_log for select
  using (public.is_admin());
