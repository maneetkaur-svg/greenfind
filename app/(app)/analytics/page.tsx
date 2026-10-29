import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient, getMe } from '@/lib/supabase/server';
import { parseFilters, filtersToJsonb } from '@/lib/analyticsFilters';
import type { Taxonomy, AnalyticsSummary } from '@/lib/analyticsTypes';
import FilterBar from './FilterBar';
import KpiBand from './KpiBand';
import TrendChart from './TrendChart';
import BySourceTable from './BySourceTable';
import VerticalDonut from './VerticalDonut';
import VerticalCategoryTable from './VerticalCategoryTable';
import ByGeography from './ByGeography';
import VendorDrawer from './VendorDrawer';

/** Rebuilt per the Oct 2026 design brief: cascading vertical/category/
 *  sub-category filters driven entirely by the DB (sql/54a-c), a teal KPI
 *  band, a trend chart, by-source and by-geography tables, a vertical/
 *  category table with expandable sub-rows, and a vendor drawer fetched
 *  only when opened. Every count comes from one analytics_summary() call
 *  (GROUP BY in Postgres) -- no vendor list is ever loaded just to count
 *  it. */
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

  const [{ data: taxonomyRaw, error: taxErr }, { data: summaryRaw, error: sumErr }] = await Promise.all([
    supabase.rpc('analytics_taxonomy'),
    supabase.rpc('analytics_summary', { p }),
  ]);

  const error = taxErr ?? sumErr;
  if (error) {
    return <div className="note r">Failed to load. Retry. <span style={{ color: 'var(--faint)' }}>({error.message})</span></div>;
  }

  const taxonomy = taxonomyRaw as Taxonomy;
  const summary = summaryRaw as AnalyticsSummary;
  const total = summary.kpi.total;

  const now = new Date();
  const monthLabel = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const asOf = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  const exportParams = new URLSearchParams(p);
  exportParams.set('format', 'csv');

  return (
    <>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight" style={{ color: 'var(--head)' }}>Vendor analytics</h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--faint)' }}>
            Showing {total === 1 ? '1 vendor' : `all ${total} vendors`}{Object.values(filters).some(Boolean) ? ' matching your filters' : ''}. Data as of {asOf}.
          </p>
        </div>
        <a href={`/api/analytics/vendors?${exportParams.toString()}`} className="btn btn-o">Export CSV</a>
      </div>

      <FilterBar filters={filters} taxonomy={taxonomy} byState={summary.by_state} byRegion={summary.by_region ?? []} />
      <KpiBand kpi={summary.kpi} monthLabel={monthLabel} />

      <div className="grid lg:grid-cols-[1fr_340px] gap-3 items-start">
        <div className="flex flex-col gap-3">
          <TrendChart filters={filters} taxonomy={taxonomy} />
          <VerticalCategoryTable
            filters={filters} taxonomy={taxonomy} total={total}
            byVertical={summary.by_vertical} byCategory={summary.by_category} bySubcategory={summary.by_subcategory}
          />
        </div>
        <div className="flex flex-col gap-3">
          <VerticalDonut filters={filters} byVertical={summary.by_vertical} total={total} />
          <BySourceTable rows={summary.by_source} total={total} filters={filters} />
          <ByGeography filters={filters} byState={summary.by_state} byRegion={summary.by_region ?? []} />
        </div>
      </div>

      <Suspense fallback={null}>
        <VendorDrawer />
      </Suspense>
    </>
  );
}
