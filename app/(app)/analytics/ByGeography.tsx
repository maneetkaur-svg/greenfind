'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { AnalyticsFilters } from '@/lib/analyticsFilters';
import { buildHref } from '@/lib/analyticsFilters';
import type { GeoRow } from '@/lib/analyticsTypes';

const nf = new Intl.NumberFormat('en-IN');
const TOP = 8;

/** Both state and city breakdowns are already in the page's one summary
 *  call (analytics_summary always returns both) — State mode ignores the
 *  State and City filters on itself, City mode ignores only City, so
 *  switching between them here is purely a display choice, no refetch. */
export default function ByGeography({ filters, byState, byCity }: { filters: AnalyticsFilters; byState: GeoRow[]; byCity: GeoRow[] }) {
  const [mode, setMode] = useState<'state' | 'city'>('state');
  const [expanded, setExpanded] = useState(false);

  const rows = (mode === 'state' ? byState : byCity).map(r => ({ key: (mode === 'state' ? r.state : r.city) ?? '', count: r.count }));
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const shown = expanded ? sorted : sorted.slice(0, TOP);
  const rest = sorted.slice(TOP);
  const restTotal = rest.reduce((s, r) => s + r.count, 0);
  const activeKey = mode === 'state' ? filters.state : filters.city;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-[15px] font-bold" style={{ color: 'var(--head)' }}>By geography</h2>
        <div className="flex gap-1">
          {(['state', 'city'] as const).map(m => (
            <button key={m} type="button" onClick={() => { setMode(m); setExpanded(false); }}
                    className="px-2.5 py-1 text-[12px] font-semibold rounded-md"
                    style={m === mode ? { background: 'var(--p500)', color: '#fff' } : { color: 'var(--faint)' }}>
              {m === 'state' ? 'State' : 'City'}
            </button>
          ))}
        </div>
      </div>
      <table className="w-full text-[13px]">
        <thead><tr style={{ color: 'var(--faint)' }}>
          <th className="text-left font-semibold pb-2">{mode === 'state' ? 'State' : 'City'}</th>
          <th className="text-right font-semibold pb-2">Vendors</th>
        </tr></thead>
        <tbody>
          {shown.map(r => {
            const on = activeKey === r.key;
            return (
              <tr key={r.key}>
                <td className="py-1.5" style={{ borderTop: '1px solid var(--line)' }}>
                  <Link href={buildHref(filters, { [mode]: on ? null : r.key })}
                        style={{ color: on ? 'var(--p600)' : 'var(--head)', fontWeight: on ? 700 : 400 }}>
                    {r.key || 'Unknown'}
                  </Link>
                </td>
                <td className="text-right py-1.5 font-semibold" style={{ borderTop: '1px solid var(--line)', fontVariantNumeric: 'tabular-nums' }}>
                  {nf.format(r.count)}
                </td>
              </tr>
            );
          })}
          {!expanded && rest.length > 0 && (
            <tr>
              <td className="py-1.5" style={{ borderTop: '1px solid var(--line)', color: 'var(--faint)' }}>{rest.length} other {mode === 'state' ? 'states' : 'cities'}</td>
              <td className="text-right py-1.5" style={{ borderTop: '1px solid var(--line)', color: 'var(--faint)' }}>{nf.format(restTotal)}</td>
            </tr>
          )}
          {sorted.length === 0 && (
            <tr><td colSpan={2} className="py-4 text-center" style={{ color: 'var(--faint)' }}>No vendors match.</td></tr>
          )}
        </tbody>
      </table>
      {sorted.length > TOP && (
        <button type="button" onClick={() => setExpanded(e => !e)}
                className="text-[12.5px] font-semibold mt-2" style={{ color: 'var(--p600)' }}>
          {expanded ? 'Show fewer' : `Show all ${sorted.length} ${mode === 'state' ? 'states' : 'cities'}`}
        </button>
      )}
    </div>
  );
}
