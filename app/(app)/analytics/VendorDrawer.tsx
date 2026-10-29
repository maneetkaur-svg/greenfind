'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { parseDrawerFromSearch, filtersToJsonb } from '@/lib/analyticsFilters';
import { vendorTier, TIER_LABEL, TIER_CHIP_CLASS } from '@/lib/vendorTier';
import type { VendorsResponse } from '@/lib/analyticsTypes';

const PAGE_SIZE = 50;

/** Mounted once near the page root. Every "View vendors" link and trend-
 *  chart bar is a plain navigation that sets ?drawer=1&d...=... — this is
 *  the one place that notices that param, fetches the matching vendors
 *  (never bundled with the dashboard's own data), and renders the panel.
 *  Closing it removes those params, leaving the page's own filters and
 *  tables exactly as they were. */
export default function VendorDrawer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const spec = parseDrawerFromSearch(searchParams);

  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<VendorsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const specKey = spec ? JSON.stringify(spec) : '';

  const close = () => {
    const params = new URLSearchParams(searchParams.toString());
    for (const k of ['drawer', 'dLabel', 'dBreadcrumb', 'dFrom', 'dTo', 'dVertical', 'dCategory', 'dSubcategory', 'dState', 'dCity', 'dSource', 'dAddedBy', 'dWindow'])
      params.delete(k);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  useEffect(() => {
    if (!spec) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);

  useEffect(() => { setQ(''); setPage(1); }, [specKey]);

  useEffect(() => {
    if (!spec) return;
    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(filtersToJsonb(spec.filters));
      if (spec.from) params.set('from', spec.from);
      if (spec.to) params.set('to', spec.to);
      if (q) params.set('q', q);
      params.set('page', String(page));
      params.set('pageSize', String(PAGE_SIZE));
      fetch(`/api/analytics/vendors?${params.toString()}`)
        .then(r => r.json())
        .then(d => { if (d.error) setErr(d.error); else { setData(d); setErr(''); } })
        .catch(() => setErr('Failed to load. Retry.'))
        .finally(() => setLoading(false));
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, q, page]);

  if (!spec) return null;

  const exportHref = (() => {
    const params = new URLSearchParams(filtersToJsonb(spec.filters));
    if (spec.from) params.set('from', spec.from);
    if (spec.to) params.set('to', spec.to);
    if (q) params.set('q', q);
    params.set('format', 'csv');
    return `/api/analytics/vendors?${params.toString()}`;
  })();

  return (
    <>
      <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.25)', zIndex: 40 }} />
      <div role="dialog" aria-modal="true" aria-label={spec.label}
           className="card"
           style={{
             position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(460px, 100vw)',
             zIndex: 41, borderRadius: 0, borderLeft: '1px solid var(--line)',
             display: 'flex', flexDirection: 'column', padding: 20, overflowY: 'auto',
           }}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            {spec.breadcrumb && <div className="text-[11.5px] font-semibold" style={{ color: 'var(--faint)' }}>{spec.breadcrumb}</div>}
            <h2 className="text-[19px] font-bold" style={{ color: 'var(--head)' }}>{spec.label}</h2>
          </div>
          <button type="button" onClick={close} aria-label="Close" autoFocus
                  className="text-[20px] leading-none" style={{ color: 'var(--faint)' }}>×</button>
        </div>
        <p className="text-[13px] mb-3" style={{ color: 'var(--faint)' }}>
          {data ? `${data.total} vendor${data.total === 1 ? '' : 's'} match your filters` : 'Loading…'}
        </p>

        <div className="flex gap-2 mb-3">
          <input value={q} onChange={e => { setQ(e.target.value); setPage(1); }}
                 placeholder="Search name, city, state" style={{ fontSize: 13, flex: 1 }} />
          <a href={exportHref} className="btn btn-o" style={{ fontSize: 12.5, padding: '7px 12px' }}>Export CSV</a>
        </div>

        {err && <div className="note r mb-3">{err} <button type="button" onClick={() => setErr('')} style={{ textDecoration: 'underline' }}>Retry</button></div>}

        <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity .15s' }}>
          {(data?.rows ?? []).map(r => {
            const tier = vendorTier(r.core_complete, r.banking_complete);
            return (
              <Link key={r.id} href={`/vendors/${r.id}`}
                    className="flex items-center justify-between gap-3 py-2.5"
                    style={{ borderTop: '1px solid var(--line)' }}>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--head)' }}>{r.legal_name}</div>
                  <div className="text-[12px]" style={{ color: 'var(--faint)' }}>{[r.city, r.state].filter(Boolean).join(', ') || '—'}</div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`chip ${TIER_CHIP_CLASS[tier]}`}>{TIER_LABEL[tier]}</span>
                  <div className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
                    {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </div>
              </Link>
            );
          })}
          {data && data.rows.length === 0 && (
            <p className="text-[13px] py-6 text-center" style={{ color: 'var(--faint)' }}>No vendors match.</p>
          )}
        </div>

        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
            <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                    className="page-btn" style={page <= 1 ? { opacity: .4 } : undefined}>Back</button>
            <span className="text-[12.5px]" style={{ color: 'var(--faint)' }}>
              Page {page} of {Math.ceil(data.total / PAGE_SIZE)}
            </span>
            <button type="button" disabled={page >= Math.ceil(data.total / PAGE_SIZE)} onClick={() => setPage(p => p + 1)}
                    className="page-btn" style={page >= Math.ceil(data.total / PAGE_SIZE) ? { opacity: .4 } : undefined}>Next</button>
          </div>
        )}
      </div>
    </>
  );
}
