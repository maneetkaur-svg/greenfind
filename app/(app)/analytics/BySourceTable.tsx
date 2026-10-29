import Link from 'next/link';
import type { AnalyticsFilters } from '@/lib/analyticsFilters';
import { buildHref, SOURCE_LABEL } from '@/lib/analyticsFilters';
import type { SourceRow } from '@/lib/analyticsTypes';
import { pctLabel } from '@/lib/analyticsTypes';

const nf = new Intl.NumberFormat('en-IN');

/** Counts here always ignore the page's own Source filter (computed that
 *  way by analytics_summary) so clicking one row never zeroes the others. */
export default function BySourceTable({ rows, total, filters }: { rows: SourceRow[]; total: number; filters: AnalyticsFilters }) {
  return (
    <div className="card p-4">
      <h2 className="text-[15px] font-bold mb-3" style={{ color: 'var(--head)' }}>By source</h2>
      <p className="text-[13px] mb-3" style={{ color: 'var(--faint)' }}>Where each vendor came from</p>
      <table className="w-full text-[13px]">
        <thead>
          <tr style={{ color: 'var(--faint)' }}>
            <th className="text-left font-semibold pb-2">Source</th>
            <th className="text-right font-semibold pb-2">Vendors</th>
            <th className="text-right font-semibold pb-2">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const on = filters.source === r.source;
            return (
              <tr key={r.source}>
                <td className="py-1.5" style={{ borderTop: '1px solid var(--line)' }}>
                  <Link href={buildHref(filters, { source: on ? null : r.source })}
                        className="block" style={{ color: on ? 'var(--p600)' : 'var(--head)', fontWeight: on ? 700 : 400 }}>
                    {SOURCE_LABEL[r.source] ?? r.source}
                  </Link>
                </td>
                <td className="text-right py-1.5 font-semibold" style={{ borderTop: '1px solid var(--line)', fontVariantNumeric: 'tabular-nums' }}>
                  {nf.format(r.count)}
                </td>
                <td className="text-right py-1.5" style={{ borderTop: '1px solid var(--line)', color: 'var(--faint)' }}>
                  {pctLabel(r.count, total)}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={3} className="py-4 text-center" style={{ color: 'var(--faint)' }}>No vendors match.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
