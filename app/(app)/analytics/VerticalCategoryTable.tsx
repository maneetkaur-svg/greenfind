'use client';
import { Fragment, useState } from 'react';
import Link from 'next/link';
import type { AnalyticsFilters } from '@/lib/analyticsFilters';
import { buildHref, buildDrawerHref, withFilters } from '@/lib/analyticsFilters';
import type { Taxonomy, VerticalRow, CategoryRow, SubcategoryRow } from '@/lib/analyticsTypes';
import { pctLabel } from '@/lib/analyticsTypes';

const nf = new Intl.NumberFormat('en-IN');
const th = 'text-left font-semibold pb-2';
const thR = 'text-right font-semibold pb-2';
const td = 'py-1.5' as const;
const tdR = 'text-right py-1.5 font-semibold' as const;

export default function VerticalCategoryTable({
  filters, taxonomy, byVertical, byCategory, bySubcategory, total,
}: {
  filters: AnalyticsFilters;
  taxonomy: Taxonomy;
  byVertical: VerticalRow[];
  byCategory: CategoryRow[];
  bySubcategory: Record<string, SubcategoryRow[]>;
  /** The page's own filtered grand total (summary.kpi.total) — the "Share
   *  of total" column's denominator, not a sum of by_vertical's own rows
   *  (those ignore vertical/category/subcategory, so they only sum back to
   *  this total when neither of those two is already set). */
  total: number;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const pageHref = buildHref(filters, {});
  const activeId = filters.vertical ?? '';
  const activeVertical = taxonomy.verticals.find(v => v.id === activeId);
  const activeRow = byVertical.find(v => v.id === activeId);
  const vertTotal = byVertical.find(v => v.id === activeId)?.count ?? 0;

  const viewHref = (label: string, breadcrumb: string, overrides: Partial<Record<keyof AnalyticsFilters, string | null>>) =>
    buildDrawerHref(pageHref, { label, breadcrumb, filters: withFilters(filters, overrides) });

  return (
    <div className="card p-4">
      <div className="flex items-center gap-1 mb-4 flex-wrap" style={{ borderBottom: '1px solid var(--line)' }}>
        <Link href={buildHref(filters, { vertical: null, category: null, subcategory: null })}
              className="px-3 py-2 text-[13px] font-semibold"
              style={!activeId
                ? { color: 'var(--p600)', borderBottom: '2px solid var(--p500)' }
                : { color: 'var(--muted)' }}>
          All
        </Link>
        {taxonomy.verticals.map(v => {
          const row = byVertical.find(r => r.id === v.id);
          const n = row?.count ?? 0;
          const on = activeId === v.id;
          return (
            <Link key={v.id} href={buildHref(filters, { vertical: v.id, category: null, subcategory: null })}
                  className="px-3 py-2 text-[13px] font-semibold"
                  style={on
                    ? { color: 'var(--p600)', borderBottom: '2px solid var(--p500)' }
                    : { color: n === 0 ? 'var(--line-2)' : 'var(--muted)' }}>
              {v.label} <span style={{ fontWeight: 400 }}>({nf.format(n)})</span>
            </Link>
          );
        })}
      </div>

      {!activeVertical ? (
        <table className="w-full text-[13px]">
          <thead><tr style={{ color: 'var(--faint)' }}>
            <th className={th}>Vertical</th><th className={thR}>Vendors</th><th className={thR}>Share of total</th>
            <th className={thR}>Verified</th><th className={thR}></th>
          </tr></thead>
          <tbody>
            {byVertical.map(v => (
              <tr key={v.id}>
                <td className={td} style={{ borderTop: '1px solid var(--line)' }}>
                  <Link href={buildHref(filters, { vertical: v.id })} style={{ color: 'var(--head)', fontWeight: 600 }}>{v.label}</Link>
                </td>
                <td className={tdR} style={{ borderTop: '1px solid var(--line)', fontVariantNumeric: 'tabular-nums' }}>{nf.format(v.count)}</td>
                <td className="text-right py-1.5" style={{ borderTop: '1px solid var(--line)', color: 'var(--faint)' }}>{pctLabel(v.count, total)}</td>
                <td className="text-right py-1.5" style={{ borderTop: '1px solid var(--line)', color: 'var(--faint)' }}>{nf.format(v.verified)}</td>
                <td className="text-right py-1.5" style={{ borderTop: '1px solid var(--line)' }}>
                  <Link href={viewHref(v.label, 'All vendors', { vertical: v.id, category: null, subcategory: null })}
                        className="text-[12.5px] font-semibold" style={{ color: 'var(--p600)' }}>View vendors</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : byCategory.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-[13px] mb-3" style={{ color: 'var(--faint)' }}>
            No service categories are defined for {activeVertical.label}.
          </p>
          <Link href={viewHref(activeVertical.label, 'All vendors', { category: null, subcategory: null })}
                className="btn btn-o" style={{ display: 'inline-flex' }}>
            View all {nf.format(vertTotal)} vendors
          </Link>
        </div>
      ) : (
        <>
          {activeRow && activeRow.count === 0 && (
            <p className="text-[13px] mb-3" style={{ color: 'var(--faint)' }}>No {activeVertical.label} vendors yet.</p>
          )}
          <table className="w-full text-[13px]">
            <thead><tr style={{ color: 'var(--faint)' }}>
              <th className={th}>Service category</th><th className={thR}>Vendors</th>
              <th className={thR}>Share of {activeVertical.label}</th><th className={thR}>Verified</th><th className={thR}></th>
            </tr></thead>
            <tbody>
              {byCategory.map(c => {
                const subs = bySubcategory[c.id] ?? [];
                const isOpen = open.has(c.id);
                const catOn = filters.category === c.id;
                return (
                  <Fragment key={c.id}>
                    <tr>
                      <td className={td} style={{ borderTop: '1px solid var(--line)' }}>
                        <span className="flex items-center gap-1.5">
                          {c.has_subcategories ? (
                            <button type="button" onClick={() => toggle(c.id)}
                                    style={{ color: 'var(--faint)', width: 16 }} aria-label={isOpen ? 'Collapse' : 'Expand'}>
                              {isOpen ? '▾' : '▸'}
                            </button>
                          ) : <span style={{ width: 16, display: 'inline-block' }} />}
                          {c.is_active ? (
                            <Link href={buildHref(filters, { category: catOn ? null : c.id, subcategory: null })}
                                  style={{ color: catOn ? 'var(--p600)' : 'var(--head)', fontWeight: catOn ? 700 : 600 }}>
                              {c.label}
                            </Link>
                          ) : (
                            <span style={{ color: 'var(--faint)' }}>{c.label} (inactive)</span>
                          )}
                        </span>
                      </td>
                      <td className={tdR} style={{ borderTop: '1px solid var(--line)', fontVariantNumeric: 'tabular-nums' }}>{nf.format(c.count)}</td>
                      <td className="text-right py-1.5" style={{ borderTop: '1px solid var(--line)', color: 'var(--faint)' }}>{pctLabel(c.count, vertTotal)}</td>
                      <td className="text-right py-1.5" style={{ borderTop: '1px solid var(--line)', color: 'var(--faint)' }}>{nf.format(c.verified)}</td>
                      <td className="text-right py-1.5" style={{ borderTop: '1px solid var(--line)' }}>
                        <Link href={viewHref(c.label, `${activeVertical.label} › ${c.label}`, { category: c.id, subcategory: null })}
                              className="text-[12.5px] font-semibold" style={{ color: 'var(--p600)' }}>View vendors</Link>
                      </td>
                    </tr>
                    {isOpen && subs.map(s => {
                      const subOn = filters.subcategory === s.id;
                      return (
                        <tr key={s.id} style={{ background: 'var(--surface-2)' }}>
                          <td className="py-1.5 pl-7" style={{ borderTop: '1px solid var(--line)' }}>
                            {s.is_active ? (
                              <Link href={buildHref(filters, { category: c.id, subcategory: subOn ? null : s.id })}
                                    style={{ color: subOn ? 'var(--p600)' : 'var(--muted)', fontWeight: subOn ? 700 : 400 }}>
                                {s.label}
                              </Link>
                            ) : <span style={{ color: 'var(--faint)' }}>{s.label} (inactive)</span>}
                          </td>
                          <td className="text-right py-1.5" style={{ borderTop: '1px solid var(--line)', fontVariantNumeric: 'tabular-nums' }}>{nf.format(s.count)}</td>
                          <td className="text-right py-1.5" style={{ borderTop: '1px solid var(--line)', color: 'var(--faint)' }}>{pctLabel(s.count, vertTotal)}</td>
                          <td className="text-right py-1.5" style={{ borderTop: '1px solid var(--line)', color: 'var(--faint)' }}>{nf.format(s.verified)}</td>
                          <td className="text-right py-1.5" style={{ borderTop: '1px solid var(--line)' }}>
                            <Link href={viewHref(s.label, `${activeVertical.label} › ${c.label} › ${s.label}`, { category: c.id, subcategory: s.id })}
                                  className="text-[12.5px] font-semibold" style={{ color: 'var(--p600)' }}>View vendors</Link>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
