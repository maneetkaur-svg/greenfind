'use client';
import { useRouter } from 'next/navigation';
import { INDUSTRIES } from '@/lib/constants';

/** Same pattern as the vendor list's industry picker — a <details> disclosure
 *  acting as a zero-extra-state multi-select, driven entirely by the URL so
 *  the filter survives a refresh and can be shared as a link. */
export default function IndustryFilter({
  selected, source, tier, poc,
}: { selected: string[]; source?: string; tier?: string; poc?: string }) {
  const router = useRouter();

  const label = selected.length === 0 ? 'All industries'
    : selected.length === 1
      ? (selected[0] === 'unclassified' ? 'Others' : INDUSTRIES.find(i => i.code === selected[0])?.label ?? selected[0])
      : `${selected.length} industries`;

  const go = (next: string[]) => {
    const params = new URLSearchParams();
    if (next.length) params.set('industry', next.join(','));
    if (source) params.set('source', source);
    if (tier) params.set('tier', tier);
    if (poc) params.set('poc', poc);
    router.push(`/analytics?${params.toString()}`);
  };
  const toggle = (code: string) => {
    go(selected.includes(code) ? selected.filter(x => x !== code) : [...selected, code]);
  };

  return (
    <details className="relative">
      <summary className="btn btn-o" style={{ listStyle: 'none', cursor: 'pointer' }}>{label} ▾</summary>
      <div className="absolute z-10 mt-2 card p-3" style={{ minWidth: 200 }}>
        {INDUSTRIES.map(i => (
          <label key={i.code} className="flex items-center gap-2 py-1 text-[13px]" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.includes(i.code)} onChange={() => toggle(i.code)} />
            {i.label}
          </label>
        ))}
        <label className="flex items-center gap-2 py-1 text-[13px]" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={selected.includes('unclassified')} onChange={() => toggle('unclassified')} />
          Others
        </label>
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
