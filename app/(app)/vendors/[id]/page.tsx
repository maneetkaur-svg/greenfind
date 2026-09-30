import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient, getMe } from '@/lib/supabase/server';
import { sectionsFor } from '@/lib/schema';
import { INDUSTRIES } from '@/lib/constants';
import SectionForm from './SectionForm';
import ContactsForm from './ContactsForm';
import GeographyForm from './GeographyForm';
import CategoriesForm, { type Cat } from './CategoriesForm';

export default async function VendorPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const me = await getMe();
  if (!me) redirect('/login');

  const supabase = await createClient();

  const { data: site } = await supabase
    .from('vendor_site').select('*').eq('id', id).is('deleted_at', null).single();
  if (!site) notFound();

  const [{ data: company }, { data: contacts }, { data: ops },
         { data: certs }, { data: geo }, { data: siblings }] = await Promise.all([
    supabase.from('company').select('*').eq('id', site.company_id).single(),
    supabase.from('site_contact').select('*').eq('site_id', id).order('rank'),
    supabase.from('site_operations').select('*').eq('site_id', id).maybeSingle(),
    supabase.from('site_certificate_data').select('*').eq('site_id', id).maybeSingle(),
    supabase.from('site_geography').select('state').eq('site_id', id),
    supabase.from('vendor_site').select('id, site_code, city, state')
      .eq('company_id', site.company_id).is('deleted_at', null).order('site_code'),
  ]);

  const { data: catRows } = await supabase
    .from('service_category')
    .select('id, code, label, sort, service_subcategory (id, code, label, sort)')
    .eq('industry', site.industry).eq('is_active', true).order('sort');

  const cats: Cat[] = (catRows ?? []).map(c => ({
    id: c.id, code: c.code, label: c.label,
    subs: ((c.service_subcategory ?? []) as { id: string; code: string; label: string; sort: number }[])
      .sort((a, b) => a.sort - b.sort)
      .map(s => ({ id: s.id, code: s.code, label: s.label })),
  }));

  const [{ data: selCats }, { data: selSubs }] = await Promise.all([
    supabase.from('site_service_category').select('category_id').eq('site_id', id),
    supabase.from('site_service_subcategory').select('subcategory_id').eq('site_id', id),
  ]);

  const readOnly = me.role === 'user';
  const sections = sectionsFor(site.industry);
  const industryLabel = INDUSTRIES.find(i => i.code === site.industry)?.label ?? site.industry;

  const tabs = [
    ...sections.map(s => ({ id: s.id, label: s.label })),
    { id: 'contacts', label: 'Contacts' },
    { id: 'categories', label: 'Service categories' },
    { id: 'geography', label: 'Geography' },
  ];
  const active = tabs.find(t => t.id === tab)?.id ?? tabs[0].id;
  const section = sections.find(s => s.id === active);

  const source = (table: string): Record<string, unknown> =>
    table === 'company' ? (company ?? {})
      : table === 'vendor_site' ? site
      : table === 'site_operations' ? (ops ?? {})
      : (certs ?? {});

  return (
    <>
      <Link href="/vendors" className="text-[13px] font-semibold"
            style={{ color: 'var(--faint)' }}>← All vendors</Link>

      <div className="flex justify-between items-start gap-4 flex-wrap mt-2 mb-5">
        <div>
          <h1 className="text-[26px] font-bold">{company?.legal_name ?? 'Vendor'}</h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--faint)' }}>
            {site.site_code} · {industryLabel} · {site.city}, {site.state} · {site.gstin}
          </p>
        </div>
        {readOnly && <span className="chip c-a">READ ONLY</span>}
      </div>

      {siblings && siblings.length > 1 && (
        <div className="note mb-5">
          <b>{company?.company_code} has {siblings.length} sites.</b> Identity, banking and
          agreements are shared. Address, certificates and contacts belong to this site.
          <div className="flex gap-2 mt-3 flex-wrap">
            {siblings.map(s => (
              <Link key={s.id} href={`/vendors/${s.id}`}
                    className={`chip ${s.id === id ? 'c-g' : 'c-n'}`}>
                {s.site_code} · {s.city}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-1 flex-wrap mb-5 pb-3 border-b" style={{ borderColor: 'var(--line)' }}>
        {tabs.map(t => (
          <Link key={t.id} href={`/vendors/${id}?tab=${t.id}`}
                className="text-[13.5px] font-semibold px-3 py-2 rounded-lg"
                style={active === t.id
                  ? { background: 'var(--p50)', color: 'var(--p700)' }
                  : { color: 'var(--muted)' }}>
            {t.label}
          </Link>
        ))}
      </div>

      <div className="card p-6">
        {section && (
          <SectionForm section={section} values={source(section.table)}
                       siteId={id} companyId={site.company_id} readOnly={readOnly} />
        )}
        {active === 'contacts' && (
          <ContactsForm contacts={contacts ?? []} siteId={id} readOnly={readOnly} />
        )}
        {active === 'categories' && (
          <CategoriesForm cats={cats} siteId={id} readOnly={readOnly}
                          selectedCats={(selCats ?? []).map(r => r.category_id)}
                          selectedSubs={(selSubs ?? []).map(r => r.subcategory_id)} />
        )}
        {active === 'geography' && (
          <GeographyForm selected={(geo ?? []).map(r => r.state)} siteId={id} readOnly={readOnly} />
        )}
      </div>
    </>
  );
}
