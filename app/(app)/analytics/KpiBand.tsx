import type { Kpi } from '@/lib/analyticsTypes';
import { pctLabel } from '@/lib/analyticsTypes';

const nf = new Intl.NumberFormat('en-IN');

/** Four separate tiles — total plus the three mutually-exclusive statuses,
 *  each a plain count and its share of the currently filtered total. */
export default function KpiBand({ kpi, monthLabel }: { kpi: Kpi; monthLabel: string }) {
  const tile = (dot: string, label: string, n: number, sub: string) => (
    <div className="card metric-box p-4" style={{ background: 'var(--teal)', color: '#fff', borderColor: 'var(--teal)' }}>
      <div className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: 'rgba(255,255,255,.72)' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, display: 'inline-block' }} />
        {label}
      </div>
      <div className="text-[28px] font-bold leading-tight mt-1" style={{ fontVariantNumeric: 'tabular-nums' }}>{nf.format(n)}</div>
      <div className="text-[13px] mt-0.5" style={{ color: 'rgba(255,255,255,.72)' }}>{sub}</div>
    </div>
  );

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
      {tile('#F0824A', 'Total vendors', kpi.total, kpi.added_this_month ? `+${kpi.added_this_month} added in ${monthLabel}` : `Added in ${monthLabel}`)}
      {tile('var(--warn)', 'Onboarded', kpi.onboarded, `${pctLabel(kpi.onboarded, kpi.total)} of total`)}
      {tile('var(--p300)', 'Verified', kpi.verified, `${pctLabel(kpi.verified, kpi.total)} of total`)}
      {tile('#C7D0CE', 'Unverified', kpi.unverified, `${pctLabel(kpi.unverified, kpi.total)} of total`)}
    </div>
  );
}
