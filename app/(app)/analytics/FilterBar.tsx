'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AnalyticsFilters } from '@/lib/analyticsFilters';
import { buildHref, SOURCE_LABEL, WINDOW_LABEL } from '@/lib/analyticsFilters';
import type { Taxonomy, GeoRow } from '@/lib/analyticsTypes';

const sel = { fontSize: 13, padding: '7px 10px', minWidth: 120 } as const;

/** Collapsed by default to a single scrollable line (eight selects is a lot
 *  of vertical real estate to spend before you've even looked at the data);
 *  "View more" expands it back to the full wrapped grid, "View less"
 *  collapses it again. The filters themselves don't change between the two
 *  -- only whether the row wraps or scrolls. */
export default function FilterBar({
  filters, taxonomy, byState, byCity,
}: { filters: AnalyticsFilters; taxonomy: Taxonomy; byState: GeoRow[]; byCity: GeoRow[] }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const go = (changes: Partial<Record<keyof AnalyticsFilters, string | null>>) => router.push(buildHref(filters, changes));

  const vertical = taxonomy.verticals.find(v => v.id === filters.vertical);
  const categories = vertical?.categories.filter(c => c.is_active) ?? [];
  const category = categories.find(c => c.id === filters.category);
  const subcategories = category?.subcategories.filter(s => s.is_active) ?? [];

  // State options come from by_state (already computed ignoring state/city,
  // so this always lists every state with a vendor under the other active
  // filters, not just the currently-selected one). City options come from
  // by_city, which already respects a chosen State.
  const states = [...byState].sort((a, b) => (a.state ?? '').localeCompare(b.state ?? ''));
  const cities = [...byCity].sort((a, b) => (a.city ?? '').localeCompare(b.city ?? ''));

  const hasFilters = Object.values(filters).some(Boolean);

  const field = (label: string, children: React.ReactNode) => (
    <label className="flex items-center gap-2 text-[13px] shrink-0" style={{ color: 'var(--muted)' }}>
      {label}
      {children}
    </label>
  );

  const fields = (
    <>
      {field('Vertical', (
        <select style={sel} value={filters.vertical ?? ''}
                onChange={e => go({ vertical: e.target.value || null, category: null, subcategory: null })}>
          <option value="">All</option>
          {taxonomy.verticals.filter(v => v.is_active).map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      ))}

      {field('Service category', (
        <select style={sel} value={filters.category ?? ''} disabled={!vertical}
                onChange={e => go({ category: e.target.value || null, subcategory: null })}>
          <option value="">{vertical ? 'All' : 'Pick a vertical first'}</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      ))}

      {field('Sub-category', (
        <select style={sel} value={filters.subcategory ?? ''} disabled={!category || subcategories.length === 0}
                onChange={e => go({ subcategory: e.target.value || null })}>
          <option value="">{!category ? '—' : subcategories.length ? 'All' : 'None defined'}</option>
          {subcategories.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      ))}

      {field('State', (
        <select style={sel} value={filters.state ?? ''}
                onChange={e => go({ state: e.target.value || null, city: null })}>
          <option value="">All</option>
          {states.map(s => <option key={s.state} value={s.state}>{s.state} ({s.count})</option>)}
        </select>
      ))}

      {field('City', (
        <select style={sel} value={filters.city ?? ''} disabled={!filters.state}
                onChange={e => go({ city: e.target.value || null })}>
          <option value="">{filters.state ? 'All' : 'Pick a state first'}</option>
          {cities.map(c => <option key={c.city} value={c.city}>{c.city} ({c.count})</option>)}
        </select>
      ))}

      {field('Source', (
        <select style={sel} value={filters.source ?? ''} onChange={e => go({ source: e.target.value || null })}>
          <option value="">All</option>
          {Object.entries(SOURCE_LABEL).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
      ))}

      {field('Added by', (
        <select style={sel} value={filters.addedBy ?? ''} onChange={e => go({ addedBy: e.target.value || null })}>
          <option value="">Anyone</option>
          {taxonomy.added_by.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="external">External</option>
        </select>
      ))}

      {field('Added', (
        <select style={sel} value={filters.window ?? ''} onChange={e => go({ window: e.target.value || null })}>
          <option value="">All time</option>
          {Object.entries(WINDOW_LABEL).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
      ))}
    </>
  );

  const resetBtn = hasFilters && (
    <button type="button" onClick={() => router.push('/analytics')}
            className="text-[12.5px] font-semibold shrink-0" style={{ color: 'var(--p600)' }}>
      Reset
    </button>
  );

  const toggleBtn = (
    <button type="button" onClick={() => setExpanded(e => !e)}
            className="text-[12px] font-semibold shrink-0 flex items-center gap-1" style={{ color: 'var(--p600)' }}>
      {expanded ? 'View less' : 'View more'}
      <span style={{ fontSize: 9 }}>{expanded ? '▲' : '▼'}</span>
    </button>
  );

  if (!expanded) {
    return (
      <div className="card p-3 mb-4 flex items-center gap-3" style={{ overflowX: 'auto' }}>
        {fields}
        <span className="flex items-center gap-3 ml-auto shrink-0">
          {resetBtn}
          {toggleBtn}
        </span>
      </div>
    );
  }

  return (
    <div className="card p-3 mb-4">
      <div className="flex items-center gap-3 flex-wrap">{fields}</div>
      <div className="flex items-center justify-end gap-3 mt-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
        {resetBtn}
        {toggleBtn}
      </div>
    </div>
  );
}
