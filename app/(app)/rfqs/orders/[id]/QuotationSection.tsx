'use client';
import { useActionState, useState } from 'react';
import { addQuotation, selectQuotation, setResponseDeadline, type FormState } from '../../actions';
import SubmitButton from '@/app/SubmitButton';

export type Vendor = { site_id: string; site_code: string; legal_name: string };
export type Quotation = {
  id: string; site_id: string; price: number; currency: string; terms: string | null;
  valid_until: string | null; notes: string | null; is_selected: boolean;
};

export default function QuotationSection({
  rfqId, vendors, quotations, deadline, quoteSelected,
}: {
  rfqId: string; vendors: Vendor[]; quotations: Quotation[];
  deadline: string | null; quoteSelected: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(addQuotation, {});
  const [siteId, setSiteId] = useState('');

  return (
    <div>
      {!deadline && (
        <form action={setResponseDeadline} className="flex gap-2 items-center mb-4 flex-wrap">
          <input type="hidden" name="rfq_id" value={rfqId} />
          <span className="text-[13px]" style={{ color: 'var(--faint)' }}>Set a response window:</span>
          <button name="hours" value="12" className="btn btn-o" style={{ padding: '6px 12px', fontSize: 13 }}>12 hours</button>
          <button name="hours" value="24" className="btn btn-o" style={{ padding: '6px 12px', fontSize: 13 }}>24 hours</button>
        </form>
      )}
      {deadline && (
        <p className="text-[13px] mb-4" style={{ color: 'var(--faint)' }}>
          Responses expected by <b style={{ color: 'var(--head)' }}>{new Date(deadline).toLocaleString()}</b>.
        </p>
      )}

      {quotations.length > 0 && (
        <table className="mb-4">
          <thead><tr><th>Vendor</th><th>Price</th><th>Valid until</th><th>Terms</th><th></th></tr></thead>
          <tbody>
            {quotations.map(q => {
              const v = vendors.find(x => x.site_id === q.site_id);
              return (
                <tr key={q.id}>
                  <td className="text-[13px]">{v?.legal_name ?? q.site_id}</td>
                  <td className="font-semibold text-[13.5px]">{q.currency} {q.price.toLocaleString()}</td>
                  <td className="text-[13px]">{q.valid_until ?? '—'}</td>
                  <td className="text-[12.5px]" style={{ color: 'var(--faint)' }}>{q.terms ?? '—'}</td>
                  <td>
                    {q.is_selected ? (
                      <span className="chip c-g">✓ Selected</span>
                    ) : !quoteSelected ? (
                      <form action={selectQuotation}>
                        <input type="hidden" name="rfq_id" value={rfqId} />
                        <input type="hidden" name="quotation_id" value={q.id} />
                        <SubmitButton className="btn btn-o" pendingText="…" style={{ padding: '6px 12px', fontSize: 13 }}>
                          Select as winner
                        </SubmitButton>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {!quoteSelected && (
        <form action={action} className="card p-4" style={{ background: 'var(--surface-2)' }}>
          <input type="hidden" name="rfq_id" value={rfqId} />
          {state.error && <div className="note r mb-3">{state.error}</div>}
          <div className="text-[12.5px] font-bold mb-3" style={{ color: 'var(--head)' }}>Record a quotation</div>
          <div className="grid md:grid-cols-4 gap-3 items-end">
            <div>
              <label className="lab" htmlFor="site_id">Vendor</label>
              <select id="site_id" name="site_id" required value={siteId} onChange={e => setSiteId(e.target.value)}>
                <option value="">Select…</option>
                {vendors.map(v => <option key={v.site_id} value={v.site_id}>{v.legal_name} ({v.site_code})</option>)}
              </select>
            </div>
            <div>
              <label className="lab" htmlFor="price">Price</label>
              <input id="price" name="price" type="number" step="any" required />
            </div>
            <div>
              <label className="lab" htmlFor="valid_until">Valid until</label>
              <input id="valid_until" name="valid_until" type="date" />
            </div>
            <div>
              <label className="lab" htmlFor="terms">Terms</label>
              <input id="terms" name="terms" placeholder="Payment, delivery…" />
            </div>
          </div>
          <div className="mt-3">
            <SubmitButton className="btn btn-o" pendingText="Saving…">Add quotation</SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
