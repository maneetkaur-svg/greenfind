-- Logs every load of the public, no-login vendor sign-up page (app/onboard),
-- so Maneet's Activity view can show "the link was opened" even when the
-- visitor never submits anything. Written through a security-definer RPC,
-- the same reason public_vendor_signup is one -- an anonymous visitor has
-- no RLS-permitted write path otherwise. Readable the same way login_log
-- and audit_log already are: is_admin() at the database level, narrowed
-- further to one specific person at the app layer (app/(app)/activity).

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
