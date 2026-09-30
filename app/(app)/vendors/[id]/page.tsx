import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient, getMe } from '@/lib/supabase/server';
import { sectionsFor } from '@/lib/schema';
import { INDUSTRIES } from '@/lib/constants';
import SectionForm from './SectionForm';
import ContactsForm from './ContactsForm';
import GeographyForm from './GeographyForm';
import CategoriesForm, { type Cat } from './CategoriesForm';
import DocumentsTab, { type DocType, type DocRow } from './DocumentsTab';
import NdaPanel from './NdaPanel';

/** The whole page in a try/catch, so a server error shows its message instead
 *  of the blank digest page Next.js gives in production. */
export default async function VendorPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  try {
    return await VendorRecord(props);
  } catch (e) {
    const err = e as Error & { digest?: string };
    // notFound() and redirect() work by throwing — let those through.
    if (err?.digest?.startsWith?.('NEXT_')) throw e;
    return (
      <div className="card p-6 max-w-[760px]">
        <h1 className="text-[18px] font-bold mb-2">This record could not be loaded</h1>
        <p className="text-[13.5px] mb-4" style={{ color: 'var(--muted)' }}>
          Nothing has been lost. The message below says what went wrong.
        </p>
        <pre className="text-[12px] p-3 rounded-lg overflow-x-auto whitespace-pre-wrap"
             style={{ background: 'var(--surface-2)', border: '1px solid var(--line)',
                      color: 'var(--head)' }}>
{String(err?.message ?? err)}
{err?.stack ? '\n\n' + err.stack.split('\n').slice(0, 6).join('\n') : ''}
        </pre>
        <a href="/vendors" className="btn btn-o mt-4">Back to the vendor list</a>
      </div>
    );
  }
}

async function VendorRecord({
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

  const { data: site, error: siteErr } = await supabase
    .from('vendor_site').select('*').eq('id', id).is('deleted_at', null).maybeSingle();

  if (siteErr) {
    return (
      <div className="note r">
        <b>Could not load this vendor.</b> {siteErr.message}
      </div>
    );
  }
  if (!site) notFound();

  const [{ data: company, error: eCompany }, { data: contacts, error: eContacts },
         { data: ops, error: eOps }, { data: certs, error: eCerts },
         { data: geo, error: eGeo }, { data: siblings, error: eSiblings }] = await Promise.all([
    supabase.from('company').select('*').eq('id', site.company_id).single(),
    supabase.from('site_contact').select('*').eq('site_id', id).order('rank'),
    supabase.from('site_operations').select('*').eq('site_id', id).maybeSingle(),
    supabase.from('site_certificate_data').select('*').eq('site_id', id).maybeSingle(),
    supabase.from('site_geography').select('state').eq('site_id', id),
    supabase.from('vendor_site').select('id, site_code, city, state')
      .eq('company_id', site.company_id).is('deleted_at', null).order('site_code'),
  ]);

  const [{ data: docRows, error: eDocs }, { data: reqRows, error: eReq }] = await Promise.all([
    supabase.from('site_document')
      .select('id, doc_type, file_name, file_size, doc_number, valid_until, uploaded_at, storage_path')
      .eq('site_id', id).is('superseded_at', null).order('uploaded_at', { ascending: false }),
    supabase.from('document_requirement')
      .select('doc_type, level, document_type!inner (code, label, applies_to, expiry_tracked, uploaded_by_party, sort)')
      .eq('industry', site.industry),
  ]);

  const one = <T,>(v: unknown): T | null =>
    Array.isArray(v) ? ((v[0] ?? null) as T | null) : ((v ?? null) as T | null);

  const docs: DocRow[] = Array.isArray(docRows) ? (docRows as DocRow[]) : [];

  type TypeRow = { code: string; label: string; applies_to: string | null;
                   expiry_tracked: boolean; uploaded_by_party: string; sort: number };
  const docTypes: DocType[] = (Array.isArray(reqRows) ? reqRows : [])
    .map(r => {
      const t = one<TypeRow>((r as { document_type?: unknown }).document_type);
      return t ? { ...t, level: r.level } : null;
    })
    .filter((x): x is DocType & { sort: number } => x !== null)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

  const { data: catRows, error: eCats } = await supabase
    .from('service_category')
    .select('id, code, label, sort, service_subcategory (id, code, label, sort)')
    .eq('industry', site.industry).eq('is_active', true).order('sort');

  // Postgres may report this relationship as one-to-one, in which case the
  // embedded value arrives as an object rather than an array. Calling .sort()
  // on an object throws, so normalise before touching it.
  type SubRow = { id: string; code: string; label: string; sort: number };
  const asArray = (v: unknown): SubRow[] =>
    Array.isArray(v) ? (v as SubRow[]) : v ? [v as SubRow] : [];

  const cats: Cat[] = (Array.isArray(catRows) ? catRows : []).map(c => ({
    id: c.id, code: c.code, label: c.label,
    subs: asArray((c as { service_subcategory?: unknown }).service_subcategory)
      .slice()
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      .map(s => ({ id: s.id, code: s.code, label: s.label })),
  }));

  const [{ data: selCats, error: eSelCats }, { data: selSubs, error: eSelSubs }] = await Promise.all([
    supabase.from('site_service_category').select('category_id').eq('site_id', id),
    supabase.from('site_service_subcategory').select('subcategory_id').eq('site_id', id),
  ]);

  if (!company) {
    return (
      <div className="note r">
        <b>This site has no company attached.</b> That should not be possible —
        send me the site code {site.site_code} and I will look at it.
      </div>
    );
  }

  // Any query that failed is named here rather than left to crash the render.
  const queryErrors = ([
    ['company', eCompany], ['contacts', eContacts], ['operations', eOps],
    ['certificate data', eCerts], ['geography', eGeo], ['sibling sites', eSiblings],
    ['documents', eDocs], ['document rules', eReq], ['service categories', eCats],
    ['selected categories', eSelCats], ['selected sub-categories', eSelSubs],
  ] as [string, { message: string } | null][])
    .filter(([, e]) => e)
    .map(([name, e]) => `${name}: ${e!.message}`);

  const readOnly = me.role === 'user';
  const sections = sectionsFor(site.industry);
  const industryLabel = INDUSTRIES.find(i => i.code === site.industry)?.label ?? site.industry;

  const tabs = [
    ...sections.map(s => ({ id: s.id, label: s.label })),
    { id: 'contacts', label: 'Contacts' },
    { id: 'categories', label: 'Service categories' },
    { id: 'geography', label: 'Geography' },
    { id: 'documents', label: 'Documents' },
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
          <h1 className="text-[26px] font-bold">{company.legal_name}</h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--faint)' }}>
            {site.site_code} · {industryLabel} · {site.city}, {site.state} · {site.gstin}
          </p>
        </div>
        {readOnly && <span className="chip c-a">READ ONLY</span>}
      </div>

      {queryErrors.length > 0 && (
        <div className="note r mb-5">
          <b>Some parts of this record could not be loaded.</b> Everything else below
          still works.
          <ul className="mt-2 ml-4 list-disc text-[12.5px]">
            {queryErrors.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}

      {Array.isArray(siblings) && siblings.length > 1 && (
        <div className="note mb-5">
          <b>{company.company_code} has {siblings.length} sites.</b> Identity, banking and
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
        {active === 'agreements' && (
          <NdaPanel siteId={id} readOnly={readOnly}
                    signatory={(company.authorised_signatory as string) ?? null}
                    signed={docs.find(d => d.doc_type === 'nda') ?? null} />
        )}
        {section && (
          <SectionForm section={section} values={source(section.table)}
                       siteId={id} companyId={site.company_id} readOnly={readOnly} />
        )}
        {active === 'contacts' && (
          <ContactsForm contacts={Array.isArray(contacts) ? contacts : []}
                        siteId={id} readOnly={readOnly} />
        )}
        {active === 'categories' && (
          <CategoriesForm cats={cats} siteId={id} readOnly={readOnly}
                          selectedCats={(Array.isArray(selCats) ? selCats : []).map(r => r.category_id)}
                          selectedSubs={(Array.isArray(selSubs) ? selSubs : []).map(r => r.subcategory_id)} />
        )}
        {active === 'documents' && (
          <DocumentsTab types={docTypes} docs={docs} siteId={id} readOnly={readOnly} />
        )}
        {active === 'geography' && (
          <GeographyForm selected={(Array.isArray(geo) ? geo : []).map(r => r.state)}
                         siteId={id} readOnly={readOnly} />
        )}
      </div>
    </>
  );
}
