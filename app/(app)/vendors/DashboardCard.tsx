import Link from 'next/link';

export type DashRow = { industry: string; vendors: number; active_vendors: number; sites: number };

const LABEL: Record<string, string> = {
  recycling: 'Recycling', packaging: 'Packaging', transportation: 'Transportation',
  warehouse: 'Warehouse', unclassified: 'Others',
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
      <div className="card p-4 text-center">
        <div className="text-[26px] font-bold leading-tight" data-testid="dash-active">{total?.active_vendors ?? 0}</div>
        <div className="text-[11px] font-bold tracking-wide mt-1" style={{ color: 'var(--faint)' }}>TOTAL VENDORS</div>
      </div>
      {byInd.map(r => (
        <Link key={r.industry} href={`/vendors?industry=${r.industry}`} className="card p-4 text-center block hover:border-[var(--p500)]"
              data-testid={`dash-${r.industry}`}
              title={`${r.active_vendors} active of ${r.vendors} on record · ${r.sites} site${r.sites === 1 ? '' : 's'}`}>
          <div className="text-[26px] font-bold leading-tight">{r.active_vendors}</div>
          <div className="text-[11px] font-bold tracking-wide mt-1" style={{ color: 'var(--faint)' }}>
            {LABEL[r.industry]?.toUpperCase()}
          </div>
        </Link>
      ))}
    </div>
  );
}
