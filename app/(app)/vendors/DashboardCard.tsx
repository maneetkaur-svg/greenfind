import Link from 'next/link';
import OthersToggle from './OthersToggle';

export type DashRow = { industry: string; vendors: number; active_vendors: number; sites: number };

const META: Record<string, { label: string; icon: string; color: string; description: string }> = {
  recycling:      { label: 'Recycling',      icon: '♻️', color: 'icon-blue',   description: 'Vendors in recycling' },
  transportation: { label: 'Transportation', icon: '🚚', color: 'icon-purple', description: 'Vendors in transportation' },
  packaging:      { label: 'Packaging',      icon: '📦', color: 'icon-orange', description: 'Vendors in packaging' },
  warehouse:      { label: 'Warehouse',      icon: '🏭', color: 'icon-teal',   description: 'Vendors in warehouse' },
  scrap_trading:  { label: 'Scrap Trading',  icon: '🔩', color: 'icon-amber',  description: 'Vendors in scrap trading' },
  unclassified:   { label: 'Others',         icon: '•••', color: 'icon-grey', description: 'Vendors in other categories' },
};
// The six main tiles: Total plus exactly these five industries. 'unclassified'
// ("Others") is deliberately not in here — six fixed tiles keeps this grid
// from growing every time an industry is added; Others lives behind the
// "View other" toggle below instead, so it never distorts this row.
const ORDER = ['recycling', 'transportation', 'packaging', 'warehouse', 'scrap_trading'];

/** The vendor list's dashboard: one metric box per industry, plus a Total
 *  box. Clicking a box toggles that industry into (or out of) the current
 *  filter, so recycling and packaging can both be selected at once — it
 *  never just replaces whatever was already picked. Other filters already
 *  applied (search text, state, sort) are carried over unchanged. */
export default function DashboardCard({
  rows, selected, q, state, sort,
}: { rows: DashRow[]; selected: string[]; q?: string; state?: string; sort?: string }) {
  const total = rows.find(r => r.industry === 'total');
  // vendor_dashboard only has a row per industry that actually has a vendor
  // in it (it's a GROUP BY), so a brand-new industry with nothing in it yet
  // would otherwise just be missing here rather than showing zero — fall
  // back to an explicit zero row so the tile always appears.
  const byInd = ORDER.map(k => rows.find(r => r.industry === k) ?? { industry: k, vendors: 0, active_vendors: 0, sites: 0 });
  const selectedRows = byInd.filter(r => selected.includes(r.industry));
  const combined = selectedRows.length >= 2
    ? {
        vendors: selectedRows.reduce((sum, r) => sum + r.vendors, 0),
        label: selectedRows.map(r => META[r.industry].label).join(' + '),
      }
    : null;

  const toggleHref = (code: string) => {
    const next = selected.includes(code) ? selected.filter(x => x !== code) : [...selected, code];
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (next.length) params.set('industry', next.join(','));
    if (state) params.set('state', state);
    if (sort) params.set('sort', sort);
    const qs = params.toString();
    return qs ? `/vendors?${qs}` : '/vendors';
  };

  return (
    <>
      {combined && (
        <div className="note mb-3" data-testid="dash-combined">
          <b>{combined.label}</b> — {combined.vendors} vendors combined
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5" data-testid="dashboard" aria-label="Vendors onboarded">
        <div className="card metric-box p-4">
          <div className="flex items-center gap-3">
            <span className="icon-circle icon-green">🏢</span>
            <div className="text-[24px] font-bold leading-tight" data-testid="dash-active">{total?.vendors ?? 0}</div>
          </div>
          <div className="text-[13px] font-bold mt-3" style={{ color: 'var(--head)' }}>Total Companies</div>
        </div>
        {byInd.map(r => {
          const m = META[r.industry];
          const on = selected.includes(r.industry);
          return (
            <Link key={r.industry} href={toggleHref(r.industry)}
                  className={`card metric-box p-4 block ${on ? 'metric-box-selected' : ''}`}
                  data-testid={`dash-${r.industry}`}
                  title={`${r.vendors} on record · ${r.active_vendors} active · ${r.sites} site${r.sites === 1 ? '' : 's'} — click to ${on ? 'remove from' : 'add to'} the filter`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className={`icon-circle ${m.color}`}>{m.icon}</span>
                  <div className="text-[24px] font-bold leading-tight">{r.vendors}</div>
                </div>
                {on && <span className="chip c-g tick" style={{ fontSize: 10 }}>✓</span>}
              </div>
              <div className="text-[13px] font-bold mt-3" style={{ color: 'var(--head)' }}>{m.label}</div>
              <div className="text-[11.5px] mt-1" style={{ color: 'var(--faint)' }}>{m.description}</div>
            </Link>
          );
        })}
      </div>
      <OthersToggle row={rows.find(r => r.industry === 'unclassified')} selected={selected} q={q} state={state} sort={sort} />
    </>
  );
}
