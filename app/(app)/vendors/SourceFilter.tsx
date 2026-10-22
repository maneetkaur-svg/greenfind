'use client';
import { useRouter } from 'next/navigation';

const SOURCES: [string, string][] = [
  ['import', 'Import'],
  ['manual', 'Internal'],
  ['public_form', 'External'],
  ['old_portal', 'Old GreenFind Portal'],
];

/** Same <details> checklist pattern as the Industry filter — driven entirely
 *  by the URL, in the same small-button spot the Vendor column's sort toggle
 *  uses, but filtering by source instead of sorting by it. */
export default function SourceFilter({
  selected, q, industry, state, sort,
}: { selected: string[]; q?: string; industry?: string; state?: string; sort?: string }) {
  const router = useRouter();

  const toggle = (code: string) => {
    const next = selected.includes(code) ? selected.filter(x => x !== code) : [...selected, code];
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (industry) params.set('industry', industry);
    if (state) params.set('state', state);
    if (sort) params.set('sort', sort);
    if (next.length) params.set('source', next.join(','));
    window.dispatchEvent(new Event('app:navigating'));
    router.push(`/vendors?${params.toString()}`);
  };

  return (
    <details className="relative" style={{ display: 'inline-block' }}>
      <summary className="inline-flex items-center gap-1" style={{ listStyle: 'none', cursor: 'pointer', color: 'inherit' }}>
        Source
        <span style={{ opacity: selected.length ? 1 : .35, fontSize: 11 }}>⇅</span>
      </summary>
      <div className="absolute right-0 z-10 mt-2 card p-3" style={{ minWidth: 190, fontWeight: 400 }}>
        {SOURCES.map(([code, label]) => (
          <label key={code} className="flex items-center gap-2 py-1 text-[13px]" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.includes(code)} onChange={() => toggle(code)} />
            {label}
          </label>
        ))}
      </div>
    </details>
  );
}
