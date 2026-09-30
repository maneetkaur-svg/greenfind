import { redirect } from 'next/navigation';
import { createClient, getMe } from '@/lib/supabase/server';
import Wizard, { type Cat } from './Wizard';

export default async function NewVendorPage() {
  const me = await getMe();
  if (!me) redirect('/login');
  if (me.role === 'user') redirect('/vendors');

  const supabase = await createClient();
  const { data } = await supabase
    .from('service_category')
    .select('id, industry, code, label, sort, service_subcategory (id, label, sort)')
    .eq('is_active', true)
    .order('sort');

  const cats: Cat[] = (data ?? []).map(c => ({
    id: c.id, industry: c.industry, code: c.code, label: c.label,
    subs: ((c.service_subcategory ?? []) as { id: string; label: string; sort: number }[])
      .sort((a, b) => a.sort - b.sort)
      .map(s => ({ id: s.id, label: s.label })),
  }));

  return <Wizard cats={cats} />;
}
