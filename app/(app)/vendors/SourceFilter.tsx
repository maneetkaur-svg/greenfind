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
 *  uses, but filtering by source (and, in the same dropdown, by who added
 *  it) instead of sorting by it. */
export default function SourceFilter({
  selected, selectedAddedBy, addedByOptions, q, industry, state, sort,
}: {
  selected: string[]; selectedAddedBy: string[]; addedByOptions: string[];
  q?: string; industry?: string; state?: string; sort?: string;
}) {
  const router = useRouter();

  const go = (sources: string[], addedBy: string[]) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (industry) params.set('industry', industry);
    if (state) params.set('state', state);
    if (sort) params.set('sort', sort);
    if (sources.length) params.set('source', sources.join(','));
    if (addedBy.length) params.set('addedBy', addedBy.join(','));
    window.dispatchEvent(new Event('app:navigating'));
    router.push(`/vendors?${params.toString()}`);
  };

  const toggleSource = (code: string) => {
    const next = selected.includes(code) ? selected.filter(x => x !== code) : [...selected, code];
    go(next, selectedAddedBy);
  };
  const toggleAddedBy = (name: string) => {
    const next = selectedAddedBy.includes(name) ? selectedAddedBy.filter(x => x !== name) : [...selectedAddedBy, name];
    go(selected, next);
  };

  return (
    <details className="relative" style={{ display: 'inline-block' }}>
      <summary className="inline-flex items-center gap-1" style={{ listStyle: 'none', cursor: 'pointer', color: 'inherit' }}>
        Source
        <span style={{ opacity: selected.length || selectedAddedBy.length ? 1 : .35, fontSize: 11 }}>⇅</span>
      </summary>
      <div className="absolute right-0 z-10 mt-2 card p-3" style={{ minWidth: 190, fontWeight: 400 }}>
        {SOURCES.map(([code, label]) => (
          <label key={code} className="flex items-center gap-2 py-1 text-[13px]" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.includes(code)} onChange={() => toggleSource(code)} />
            {label}
          </label>
        ))}
        {addedByOptions.length > 0 && (
          <>
            <div className="text-[11px] font-bold uppercase tracking-[.06em] mt-2 pt-2 border-t"
                 style={{ color: 'var(--faint)', borderColor: 'var(--line)' }}>
              Added by
            </div>
            {addedByOptions.map(name => (
              <label key={name} className="flex items-center gap-2 py-1 text-[13px]" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={selectedAddedBy.includes(name)} onChange={() => toggleAddedBy(name)} />
                {name}
              </label>
            ))}
          </>
        )}
      </div>
    </details>
  );
}
