'use client';
import { useRouter } from 'next/navigation';
import { TIER_LABEL, type VendorTier } from '@/lib/vendorTier';

const TIERS: VendorTier[] = ['onboarded', 'unverified', 'verified'];

/** Same <details> checklist pattern as IndustryFilter/SourceFilter, for the
 *  Onboarded / Unverified / Verified tier. */
export default function TierFilter({
  selected, industry, source, poc,
}: { selected: string[]; industry?: string; source?: string; poc?: string }) {
  const router = useRouter();

  const label = selected.length === 0 ? 'All statuses'
    : selected.length === 1 ? TIER_LABEL[selected[0] as VendorTier]
    : `${selected.length} statuses`;

  const go = (next: string[]) => {
    const params = new URLSearchParams();
    if (industry) params.set('industry', industry);
    if (source) params.set('source', source);
    if (next.length) params.set('tier', next.join(','));
    if (poc) params.set('poc', poc);
    router.push(`/analytics?${params.toString()}`);
  };
  const toggle = (code: string) => {
    go(selected.includes(code) ? selected.filter(x => x !== code) : [...selected, code]);
  };

  return (
    <details className="relative">
      <summary className="btn btn-o" style={{ listStyle: 'none', cursor: 'pointer' }}>{label} ▾</summary>
      <div className="absolute z-10 mt-2 card p-3" style={{ minWidth: 190 }}>
        {TIERS.map(t => (
          <label key={t} className="flex items-center gap-2 py-1 text-[13px]" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.includes(t)} onChange={() => toggle(t)} />
            {TIER_LABEL[t]}
          </label>
        ))}
        {selected.length > 0 && (
          <button type="button" className="text-[12px] font-semibold mt-2 pt-2 border-t"
                  style={{ color: 'var(--p600)', borderColor: 'var(--line)' }}
                  onClick={() => go([])}>
            Clear filter
          </button>
        )}
      </div>
    </details>
  );
}
