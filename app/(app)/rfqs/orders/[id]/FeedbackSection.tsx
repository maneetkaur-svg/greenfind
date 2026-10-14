'use client';
import { useState } from 'react';
import { submitFeedback } from '../../actions';
import SubmitButton from '@/app/SubmitButton';

export type FeedbackRow = { from_party: string; rating: number | null; comments: string | null };

const PARTIES: { key: string; label: string }[] = [
  { key: 'vendor', label: 'From the vendor' },
  { key: 'fitsol', label: 'From Fitsol' },
  { key: 'client', label: "From the client" },
];

export default function FeedbackSection({ orderId, rfqId, existing }: { orderId: string; rfqId: string; existing: FeedbackRow[] }) {
  return (
    <div className="grid md:grid-cols-3 gap-3">
      {PARTIES.map(p => {
        const fb = existing.find(e => e.from_party === p.key);
        return (
          <div key={p.key} className="card p-4" style={{ background: 'var(--surface-2)' }}>
            <div className="text-[12.5px] font-bold mb-2" style={{ color: 'var(--head)' }}>{p.label}</div>
            {fb ? (
              <div className="text-[13px]">
                <div>{'★'.repeat(fb.rating ?? 0)}{'☆'.repeat(5 - (fb.rating ?? 0))}</div>
                {fb.comments && <div className="text-[12px] mt-1" style={{ color: 'var(--faint)' }}>{fb.comments}</div>}
              </div>
            ) : (
              <FeedbackForm orderId={orderId} rfqId={rfqId} party={p.key} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FeedbackForm({ orderId, rfqId, party }: { orderId: string; rfqId: string; party: string }) {
  const [rating, setRating] = useState(5);
  return (
    <form action={submitFeedback}>
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="rfq_id" value={rfqId} />
      <input type="hidden" name="from_party" value={party} />
      <select name="rating" value={rating} onChange={e => setRating(Number(e.target.value))} className="mb-2">
        {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</option>)}
      </select>
      <textarea name="comments" rows={2} placeholder="Comments" className="mb-2" />
      <SubmitButton className="btn btn-o" pendingText="Saving…" style={{ padding: '6px 12px', fontSize: 13 }}>
        Submit
      </SubmitButton>
    </form>
  );
}
