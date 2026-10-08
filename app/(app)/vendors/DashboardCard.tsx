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

/** The vendor list's dashboard: one metric box per industry, plus a Total box.
 *  Each box's number is "onboarded" (active) vendors, and links to the list
 *  filtered to that industry. A company with plants in two industries counts
 *  once in each, so the boxes can add up to more than the total. */
export default function DashboardCard({ rows }: { rows: DashRow[] }) {
  const total = rows.find(r => r.industry === 'total');
  const byInd = ORDER.map(k => rows.find(r => r.industry === k)).filter((r): r is DashRow => !!r);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5" data-testid="dashboard" aria-label="Vendors onboarded">
      <div className="card metric-box p-4">
        <div className="flex items-center gap-3">
          <span className="icon-circle icon-green">🏢</span>
          <div className="text-[24px] font-bold leading-tight" data-testid="dash-active">{total?.active_vendors ?? 0}</div>
        </div>
        <div className="text-[13px] font-bold mt-3" style={{ color: 'var(--head)' }}>Total Vendors</div>
        <div className="text-[11.5px] mt-1" style={{ color: 'var(--faint)' }}>Active vendor records</div>
      </div>
      {byInd.map(r => {
        const m = META[r.industry];
        return (
          <Link key={r.industry} href={`/vendors?industry=${r.industry}`} className="card metric-box p-4 block"
                data-testid={`dash-${r.industry}`}
                title={`${r.active_vendors} active of ${r.vendors} on record · ${r.sites} site${r.sites === 1 ? '' : 's'}`}>
            <div className="flex items-center gap-3">
              <span className={`icon-circle ${m.color}`}>{m.icon}</span>
              <div className="text-[24px] font-bold leading-tight">{r.active_vendors}</div>
            </div>
            <div className="text-[13px] font-bold mt-3" style={{ color: 'var(--head)' }}>{m.label}</div>
            <div className="text-[11.5px] mt-1" style={{ color: 'var(--faint)' }}>{m.description}</div>
          </Link>
        );
      })}
    </div>
  );
}
