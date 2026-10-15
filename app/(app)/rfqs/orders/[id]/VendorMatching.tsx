'use client';
import { useState } from 'react';
import { runVendorMatching, confirmVendorsAndSend, markNoResponse } from '../../actions';
import SubmitButton from '@/app/SubmitButton';

export type Candidate = {
  site_id: string; site_code: string; legal_name: string; state: string | null;
  city: string | null; match_rank: number | null; selected: boolean; sent_at: string | null;
  status: 'sent' | 'responded' | 'declined' | 'no_response' | null; response_token: string | null;
  contact: { name: string; mobile: string | null; email: string | null } | null;
};

const STATUS_META: Record<string, { label: string; chip: string }> = {
  sent: { label: 'Sent, awaiting reply', chip: 'c-a' },
  responded: { label: 'Responded', chip: 'c-g' },
  declined: { label: "Can't bid", chip: 'c-n' },
  no_response: { label: 'No response', chip: 'c-r' },
};

/** One vendor's row once the RFQ has been sent: their response link (the
 *  one piece of this that's genuinely channel-agnostic — whichever of
 *  email/WhatsApp/a call actually reaches them, the link is the same) plus
 *  a quick way to open each channel with the message pre-filled. There is
 *  no live send yet (no verified WhatsApp Business API, no dialer) — a
 *  person still clicks "Send" themselves in their own email or WhatsApp. */
function SentRow({ rfqId, c, rfqNumber, rfqTitle }: { rfqId: string; c: Candidate; rfqNumber: string; rfqTitle: string }) {
  const [copied, setCopied] = useState(false);
  const link = c.response_token && typeof window !== 'undefined'
    ? `${window.location.origin}/rfq-respond/${c.response_token}` : '';
  const message = `Hi${c.contact?.name ? ` ${c.contact.name}` : ''}, Fitsol has a new RFQ (${rfqNumber} — ${rfqTitle}) for your review. ` +
    `Please submit your quote here: ${link}`;
  const meta = STATUS_META[c.status ?? 'sent'];
  const concluded = c.status === 'responded' || c.status === 'declined' || c.status === 'no_response';

  return (
    <div className="card p-3" style={{ background: 'var(--surface-2)' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold text-[13.5px]" style={{ color: 'var(--head)' }}>
            {c.legal_name} <span style={{ color: 'var(--faint)', fontWeight: 400 }}>· {c.site_code}</span>
          </div>
          <div className="text-[12.5px]" style={{ color: 'var(--faint)' }}>
            {c.city}, {c.state} · {c.contact?.name ?? 'No contact on file'}
            {c.contact?.mobile && ` · ${c.contact.mobile}`}
            {c.contact?.email && ` · ${c.contact.email}`}
          </div>
        </div>
        <span className={`chip ${meta.chip}`} style={{ fontSize: 11 }}>{meta.label}</span>
      </div>

      {!concluded && link && (
        <div className="flex gap-2 flex-wrap mt-3 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
          {c.contact?.email && (
            <a className="btn btn-o" style={{ fontSize: 12, padding: '6px 10px' }}
               href={`mailto:${c.contact.email}?subject=${encodeURIComponent(`RFQ ${rfqNumber} — ${rfqTitle}`)}&body=${encodeURIComponent(message)}`}>
              ✉ Email
            </a>
          )}
          {c.contact?.mobile && (
            <a className="btn btn-o" style={{ fontSize: 12, padding: '6px 10px' }} target="_blank" rel="noopener noreferrer"
               href={`https://wa.me/91${c.contact.mobile}?text=${encodeURIComponent(message)}`}>
              💬 WhatsApp
            </a>
          )}
          {c.contact?.mobile && (
            <a className="btn btn-o" style={{ fontSize: 12, padding: '6px 10px' }} href={`tel:${c.contact.mobile}`}>
              📞 Call {c.contact.mobile}
            </a>
          )}
          <button type="button" className="btn btn-o" style={{ fontSize: 12, padding: '6px 10px' }}
                  onClick={() => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
            {copied ? '✓ Copied' : '🔗 Copy response link'}
          </button>
          <form action={markNoResponse}>
            <input type="hidden" name="rfq_id" value={rfqId} />
            <input type="hidden" name="site_id" value={c.site_id} />
            <button type="submit" className="text-[12px] font-semibold" style={{ color: 'var(--faint)' }}>
              Mark no response
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function VendorMatching({
  rfqId, requirementId, candidates, alreadySent, rfqNumber, rfqTitle,
}: {
  rfqId: string; requirementId: string; candidates: Candidate[]; alreadySent: boolean;
  rfqNumber: string; rfqTitle: string;
}) {
  const [picked, setPicked] = useState<string[]>(candidates.filter(c => c.selected).map(c => c.site_id));

  if (!candidates.length) {
    return (
      <form action={runVendorMatching}>
        <input type="hidden" name="rfq_id" value={rfqId} />
        <input type="hidden" name="requirement_id" value={requirementId} />
        <p className="text-[13px] mb-3" style={{ color: 'var(--faint)' }}>
          Matches active vendors whose industry matches the requirement, ranked by vendor score
          (response rate and feedback), then by how many of the needed states they serve.
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
          Sent to {sent.length} vendor{sent.length === 1 ? '' : 's'}. Each has their own response
          link — use whichever channel actually reaches them (email, WhatsApp, or a call where you
          read it out); the vendor submits their quote directly once they open it.
        </p>
        <div className="grid gap-2">
          {sent.map(c => <SentRow key={c.site_id} rfqId={rfqId} c={c} rfqNumber={rfqNumber} rfqTitle={rfqTitle} />)}
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
