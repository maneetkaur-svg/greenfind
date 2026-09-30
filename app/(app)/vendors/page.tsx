import Link from 'next/link';
import { createClient, getMe } from '@/lib/supabase/server';
import { INDUSTRIES } from '@/lib/constants';

type Row = {
  id: string; site_code: string; legal_name: string; trade_name: string | null;
  gstin: string; industry: string; state: string; city: string;
  company_id: string; company_code: string; sibling_sites: number;
  docs_attached: number; docs_verified: number; docs_required: number;
  has_pending_request: boolean; updated_at: string;
};

function status(r: Row) {
  if (r.docs_attached === 0) return ['c-r', 'NOT VERIFIED'];
  if (r.docs_verified === r.docs_attached && r.docs_attached >= r.docs_required)
    return ['c-g', 'VERIFIED'];
  return ['c-a', 'PENDING'];
}

export default async function VendorsPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; industry?: string }> }) {
  const { q, industry } = await searchParams;
  const me = await getMe();
  const supabase = await createClient();

  let query = supabase.from('site_summary').select('*').order('updated_at', { ascending: false });
  if (industry) query = query.eq('industry', industry);
  const { data, error } = await query;

  let rows = (data ?? []) as Row[];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(r =>
      `${r.legal_name} ${r.trade_name ?? ''} ${r.gstin} ${r.site_code}`.toLowerCase().includes(needle));
  }

  const companies = new Set(rows.map(r => r.company_id)).size;

  return (
    <>
      <div className="flex justify-between items-start gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-[26px] font-bold">Vendor Master</h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--faint)' }}>
            {rows.length} site{rows.length === 1 ? '' : 's'} across {companies} compan{companies === 1 ? 'y' : 'ies'}
          </p>
        </div>
        {me?.role !== 'user' && (
          <Link href="/vendors/new" className="btn btn-p">+ Add vendor</Link>
        )}
      </div>

      <form className="flex gap-3 flex-wrap mb-4">
        <input name="q" defaultValue={q ?? ''} placeholder="Search name, GSTIN or code"
               className="flex-1 min-w-[230px]" />
        <select name="industry" defaultValue={industry ?? ''} className="w-[200px]">
          <option value="">All industries</option>
          {INDUSTRIES.map(i => <option key={i.code} value={i.code}>{i.label}</option>)}
        </select>
        <button className="btn btn-o">Search</button>
      </form>

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
                <th>Vendor</th><th>Industry</th><th>State</th>
                <th>Documents</th><th>Status</th><th>Sites</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const [cls, label] = status(r);
                return (
                  <tr key={r.id} className="hover:bg-[var(--surface-2)]">
                    <td>
                      <Link href={`/vendors/${r.id}`} className="font-bold"
                            style={{ color: 'var(--head)' }}>{r.legal_name}</Link>
                      <div className="text-[12px]" style={{ color: 'var(--faint)' }}>
                        {r.site_code} · {r.gstin}
                      </div>
                    </td>
                    <td>{INDUSTRIES.find(i => i.code === r.industry)?.label ?? r.industry}</td>
                    <td className="text-[13px]">{r.state}</td>
                    <td className="text-[13px]">
                      {r.docs_attached}/{r.docs_required} attached
                      {r.docs_verified > 0 && ` · ${r.docs_verified} verified`}
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
