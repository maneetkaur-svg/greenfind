import Link from 'next/link';
import { createClient, getMe } from '@/lib/supabase/server';
import { INDUSTRIES } from '@/lib/constants';
import DashboardCard, { type DashRow } from './DashboardCard';
import SearchForm from './SearchForm';
import RowLink from './RowLink';

type Row = {
  id: string; site_code: string; legal_name: string;
  gstin: string | null; industry: string | null; state: string | null; city: string | null;
  status: string | null; legacy_vendor_code: string | null; services_text: string | null;
  aadhaar_last4: string | null; source: string | null;
  company_id: string; company_code: string; sibling_sites: number;
  docs_attached: number; docs_verified: number; docs_required: number;
  has_pending_request: boolean; updated_at: string;
};

function status(r: Row) {
  if (r.docs_required > 0 && r.docs_attached >= r.docs_required) return ['c-g', 'COMPLETE'];
  if (r.docs_attached === 0) return ['c-r', 'NO DOCUMENTS'];
  return ['c-a', 'INCOMPLETE'];
}

const SOURCE_LABEL: Record<string, string> = {
  import: 'Import', manual: 'Manual', public_form: 'Public form', old_portal: 'Old GreenFind Portal',
};
const INDUSTRY_ICON: Record<string, string> = {
  recycling: '♻️', transportation: '🚚', packaging: '📦', warehouse: '🏭',
};
const AVATAR_COLORS = ['icon-green', 'icon-blue', 'icon-purple', 'icon-orange', 'icon-teal', 'icon-grey'];
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '—';
  return words.length === 1 ? words[0].slice(0, 2).toUpperCase() : (words[0][0] + words[1][0]).toUpperCase();
}
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const PAGE_SIZE = 20;
/** First, last, current ±1, with a gap marker wherever a jump is skipped. */
function pageNumbers(current: number, total: number): (number | '…')[] {
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('…');
    out.push(sorted[i]);
  }
  return out;
}

export default async function VendorsPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; industry?: string; state?: string; sort?: string; page?: string }> }) {
  const { q, industry, state, sort, page: pageParam } = await searchParams;
  const me = await getMe();
  const supabase = await createClient();

  const industries = (industry ?? '').split(',').filter(Boolean);
  const realIndustries = industries.filter(i => i !== 'unclassified');
  const wantsUnclassified = industries.includes('unclassified');

  let query = supabase.from('site_summary').select('*').order('updated_at', { ascending: false });
  if (industries.length) {
    if (wantsUnclassified && realIndustries.length)
      query = query.or(`industry.is.null,industry.in.(${realIndustries.join(',')})`);
    else if (wantsUnclassified)
      query = query.is('industry', null);
    else
      query = query.in('industry', realIndustries);
  }
  if (state) query = query.eq('state', state);
  const { data, error } = await query;

  // The dashboard is a nicety: if the view is not there yet (06_data_fit.sql not run) the page still works.
  const { data: dash } = await supabase.from('vendor_dashboard').select('industry, vendors, active_vendors, sites');

  let rows = (data ?? []) as Row[];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(r =>
      `${r.legal_name} ${r.gstin ?? ''} ${r.site_code} ${r.legacy_vendor_code ?? ''} ${r.services_text ?? ''}`.toLowerCase().includes(needle));
  }
  if (sort === 'name_asc' || sort === 'name_desc') {
    const dir = sort === 'name_asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => dir * a.legal_name.localeCompare(b.legal_name));
  }

  // Preserves the current search/filter while only the sort changes.
  const sortHref = (next: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (industry) params.set('industry', industry);
    if (state) params.set('state', state);
    params.set('sort', next);
    return `/vendors?${params.toString()}`;
  };

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, Number(pageParam) || 1), totalPages);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (industry) params.set('industry', industry);
    if (state) params.set('state', state);
    if (sort) params.set('sort', sort);
    params.set('page', String(p));
    return `/vendors?${params.toString()}`;
  };
  const clearParams = new URLSearchParams();
  if (sort) clearParams.set('sort', sort);
  const clearHref = clearParams.toString() ? `/vendors?${clearParams.toString()}` : '/vendors';

  // Contact (primary POC) and service category — fetched only for the 20
  // rows actually shown, not the whole filtered set, since nothing else on
  // this page needs them.
  const pageIds = pageRows.map(r => r.id);
  const [{ data: contactRows }, { data: catRows }] = pageIds.length
    ? await Promise.all([
        supabase.from('site_contact').select('site_id, name, mobile').eq('rank', 1).in('site_id', pageIds),
        supabase.from('site_service_category')
          .select('site_id, service_category!inner(label)').in('site_id', pageIds),
      ])
    : [{ data: [] }, { data: [] }];

  const contactBySite = new Map((contactRows ?? []).map(c => [c.site_id, c]));
  const servicesBySite = new Map<string, string[]>();
  for (const c of (catRows ?? []) as { site_id: string; service_category: { label: string } | { label: string }[] }[]) {
    const cat = Array.isArray(c.service_category) ? c.service_category[0] : c.service_category;
    if (!cat) continue;
    const list = servicesBySite.get(c.site_id) ?? [];
    list.push(cat.label);
    servicesBySite.set(c.site_id, list);
  }

  return (
    <>
      {Array.isArray(dash) && dash.length > 0 && (
        <DashboardCard rows={dash as DashRow[]} selected={industries} q={q} state={state} sort={sort} />
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <SearchForm q={q} industries={industries} state={state} sort={sort} />
        {me?.role !== 'user' && (
          <div className="flex gap-2">
            {me?.role === 'super_admin' && <Link href="/vendors/import" className="btn btn-o">Import</Link>}
            <Link href="/vendors/new" className="btn btn-p">+ Add vendor</Link>
          </div>
        )}
      </div>

      {error && (
        <div className="note r mb-4">
          <b>Could not read the vendor list.</b> {error.message}
          <div className="hint mt-2">
            If this says the relation does not exist, 01_schema.sql has not been run.
            If it returns nothing but you know there is data, check that your profile row exists.
          </div>
        </div>
      )}

      {!error && (q || industries.length > 0 || state) && (
        <div className="flex items-center gap-2 mb-4 text-[13px] font-semibold flex-wrap" style={{ color: 'var(--p700)' }}>
          <span>☷</span>
          <span>
            {industries.length > 0 && `Industry: ${industries.map(i => i === 'unclassified' ? 'Others' : INDUSTRIES.find(x => x.code === i)?.label ?? i).join(', ')}`}
            {industries.length > 0 && (state || q) && ' · '}
            {state && `State: ${state}`}
            {state && q && ' · '}
            {q && `Matching "${q}"`}
          </span>
          <Link href={clearHref} style={{ color: 'var(--faint)', textDecoration: 'underline' }}>Clear</Link>
        </div>
      )}

      {!error && rows.length === 0 ? (
        <div className="card p-12 text-center">
          <h3 className="text-[18px] font-bold mb-1">No vendors yet</h3>
          <p className="text-[13.5px] mb-4" style={{ color: 'var(--muted)' }}>
            {q || industries.length || state ? 'Nothing matches that filter.' : 'Add the first one to get started.'}
          </p>
          {me?.role !== 'user' && <Link href="/vendors/new" className="btn btn-p">+ Add vendor</Link>}
        </div>
      ) : !error && (
        <div className="card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>
                  <Link href={sortHref(sort === 'name_asc' ? 'name_desc' : 'name_asc')}
                        className="inline-flex items-center gap-1" style={{ color: 'inherit' }}
                        title="Sort alphabetically">
                    Vendor
                    <span style={{ opacity: sort === 'name_asc' || sort === 'name_desc' ? 1 : .35, fontSize: 11 }}>
                      {sort === 'name_desc' ? '▼' : sort === 'name_asc' ? '▲' : '⇅'}
                    </span>
                  </Link>
                </th>
                <th>Industry / service</th><th>State (by GST)</th>
                <th>Contact</th><th>Documents</th><th>Completeness</th><th>Source</th><th></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(r => {
                const [cls, label] = status(r);
                const icon = INDUSTRY_ICON[r.industry ?? ''];
                const contact = contactBySite.get(r.id);
                const services = servicesBySite.get(r.id);
                return (
                  <tr key={r.id} className="relative hover:bg-[var(--surface-2)] cursor-pointer">
                    <td>
                      <RowLink href={`/vendors/${r.id}`} label={r.legal_name} />
                      <div className="flex items-center gap-3">
                        <span className={`icon-circle ${avatarColor(r.legal_name)}`}
                              style={{ width: 38, height: 38, fontSize: 13 }}>
                          {initials(r.legal_name)}
                        </span>
                        <div>
                          <div className="font-bold" style={{ color: 'var(--head)' }}>{r.legal_name}</div>
                          <div className="text-[12px]" style={{ color: 'var(--faint)' }}>
                            {[r.legacy_vendor_code,
                              r.gstin ?? (r.aadhaar_last4 ? `Aadhaar ••••${r.aadhaar_last4}` : null)]
                              .filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {INDUSTRIES.find(i => i.code === r.industry)?.label ? (
                        <span className="chip c-g">{icon && `${icon} `}{INDUSTRIES.find(i => i.code === r.industry)?.label}</span>
                      ) : r.services_text ? (
                        <span className="chip c-n" title={r.services_text}>
                          {r.services_text.length > 40 ? r.services_text.slice(0, 40) + '…' : r.services_text}
                        </span>
                      ) : (
                        <span className="chip c-n">UNCLASSIFIED</span>
                      )}
                      {services && services.length > 0 && (
                        <div className="text-[11.5px] mt-1" style={{ color: 'var(--faint)' }}>{services.join(', ')}</div>
                      )}
                    </td>
                    <td className="text-[13px]">{r.state ?? '—'}</td>
                    <td>
                      {contact ? (
                        <>
                          <div className="text-[13px] font-semibold" style={{ color: 'var(--head)' }}>{contact.name}</div>
                          <div className="text-[11.5px]" style={{ color: 'var(--faint)' }}>{contact.mobile ?? '—'}</div>
                        </>
                      ) : (
                        <span style={{ color: 'var(--faint)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <div className="text-[13px] font-semibold" style={{ color: 'var(--head)' }}>
                        {r.docs_attached}/{r.docs_required}
                      </div>
                      <div className="text-[11.5px]" style={{ color: 'var(--faint)' }}>attached</div>
                    </td>
                    <td>
                      <span className={`chip ${cls}`}>{label}</span>
                      {r.has_pending_request && (
                        <span className="chip c-a ml-1">REQUEST OPEN</span>
                      )}
                    </td>
                    <td className="text-[13px]">{r.source ? SOURCE_LABEL[r.source] ?? r.source : '—'}</td>
                    <td className="text-center" style={{ color: 'var(--faint)' }}>›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!error && rows.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap mt-4">
          <div className="text-[13px]" style={{ color: 'var(--faint)' }}>
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, total)} of {total} vendor{total === 1 ? '' : 's'}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              {currentPage === 1
                ? <span className="page-btn disabled">‹</span>
                : <Link href={pageHref(currentPage - 1)} className="page-btn">‹</Link>}
              {pageNumbers(currentPage, totalPages).map((p, i) =>
                p === '…'
                  ? <span key={`gap${i}`} className="page-btn" style={{ cursor: 'default' }}>…</span>
                  : <Link key={p} href={pageHref(p)} className={`page-btn ${p === currentPage ? 'active' : ''}`}>{p}</Link>
              )}
              {currentPage === totalPages
                ? <span className="page-btn disabled">›</span>
                : <Link href={pageHref(currentPage + 1)} className="page-btn">›</Link>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
