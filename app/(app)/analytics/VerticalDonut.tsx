import Link from 'next/link';
import type { AnalyticsFilters } from '@/lib/analyticsFilters';
import { buildHref } from '@/lib/analyticsFilters';
import type { VerticalRow } from '@/lib/analyticsTypes';

// Same hues as the old Analytics page's industry donut and the vendor
// list's own icon-* badges (DashboardCard.tsx) -- a vertical is always the
// same color everywhere. 'others' falls back to --ind-other, same as the
// old page's 'unclassified' bucket.
const VERTICAL_COLOR: Record<string, string> = {
  recycling: 'var(--ind-recycling)', packaging: 'var(--ind-packaging)', transportation: 'var(--ind-transportation)',
  warehouse: 'var(--ind-warehouse)', scrap_trading: 'var(--ind-scrap)',
};
const colorFor = (id: string) => VERTICAL_COLOR[id] ?? 'var(--ind-other)';

/** The donut from the pre-rebuild Analytics page, rebuilt on by_vertical
 *  instead of an in-memory industry count. Zero-count verticals are left
 *  out here (same as the old page) -- an invisible 0% wedge adds nothing. */
export default function VerticalDonut({
  filters, byVertical, total,
}: { filters: AnalyticsFilters; byVertical: VerticalRow[]; total: number }) {
  const rows = [...byVertical].filter(v => v.count > 0).sort((a, b) => b.count - a.count);

  let acc = 0;
  const stops = rows.map((v, i) => {
    const from = acc;
    acc += (v.count / total) * 100;
    const to = i === rows.length - 1 ? 100 : acc;
    return `${colorFor(v.id)} ${from}% ${to}%`;
  });
  const gradient = stops.length ? `conic-gradient(${stops.join(', ')})` : 'var(--surface-2)';

  return (
    <div className="card p-4">
      <h2 className="text-[15px] font-bold mb-3" style={{ color: 'var(--head)' }}>Vendor vertical distribution</h2>
      {rows.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--faint)' }}>No vendors match.</p>
      ) : (
        <div className="flex items-center gap-4">
          <div style={{ position: 'relative', width: 116, height: 116, flexShrink: 0 }}>
            <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: gradient }} />
            <div className="flex flex-col items-center justify-center text-center"
                 style={{ position: 'absolute', inset: 18, borderRadius: '50%', background: 'var(--surface)' }}>
              <div className="text-[18px] font-bold leading-tight">{total}</div>
              <div className="text-[9px] font-semibold" style={{ color: 'var(--faint)' }}>Total vendors</div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            {rows.map(v => {
              const on = filters.vertical === v.id;
              return (
                <Link key={v.id}
                      href={buildHref(filters, { vertical: on ? null : v.id, category: null, subcategory: null })}
                      className="flex items-center justify-between gap-3 text-[12px]"
                      style={{ color: on ? 'var(--p600)' : 'var(--head)', fontWeight: on ? 700 : 400 }}>
                  <span className="flex items-center gap-1.5 truncate">
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: colorFor(v.id), display: 'inline-block', flexShrink: 0 }} />
                    <span className="truncate">{v.label}</span>
                  </span>
                  <span className="font-bold whitespace-nowrap">{v.count}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
