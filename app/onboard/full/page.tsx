import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import FullOnboardForm, { type Cat, type DocRule } from './FullOnboardForm';

export const metadata = { title: 'Complete vendor onboarding — GreenFind' };

export default async function OnboardFullPage() {
  const supabase = await createClient();
  // Same narrow, read-only RPCs the quick form uses to get past RLS as an
  // anonymous visitor (sql/18, sql/53) — service_category and
  // document_requirement are otherwise only readable by a signed-in user.
  const [{ data: catData }, { data: docData }] = await Promise.all([
    supabase.rpc('public_service_categories'),
    supabase.rpc('public_document_requirements'),
  ]);
  const cats = (Array.isArray(catData) ? catData : []) as Cat[];
  const docRules = (Array.isArray(docData) ? docData : []) as DocRule[];

  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;
  const userAgent = h.get('user-agent');
  try { await supabase.rpc('log_onboard_visit', { p_ip: ip, p_user_agent: userAgent }); }
  catch { /* best-effort — never blocks the page */ }

  return <FullOnboardForm cats={cats} docRules={docRules} />;
}
