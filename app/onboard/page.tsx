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
  return <OnboardForm cats={cats} />;
}
