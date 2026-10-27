'use client';
import { useRouter } from 'next/navigation';

const SOURCES: [string, string][] = [
  ['import', 'Import'],
  ['manual', 'Internal'],
  ['public_form', 'External'],
  ['old_portal', 'Old GreenFind Portal'],
];

/** Same <details> checklist pattern as IndustryFilter, for Source instead. */
export default function SourceFilter({
  selected, industry, tier, poc,
}: { selected: string[]; industry?: string; tier?: string; poc?: string }) {
  const router = useRouter();

  const label = selected.length === 0 ? 'All sources'
    : selected.length === 1 ? (SOURCES.find(([c]) => c === selected[0])?.[1] ?? selected[0])
    : `${selected.length} sources`;

  const go = (next: string[]) => {
    const params = new URLSearchParams();
    if (industry) params.set('industry', industry);
    if (next.length) params.set('source', next.join(','));
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
        {SOURCES.map(([code, lbl]) => (
          <label key={code} className="flex items-center gap-2 py-1 text-[13px]" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.includes(code)} onChange={() => toggle(code)} />
            {lbl}
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
