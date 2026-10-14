'use client';
import { useState } from 'react';
import { runVendorMatching, confirmVendorsAndSend } from '../../actions';
import SubmitButton from '@/app/SubmitButton';

export type Candidate = {
  site_id: string; site_code: string; legal_name: string; state: string | null;
  city: string | null; match_rank: number | null; selected: boolean; sent_at: string | null;
  contact: { name: string; mobile: string | null; email: string | null } | null;
};

export default function VendorMatching({
  rfqId, requirementId, candidates, alreadySent,
}: { rfqId: string; requirementId: string; candidates: Candidate[]; alreadySent: boolean }) {
  const [picked, setPicked] = useState<string[]>(candidates.filter(c => c.selected).map(c => c.site_id));

  if (!candidates.length) {
    return (
      <form action={runVendorMatching}>
        <input type="hidden" name="rfq_id" value={rfqId} />
        <input type="hidden" name="requirement_id" value={requirementId} />
        <p className="text-[13px] mb-3" style={{ color: 'var(--faint)' }}>
          Matches active vendors whose industry matches the requirement, ranked by how many of
          the needed states they actually serve.
        </p>
        <SubmitButton pendingText="Matching…">Find matching vendors</SubmitButton>
      </form>
    );
  }

  if (alreadySent) {
    const sent = candidates.filter(c => c.selected);
    return (
      <div>
        <p className="text-[13px] mb-3" style={{ color: 'var(--faint)' }}>
          Sent to {sent.length} vendor{sent.length === 1 ? '' : 's'}. Copy their contact details below
          to send the RFQ by WhatsApp or email — there is no automatic send yet.
        </p>
        <div className="grid gap-2">
          {sent.map(c => (
            <div key={c.site_id} className="card p-3" style={{ background: 'var(--surface-2)' }}>
              <div className="font-semibold text-[13.5px]" style={{ color: 'var(--head)' }}>
                {c.legal_name} <span style={{ color: 'var(--faint)', fontWeight: 400 }}>· {c.site_code}</span>
              </div>
              <div className="text-[12.5px]" style={{ color: 'var(--faint)' }}>
                {c.city}, {c.state} · {c.contact?.name ?? 'No contact on file'}
                {c.contact?.mobile && ` · ${c.contact.mobile}`}
                {c.contact?.email && ` · ${c.contact.email}`}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <form action={confirmVendorsAndSend}>
      <input type="hidden" name="rfq_id" value={rfqId} />
      <p className="text-[13px] mb-3" style={{ color: 'var(--faint)' }}>
        Tick who to actually send this to, ranked best match first.
      </p>
      <div className="grid gap-2 mb-4">
        {candidates.map(c => {
          const on = picked.includes(c.site_id);
          return (
            <label key={c.site_id} className="card p-3 flex items-center gap-3"
                   style={on ? { borderColor: 'var(--p500)', background: 'var(--p50)' } : undefined}>
              <input type="checkbox" name="site_id" value={c.site_id} checked={on}
                     style={{ width: 'auto' }}
                     onChange={e => setPicked(p => e.target.checked ? [...p, c.site_id] : p.filter(x => x !== c.site_id))} />
              <span className="chip c-n" style={{ fontSize: 11 }}>#{c.match_rank}</span>
              <div className="flex-1">
                <div className="font-semibold text-[13.5px]" style={{ color: 'var(--head)' }}>
                  {c.legal_name} <span style={{ color: 'var(--faint)', fontWeight: 400 }}>· {c.site_code}</span>
                </div>
                <div className="text-[12px]" style={{ color: 'var(--faint)' }}>{c.city}, {c.state}</div>
              </div>
            </label>
          );
        })}
      </div>
      <SubmitButton pendingText="Confirming…" style={picked.length ? undefined : { pointerEvents: 'none', opacity: .5 }}>
        Confirm selected vendors &amp; mark as sent
      </SubmitButton>
    </form>
  );
}
