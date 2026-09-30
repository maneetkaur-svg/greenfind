import { redirect } from 'next/navigation';
import { createClient, getMe } from '@/lib/supabase/server';
import Wizard, { type Cat, type DocRule } from './Wizard';

export default async function NewVendorPage() {
  const me = await getMe();
  if (!me) redirect('/login');
  if (me.role === 'user') redirect('/vendors');

  const supabase = await createClient();

  const { data: rules } = await supabase
    .from('document_requirement')
    .select('industry, level, document_type!inner (code, label, applies_to, expiry_tracked, uploaded_by_party, sort)');

  const one = <T,>(v: unknown): T | null =>
    Array.isArray(v) ? ((v[0] ?? null) as T | null) : ((v ?? null) as T | null);

  type TypeRow = { code: string; label: string; applies_to: string | null;
                   expiry_tracked: boolean; uploaded_by_party: string; sort: number };

  const docRules: DocRule[] = (rules ?? [])
    .map(r => {
      const t = one<TypeRow>((r as { document_type?: unknown }).document_type);
      return t ? { industry: r.industry as string, level: r.level as string,
                   code: t.code, label: t.label, applies_to: t.applies_to,
                   expiry_tracked: t.expiry_tracked,
                   uploaded_by_party: t.uploaded_by_party, sort: t.sort } : null;
    })
    .filter((x): x is DocRule => x !== null)
    .sort((a, b) => a.sort - b.sort);

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

  return <Wizard cats={cats} docRules={docRules} />;
}
