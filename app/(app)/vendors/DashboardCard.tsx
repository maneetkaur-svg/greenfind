import Link from 'next/link';

export type DashRow = { industry: string; vendors: number; active_vendors: number; sites: number };

const LABEL: Record<string, string> = {
  recycling: 'Recycling', packaging: 'Packaging', transportation: 'Transportation', unclassified: 'Others',
};
const ORDER = ['recycling', 'packaging', 'transportation', 'unclassified'];

/** A small card, top right of the vendor list. "Onboarded" means Active.
 *  Each industry bar shows the vendors on record (grey) and the active ones (green),
 *  and links to the list filtered to that industry. A company with plants in two
 *  industries counts once in each, so the bars can add up to more than the total. */
export default function DashboardCard({ rows }: { rows: DashRow[] }) {
  const total = rows.find(r => r.industry === 'total');
  const byInd = ORDER.map(k => rows.find(r => r.industry === k)).filter((r): r is DashRow => !!r);
  const max = Math.max(1, ...byInd.map(r => r.vendors));

  return (
    <aside className="card p-4 w-full sm:w-[310px] shrink-0" data-testid="dashboard" aria-label="Vendors onboarded">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold tracking-wide" style={{ color: 'var(--faint)' }}>VENDORS ONBOARDED</div>
          <div className="text-[30px] font-bold leading-tight" data-testid="dash-active">{total?.active_vendors ?? 0}</div>
        </div>
        <div className="text-right text-[12px]" style={{ color: 'var(--faint)' }}>
          <div data-testid="dash-total">{total?.vendors ?? 0} on record</div>
          <div>{total?.sites ?? 0} site{total?.sites === 1 ? '' : 's'}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-[7px]">
        {byInd.length === 0 && <div className="text-[12.5px]" style={{ color: 'var(--faint)' }}>No vendors yet.</div>}
        {byInd.map(r => (
          <Link key={r.industry} href={`/vendors?industry=${r.industry}`} className="block" data-testid={`dash-${r.industry}`}
                title={`${r.active_vendors} active of ${r.vendors} on record · ${r.sites} site${r.sites === 1 ? '' : 's'}`}>
            <div className="flex justify-between text-[12.5px]">
              <span className="font-semibold">{LABEL[r.industry]}</span>
              <span>
                <b>{r.active_vendors}</b>
                {r.vendors !== r.active_vendors && <span style={{ color: 'var(--faint)' }}> / {r.vendors}</span>}
              </span>
            </div>
            <div style={{ height: 6, background: 'var(--line)', borderRadius: 99, width: `${(r.vendors / max) * 100}%`, minWidth: 6 }}>
              <div style={{ height: 6, borderRadius: 99, background: 'var(--p500)',
                            width: `${r.vendors ? (r.active_vendors / r.vendors) * 100 : 0}%` }} />
            </div>
          </Link>
        ))}
      </div>
    </aside>
  );
}
