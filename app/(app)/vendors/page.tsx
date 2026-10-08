import Link from 'next/link';
import { createClient, getMe } from '@/lib/supabase/server';
import { INDUSTRIES } from '@/lib/constants';
import DashboardCard, { type DashRow } from './DashboardCard';

type Row = {
  id: string; site_code: string; legal_name: string;
  gstin: string | null; industry: string | null; state: string | null; city: string | null;
  status: string | null; legacy_vendor_code: string | null; services_text: string | null;
  aadhaar_last4: string | null;
  company_id: string; company_code: string; sibling_sites: number;
  docs_attached: number; docs_verified: number; docs_required: number;
  has_pending_request: boolean; updated_at: string;
};

function status(r: Row) {
  if (r.docs_required > 0 && r.docs_attached >= r.docs_required) return ['c-g', 'COMPLETE'];
  if (r.docs_attached === 0) return ['c-r', 'NO DOCUMENTS'];
  return ['c-a', 'INCOMPLETE'];
}

export default async function VendorsPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; industry?: string; sort?: string }> }) {
  const { q, industry, sort } = await searchParams;
  const me = await getMe();
  const supabase = await createClient();

  let query = supabase.from('site_summary').select('*').order('updated_at', { ascending: false });
  if (industry === 'unclassified') query = query.is('industry', null);
  else if (industry) query = query.eq('industry', industry);
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
    params.set('sort', next);
    return `/vendors?${params.toString()}`;
  };

  return (
    <>
      {Array.isArray(dash) && dash.length > 0 && <DashboardCard rows={dash as DashRow[]} />}

      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <form className="flex items-center gap-2 flex-wrap">
          <input name="q" defaultValue={q ?? ''} placeholder="Search name, GSTIN, vendor code or services"
                 className="w-[280px]" />
          <select name="industry" defaultValue={industry ?? ''} className="w-[170px]">
            <option value="">All industries</option>
            {INDUSTRIES.map(i => <option key={i.code} value={i.code}>{i.label}</option>)}
            <option value="unclassified">Unclassified</option>
          </select>
          <button className="btn btn-o">Search</button>
        </form>
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

      {!error && rows.length === 0 ? (
        <div className="card p-12 text-center">
          <h3 className="text-[18px] font-bold mb-1">No vendors yet</h3>
          <p className="text-[13.5px] mb-4" style={{ color: 'var(--muted)' }}>
            {q || industry ? 'Nothing matches that filter.' : 'Add the first one to get started.'}
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
                <th>Industry</th><th>State (by GST)</th>
                <th>Status</th><th>Documents</th><th>Completeness</th><th>Sites</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const [cls, label] = status(r);
                return (
                  <tr key={r.id} className="relative hover:bg-[var(--surface-2)] cursor-pointer">
                    <td>
                      <Link href={`/vendors/${r.id}`} className="absolute inset-0" style={{ zIndex: 1 }}
                            aria-label={r.legal_name} />
                      <span className="font-bold" style={{ color: 'var(--head)' }}>{r.legal_name}</span>
                      <div className="text-[12px]" style={{ color: 'var(--faint)' }}>
                        {[r.legacy_vendor_code,
                          r.gstin ?? (r.aadhaar_last4 ? `Aadhaar ••••${r.aadhaar_last4}` : null)]
                          .filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td>
                      {INDUSTRIES.find(i => i.code === r.industry)?.label ?? (
                        r.services_text
                          ? <span className="chip c-n" title={r.services_text}>
                              {r.services_text.length > 40 ? r.services_text.slice(0, 40) + '…' : r.services_text}
                            </span>
                          : <span className="chip c-n">UNCLASSIFIED</span>
                      )}
                    </td>
                    <td className="text-[13px]">{r.state ?? '—'}</td>
                    <td>
                      {r.status && (
                        <span className={`chip ${r.status === 'active' ? 'c-g' : r.status === 'blocked' ? 'c-r' : 'c-a'}`}>
                          {r.status.toUpperCase()}
                        </span>
                      )}
                    </td>
                    <td className="text-[13px]">
                      {r.docs_attached}/{r.docs_required} attached
                    </td>
                    <td>
                      <span className={`chip ${cls}`}>{label}</span>
                      {r.has_pending_request && (
                        <span className="chip c-a ml-1">REQUEST OPEN</span>
                      )}
                    </td>
                    <td className="text-[13px]">
                      {r.sibling_sites > 1
                        ? <span className="chip c-n">{r.sibling_sites} sites</span>
                        : <span style={{ color: 'var(--faint)' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
