import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient, getMe } from '@/lib/supabase/server';
import { parseFilters, filtersToJsonb } from '@/lib/analyticsFilters';
import type { Taxonomy, AnalyticsSummary } from '@/lib/analyticsTypes';
import { pctLabel } from '@/lib/analyticsTypes';
import FilterBar from './FilterBar';
import KpiBand from './KpiBand';
import TrendChart from './TrendChart';
import BySourceTable from './BySourceTable';
import VerticalDonut from './VerticalDonut';
import VerticalCategoryTable from './VerticalCategoryTable';
import ByGeography from './ByGeography';
import VendorDrawer from './VendorDrawer';

type DetailGaps = {
  total: number;
  missing_documents: { label: string; count: number }[];
  entity_blank: number; msme_incomplete: number; year_blank: number; signatory_blank: number;
  cheque_false: number; trade_name_blank: number; zero_categories: number; contact_gap: number;
};

/** Rebuilt per the Oct 2026 design brief: cascading vertical/category/
 *  sub-category filters driven entirely by the DB (sql/54a-c), a teal KPI
 *  band, a trend chart, by-source and by-geography tables, a vertical/
 *  category table with expandable sub-rows, and a vendor drawer fetched
 *  only when opened. Every count comes from one analytics_summary() call
 *  (GROUP BY in Postgres) -- no vendor list is ever loaded just to count
 *  it. The old page's "Data quality details" panel is kept, now backed by
 *  analytics_detail_gaps() instead of its own in-memory pass. */
export default async function AnalyticsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await getMe();
  if (!me) redirect('/login');
  if (me.role !== 'super_admin') redirect('/vendors');

  const sp = await searchParams;
  const filters = parseFilters(sp);
  const p = filtersToJsonb(filters);
  const supabase = await createClient();

  const [{ data: taxonomyRaw, error: taxErr }, { data: summaryRaw, error: sumErr }, { data: gapsRaw }] = await Promise.all([
    supabase.rpc('analytics_taxonomy'),
    supabase.rpc('analytics_summary', { p }),
    supabase.rpc('analytics_detail_gaps', { p }),
  ]);

  const error = taxErr ?? sumErr;
  if (error) {
    return <div className="note r">Failed to load. Retry. <span style={{ color: 'var(--faint)' }}>({error.message})</span></div>;
  }

  const taxonomy = taxonomyRaw as Taxonomy;
  const summary = summaryRaw as AnalyticsSummary;
  const gaps = gapsRaw as DetailGaps | null;
  const total = summary.kpi.total;

  const now = new Date();
  const monthLabel = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const asOf = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  const exportParams = new URLSearchParams(p);
  exportParams.set('format', 'csv');

  return (
    <>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-[28px] font-bold leading-tight" style={{ color: 'var(--head)' }}>Vendor analytics</h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--faint)' }}>
            Showing {total === 1 ? '1 vendor' : `all ${total} vendors`}{Object.values(filters).some(Boolean) ? ' matching your filters' : ''}. Data as of {asOf}.
          </p>
        </div>
        <a href={`/api/analytics/vendors?${exportParams.toString()}`} className="btn btn-o">Export CSV</a>
      </div>

      <FilterBar filters={filters} taxonomy={taxonomy} byState={summary.by_state} byCity={summary.by_city} />
      <KpiBand kpi={summary.kpi} monthLabel={monthLabel} />

      <div className="grid lg:grid-cols-[1fr_340px] gap-4 mb-4 items-start">
        <TrendChart filters={filters} taxonomy={taxonomy} />
        <div className="flex flex-col gap-4">
          <BySourceTable rows={summary.by_source} total={total} filters={filters} />
          <VerticalDonut filters={filters} byVertical={summary.by_vertical} total={total} />
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-4 mb-4 items-start">
        <VerticalCategoryTable
          filters={filters} taxonomy={taxonomy} total={total}
          byVertical={summary.by_vertical} byCategory={summary.by_category} bySubcategory={summary.by_subcategory}
        />
        <ByGeography filters={filters} byState={summary.by_state} byCity={summary.by_city} />
      </div>

      {gaps && (
        <details className="card p-4">
          <summary className="text-[13px] font-bold cursor-pointer" style={{ color: 'var(--head)', listStyle: 'none' }}>
            Data quality details — missing documents and policy gaps
            {gaps.missing_documents.length > 0 && <span className="chip c-a ml-2">{gaps.missing_documents.length} doc type{gaps.missing_documents.length === 1 ? '' : 's'} with gaps</span>}
          </summary>
          <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
            <h3 className="text-[12px] font-bold uppercase tracking-[.06em] mb-3" style={{ color: 'var(--faint)' }}>
              Missing documents <span className="font-normal normal-case">— required, not currently on file</span>
            </h3>
            {gaps.missing_documents.length === 0 ? (
              <p className="text-[13px] mb-4" style={{ color: 'var(--faint)' }}>Nothing missing.</p>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
                {gaps.missing_documents.map(d => (
                  <div key={d.label} className="card p-3">
                    <div className="flex justify-between text-[13px]">
                      <span style={{ color: 'var(--head)' }}>{d.label}</span>
                      <span className="font-bold">{d.count} · {pctLabel(d.count, gaps.total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <h3 className="text-[12px] font-bold uppercase tracking-[.06em] mb-1" style={{ color: 'var(--faint)' }}>
              Required by policy, not yet enforced by the portal
            </h3>
            <p className="text-[12px] mb-3" style={{ color: 'var(--faint)' }}>
              The Vendor Master Form schema calls these mandatory, but the portal does not currently
              block saving a vendor without them — so counts here will not be zero.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
              {[
                ['Trade / brand name blank', gaps.trade_name_blank],
                ['Entity type blank', gaps.entity_blank],
                ['MSME, but category/Udyam missing', gaps.msme_incomplete],
                ['Year established blank', gaps.year_blank],
                ['No service category picked', gaps.zero_categories],
                ['Contact missing designation or email', gaps.contact_gap],
                ['Authorised signatory blank', gaps.signatory_blank],
                ['Cancelled cheque not marked on file', gaps.cheque_false],
              ].map(([label, n]) => (
                <div key={label as string} className="card p-3">
                  <div className="text-[13px]" style={{ color: 'var(--head)' }}>{label}</div>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="text-[17px] font-bold">{n as number}</span>
                    <span className="text-[11.5px] font-bold" style={{ color: 'var(--faint)' }}>{pctLabel(n as number, gaps.total)}</span>
                  </div>
                </div>
              ))}
            </div>

            <h3 className="text-[12px] font-bold uppercase tracking-[.06em] mb-2" style={{ color: 'var(--faint)' }}>
              Required by policy, not captured at all
            </h3>
            <ul className="ml-4 list-disc text-[13px]" style={{ color: 'var(--head)' }}>
              <li>Geo-tagged image and Site Report (Physical Verification) — scoped, not yet built.</li>
              <li>PAN / Aadhaar of the individual — only asked for Proprietorship; Partnership, LLP and Foreign entities are never asked.</li>
            </ul>
          </div>
        </details>
      )}

      <Suspense fallback={null}>
        <VendorDrawer />
      </Suspense>
    </>
  );
}
