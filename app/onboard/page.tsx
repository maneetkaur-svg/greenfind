import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import OnboardForm from './OnboardForm';

export const metadata = { title: 'Vendor sign-up — GreenFind' };

export default async function OnboardPage() {
  const supabase = await createClient();

  // Logged best-effort — a visitor should never see a broken page just
  // because this write failed (sql/32_onboard_visit_log.sql not run yet,
  // a transient network blip, and so on).
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;
  const userAgent = h.get('user-agent');
  try { await supabase.rpc('log_onboard_visit', { p_ip: ip, p_user_agent: userAgent }); }
  catch { /* best-effort — never blocks the page */ }

  return <OnboardForm />;
}
