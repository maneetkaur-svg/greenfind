import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import OnboardForm, { type Cat } from './OnboardForm';

export const metadata = { title: 'Vendor sign-up — GreenFind' };

export default async function OnboardPage() {
  const supabase = await createClient();
  // Anonymous RLS cannot read service_category directly (sql/02_security.sql
  // restricts it to signed-in users) — this narrow, read-only RPC
  // (sql/18_public_vendor_signup.sql) is the one thing a visitor can call
  // to get the picker's options.
  const { data } = await supabase.rpc('public_service_categories');
  const cats = (Array.isArray(data) ? data : []) as Cat[];

  // Logged best-effort — a visitor should never see a broken page just
  // because this write failed (sql/32_onboard_visit_log.sql not run yet,
  // a transient network blip, and so on).
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;
  const userAgent = h.get('user-agent');
  try { await supabase.rpc('log_onboard_visit', { p_ip: ip, p_user_agent: userAgent }); }
  catch { /* best-effort — never blocks the page */ }

  return <OnboardForm cats={cats} />;
}
