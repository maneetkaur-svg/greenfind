'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AnalyticsFilters } from '@/lib/analyticsFilters';
import { buildHref, buildDrawerHref, withFilters, filtersToJsonb } from '@/lib/analyticsFilters';
import type { Taxonomy, TrendResponse, TrendMetric } from '@/lib/analyticsTypes';
import { METRIC_LABEL } from '@/lib/analyticsTypes';

type Granularity = 'daily' | 'weekly' | 'monthly';
const GRAN_LABEL: Record<Granularity, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const METRICS: TrendMetric[] = ['onboarded', 'unverified', 'verified'];
// Sentence-case verbs for inline text; METRIC_LABEL (Title Case) is for the
// button labels and the drawer breadcrumb.
const METRIC_VERB: Record<TrendMetric, string> = {
  onboarded: 'added', unverified: 'became Unverified', verified: 'became Verified',
};

function stepFor(g: Granularity): { unit: 'day' | 'week' | 'month'; days?: number } {
  return g === 'daily' ? { unit: 'day' } : g === 'weekly' ? { unit: 'week' } : { unit: 'month' };
}

function bucketEnd(bucket: string, g: Granularity): string {
  const d = new Date(bucket + 'T00:00:00');
  if (g === 'daily') d.setDate(d.getDate() + 1);
  else if (g === 'weekly') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function bucketLabel(bucket: string, g: Granularity): string {
  const d = new Date(bucket + 'T00:00:00');
  if (g === 'monthly') return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function TrendChart({ filters, taxonomy }: { filters: AnalyticsFilters; taxonomy: Taxonomy }) {
  const router = useRouter();
  const [granularity, setGranularity] = useState<Granularity>('monthly');
  const [metric, setMetric] = useState<TrendMetric>('onboarded');
  const [trendVertical, setTrendVertical] = useState('');
  const [includeImports, setIncludeImports] = useState(false);
  const [data, setData] = useState<TrendResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The widget's own vertical dropdown defaults to the page filter and
  // resets whenever the page's own vertical filter changes.
  useEffect(() => { setTrendVertical(''); }, [filters.vertical]);

  const forcedImports = filters.source === 'import';
  const effectiveVertical = trendVertical || filters.vertical || '';

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(filtersToJsonb(filters));
      params.set('granularity', granularity);
      params.set('metric', metric);
      params.set('includeImports', forcedImports || includeImports ? '1' : '0');
      if (effectiveVertical) params.set('vertical', effectiveVertical); else params.delete('vertical');
      fetch(`/api/analytics/trend?${params.toString()}`)
        .then(r => r.json())
        .then(d => { if (d.error) setErr(d.error); else { setData(d); setErr(''); } })
        .catch(() => setErr('Failed to load. Retry.'))
        .finally(() => setLoading(false));
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, metric, effectiveVertical, includeImports, forcedImports, JSON.stringify(filters)]);

  const buckets = data?.buckets ?? [];
  const max = Math.max(1, ...buckets.map(b => b.count));
  const addedCount = buckets.reduce((s, b) => s + b.count, 0);
  const g = granularity;

  const openBucket = (bucket: string) => {
    const pageHref = buildHref(filters, {});
    const drawerFilters = withFilters(filters, { vertical: effectiveVertical || null, window: null });
    const href = buildDrawerHref(pageHref, {
      label: bucketLabel(bucket, g),
      breadcrumb: `Vendors — ${METRIC_LABEL[metric]}`,
      filters: drawerFilters,
      from: bucket, to: bucketEnd(bucket, g),
    });
    router.push(href);
  };

  return (
    <div className="card p-4" style={{ opacity: loading && data ? 0.5 : 1, transition: 'opacity .15s' }}>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-1">
        <div>
          <h2 className="text-[15px] font-bold" style={{ color: 'var(--head)' }}>Vendors onboarded timeline</h2>
          <p className="text-[13px]" style={{ color: 'var(--faint)' }}>
            {addedCount} {METRIC_VERB[metric]} in the window shown{!includeImports && !forcedImports && data && data.excluded_imports > 0
              ? `, excluding ${data.excluded_imports} bulk-imported` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={effectiveVertical} onChange={e => setTrendVertical(e.target.value)}
                  style={{ fontSize: 12.5, padding: '5px 8px' }}>
            <option value="">All verticals</option>
            {taxonomy.verticals.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
          <div className="flex gap-1">
            {(['daily', 'weekly', 'monthly'] as Granularity[]).map(gr => (
              <button key={gr} type="button" onClick={() => setGranularity(gr)}
                      className="px-2.5 py-1 text-[12px] font-semibold rounded-md"
                      style={gr === granularity ? { background: 'var(--p50)', color: 'var(--p700)' } : { color: 'var(--faint)' }}>
                {GRAN_LABEL[gr]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-1 mb-3">
        {METRICS.map(m => (
          <button key={m} type="button" onClick={() => setMetric(m)}
                  className="px-2.5 py-1 text-[12px] font-semibold rounded-md"
                  style={m === metric ? { background: 'var(--p50)', color: 'var(--p700)' } : { color: 'var(--faint)' }}>
            {METRIC_LABEL[m]}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-[12.5px] mt-1 mb-3" style={{ color: 'var(--faint)', opacity: forcedImports ? 0.6 : 1 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={forcedImports || includeImports} disabled={forcedImports}
               onChange={e => setIncludeImports(e.target.checked)} />
        Include bulk imports
      </label>

      {err ? (
        <div className="note r">{err} <button type="button" onClick={() => setErr('')} style={{ textDecoration: 'underline' }}>Retry</button></div>
      ) : !data ? (
        <div className="flex items-end gap-2" style={{ height: 160 }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex-1 rounded-t" style={{ height: `${20 + (i % 5) * 12}%`, background: 'var(--surface-2)' }} />
          ))}
        </div>
      ) : (
        <div className="flex items-end gap-1.5" style={{ height: 180, overflowX: buckets.length > 20 ? 'auto' : undefined }}>
          {buckets.map((b, i) => {
            const isLatest = i === buckets.length - 1;
            const h = Math.max(2, Math.round((b.count / max) * 150));
            return (
              <button key={b.bucket} type="button" onClick={() => b.count > 0 && openBucket(b.bucket)}
                      title={`${bucketLabel(b.bucket, g)}: ${b.count} ${METRIC_VERB[metric]}`}
                      className="flex-1 flex flex-col items-center justify-end min-w-[18px]"
                      style={{ height: '100%', cursor: b.count > 0 ? 'pointer' : 'default' }}>
                <span className="text-[11px] font-bold mb-1" style={{ color: 'var(--faint)' }}>{b.count || ''}</span>
                <div className="w-full rounded-t" style={{ height: h, background: 'var(--p500)', opacity: isLatest ? 1 : 0.5 }} />
                <span className="text-[10.5px] mt-1 whitespace-nowrap" style={{ color: 'var(--faint)' }}>{bucketLabel(b.bucket, g)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
