'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { AnalyticsFilters } from '@/lib/analyticsFilters';
import { buildHref } from '@/lib/analyticsFilters';
import type { GeoRow, RegionRow } from '@/lib/analyticsTypes';

const nf = new Intl.NumberFormat('en-IN');
const TOP = 5;

/** Both breakdowns are already in the page's one summary call (State mode
 *  ignores the State and Region filters on itself, Region mode ignores only
 *  Region, same ignore-rule relationship State/City had before Region
 *  replaced City -- see sql/54c) -- switching between them here is a
 *  display choice, no refetch. */
export default function ByGeography({ filters, byState, byRegion }: { filters: AnalyticsFilters; byState: GeoRow[]; byRegion: RegionRow[] }) {
  const [mode, setMode] = useState<'state' | 'region'>('state');
  const [expanded, setExpanded] = useState(false);

  const rows = mode === 'state'
    ? byState.map(r => ({ value: r.state ?? '', label: r.state ?? 'Unknown', count: r.count }))
    : byRegion.map(r => ({ value: r.region, label: r.label, count: r.count }));
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const shown = expanded ? sorted : sorted.slice(0, TOP);
  const activeValue = mode === 'state' ? filters.state : filters.region;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-[15px] font-bold" style={{ color: 'var(--head)' }}>By geography</h2>
        <div className="flex gap-1">
          {(['state', 'region'] as const).map(m => (
            <button key={m} type="button" onClick={() => { setMode(m); setExpanded(false); }}
                    className="px-2.5 py-1 text-[12px] font-semibold rounded-md"
                    style={m === mode ? { background: 'var(--p50)', color: 'var(--p700)' } : { color: 'var(--faint)' }}>
              {m === 'state' ? 'State' : 'Region'}
            </button>
          ))}
        </div>
      </div>
      <table className="w-full text-[13px]">
        <thead><tr style={{ color: 'var(--faint)' }}>
          <th className="text-left font-semibold pb-2">{mode === 'state' ? 'State' : 'Region'}</th>
          <th className="text-right font-semibold pb-2">Vendors</th>
        </tr></thead>
        <tbody>
          {shown.map(r => {
            const on = activeValue === r.value;
            return (
              <tr key={r.value}>
                <td className="py-1.5" style={{ borderTop: '1px solid var(--line)' }}>
                  <Link href={buildHref(filters, { [mode]: on ? null : r.value })}
                        style={{ color: on ? 'var(--p600)' : 'var(--head)', fontWeight: on ? 700 : 400 }}>
                    {r.label || 'Unknown'}
                  </Link>
                </td>
                <td className="text-right py-1.5 font-semibold" style={{ borderTop: '1px solid var(--line)', fontVariantNumeric: 'tabular-nums' }}>
                  {nf.format(r.count)}
                </td>
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr><td colSpan={2} className="py-4 text-center" style={{ color: 'var(--faint)' }}>No vendors match.</td></tr>
          )}
        </tbody>
      </table>
      {sorted.length > TOP && (
        <button type="button" onClick={() => setExpanded(e => !e)}
                className="text-[12.5px] font-semibold mt-2" style={{ color: 'var(--p600)' }}>
          {expanded ? 'Show fewer' : `Show all ${sorted.length} ${mode === 'state' ? 'states' : 'regions'}`}
        </button>
      )}
    </div>
  );
}
