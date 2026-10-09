import Link from 'next/link';

export type DashRow = { industry: string; vendors: number; active_vendors: number; sites: number };

const META: Record<string, { label: string; icon: string; color: string; description: string }> = {
  recycling:      { label: 'Recycling',      icon: '♻️', color: 'icon-blue',   description: 'Vendors in recycling' },
  transportation: { label: 'Transportation', icon: '🚚', color: 'icon-purple', description: 'Vendors in transportation' },
  packaging:      { label: 'Packaging',      icon: '📦', color: 'icon-orange', description: 'Vendors in packaging' },
  warehouse:      { label: 'Warehouse',      icon: '🏭', color: 'icon-teal',   description: 'Vendors in warehouse' },
  unclassified:   { label: 'Others',         icon: '•••', color: 'icon-grey', description: 'Vendors in other categories' },
};
const ORDER = ['recycling', 'transportation', 'packaging', 'warehouse', 'unclassified'];

/** The vendor list's dashboard: one metric box per industry, plus a Total
 *  box. Clicking a box toggles that industry into (or out of) the current
 *  filter, so recycling and packaging can both be selected at once — it
 *  never just replaces whatever was already picked. Other filters already
 *  applied (search text, state, sort) are carried over unchanged. */
export default function DashboardCard({
  rows, selected, q, state, sort,
}: { rows: DashRow[]; selected: string[]; q?: string; state?: string; sort?: string }) {
  const total = rows.find(r => r.industry === 'total');
  const byInd = ORDER.map(k => rows.find(r => r.industry === k)).filter((r): r is DashRow => !!r);

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
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5" data-testid="dashboard" aria-label="Vendors onboarded">
      <div className="card metric-box p-4">
        <div className="flex items-center gap-3">
          <span className="icon-circle icon-green">🏢</span>
          <div className="text-[24px] font-bold leading-tight" data-testid="dash-active">{total?.vendors ?? 0}</div>
        </div>
        <div className="text-[13px] font-bold mt-3" style={{ color: 'var(--head)' }}>Total Vendors</div>
        <div className="text-[11.5px] mt-1" style={{ color: 'var(--faint)' }}>{total?.active_vendors ?? 0} active</div>
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
  );
}
