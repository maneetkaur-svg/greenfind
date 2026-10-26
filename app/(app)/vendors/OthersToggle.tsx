'use client';
import { useState } from 'react';
import Link from 'next/link';

type Row = { vendors: number; active_vendors: number; sites: number };

/** The "Others" (unclassified) tile, hidden behind a small toggle instead of
 *  sitting permanently in the main dashboard row — keeps that row at a
 *  fixed six tiles (Total + five industries) regardless of how many
 *  uncategorised vendors accumulate. */
export default function OthersToggle({
  row, selected, q, state, sort,
}: { row: Row | undefined; selected: string[]; q?: string; state?: string; sort?: string }) {
  const [open, setOpen] = useState(false);
  if (!row) return null;

  const on = selected.includes('unclassified');
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const next = on ? selected.filter(x => x !== 'unclassified') : [...selected, 'unclassified'];
  if (next.length) params.set('industry', next.join(','));
  if (state) params.set('state', state);
  if (sort) params.set('sort', sort);
  const qs = params.toString();
  const toggleHref = qs ? `/vendors?${qs}` : '/vendors';

  return (
    <div className="mb-5">
      <button type="button" onClick={() => setOpen(p => !p)}
              className="text-[12.5px] font-semibold" style={{ color: 'var(--p600)' }}>
        {open ? 'Hide other' : `View other (${row.vendors})`}
      </button>
      {open && (
        <div className="mt-2" style={{ maxWidth: 220 }}>
          <Link href={toggleHref}
                className={`card metric-box p-4 block ${on ? 'metric-box-selected' : ''}`}
                title={`${row.vendors} on record · ${row.active_vendors} active · ${row.sites} site${row.sites === 1 ? '' : 's'} — click to ${on ? 'remove from' : 'add to'} the filter`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="icon-circle icon-grey">•••</span>
                <div className="text-[24px] font-bold leading-tight">{row.vendors}</div>
              </div>
              {on && <span className="chip c-g tick" style={{ fontSize: 10 }}>✓</span>}
            </div>
            <div className="text-[13px] font-bold mt-3" style={{ color: 'var(--head)' }}>Others</div>
            <div className="text-[11.5px] mt-1" style={{ color: 'var(--faint)' }}>Vendors in other categories</div>
          </Link>
        </div>
      )}
    </div>
  );
}
