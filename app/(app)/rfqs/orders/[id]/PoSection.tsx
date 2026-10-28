'use client';
import { useActionState, useState } from 'react';
import { createPurchaseOrder, markPoSent, markPoSigned, type FormState } from '../../actions';
import { fileValidationError } from '@/lib/fileUpload';
import SubmitButton from '@/app/SubmitButton';

export type Po = {
  id: string; po_number: string; amount: number | null; terms: string | null;
  status: string; signed_document_path: string | null;
};

export default function PoSection({
  rfqId, siteId, quotedPrice, po,
}: { rfqId: string; siteId: string; quotedPrice: number; po: Po | null }) {
  const [signState, signAction] = useActionState<FormState, FormData>(markPoSigned, {});
  const [amount, setAmount] = useState(String(quotedPrice));
  const [fileErr, setFileErr] = useState('');

  if (!po) {
    return (
      <form action={createPurchaseOrder} className="card p-4" style={{ background: 'var(--surface-2)' }}>
        <input type="hidden" name="rfq_id" value={rfqId} />
        <input type="hidden" name="site_id" value={siteId} />
        <div className="grid md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="lab" htmlFor="amount">Amount</label>
            <input id="amount" name="amount" type="number" step="any" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="lab" htmlFor="terms">Terms</label>
            <input id="terms" name="terms" placeholder="Payment schedule, delivery terms…" />
          </div>
        </div>
        <div className="mt-3"><SubmitButton pendingText="Creating…">Create purchase order</SubmitButton></div>
      </form>
    );
  }

  return (
    <div className="card p-4" style={{ background: 'var(--surface-2)' }}>
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div>
          <div className="font-bold text-[14px]" style={{ color: 'var(--head)' }}>{po.po_number}</div>
          <div className="text-[13px]" style={{ color: 'var(--faint)' }}>
            {po.amount != null ? `₹${po.amount.toLocaleString()}` : '—'} {po.terms && `· ${po.terms}`}
          </div>
        </div>
        <span className={`chip ${po.status === 'signed' ? 'c-g' : po.status === 'rejected' ? 'c-r' : 'c-a'}`}>
          {po.status.toUpperCase()}
        </span>
      </div>

      {po.status === 'draft' && (
        <form action={markPoSent}>
          <input type="hidden" name="po_id" value={po.id} />
          <input type="hidden" name="rfq_id" value={rfqId} />
          <SubmitButton className="btn btn-o" pendingText="…" style={{ padding: '6px 12px', fontSize: 13 }}>
            Mark sent to vendor
          </SubmitButton>
        </form>
      )}

      {po.status === 'sent' && (
        <form action={signAction}>
          <input type="hidden" name="po_id" value={po.id} />
          <input type="hidden" name="rfq_id" value={rfqId} />
          {signState.error && <div className="note r mb-3">{signState.error}</div>}
          <p className="text-[12.5px] mb-2" style={{ color: 'var(--faint)' }}>
            Once the vendor signs and returns it, upload the signed copy (optional) and mark it signed.
          </p>
          <div className="flex gap-2 items-center flex-wrap">
            <input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
                   onChange={e => {
                     const f = e.target.files?.[0];
                     if (!f) { setFileErr(''); return; }
                     const err = fileValidationError(f);
                     setFileErr(err ?? '');
                     if (err) e.target.value = '';
                   }} />
            <SubmitButton className="btn btn-o" pendingText="Saving…" style={{ padding: '6px 12px', fontSize: 13 }}>
              Mark signed
            </SubmitButton>
          </div>
          {fileErr && <div className="err mt-1">{fileErr}</div>}
        </form>
      )}

      {po.status === 'signed' && (
        <p className="text-[13px]" style={{ color: 'var(--p600)' }}>
          Signed{po.signed_document_path ? ' — copy on file' : ''}.
        </p>
      )}
    </div>
  );
}
