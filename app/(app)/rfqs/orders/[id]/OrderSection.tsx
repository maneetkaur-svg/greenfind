'use client';
import { useState } from 'react';
import { createOrder, advanceOrderStatus } from '../../actions';
import SubmitButton from '@/app/SubmitButton';

export type OrderEvent = { status: string; note: string | null; at: string };
export type OrderRow = { id: string; status: string; tracking_info: string | null };

const NEXT_STATUS: Record<string, { value: string; label: string }[]> = {
  created: [{ value: 'in_progress', label: 'Mark in progress' }, { value: 'cancelled', label: 'Cancel' }],
  in_progress: [{ value: 'shipped', label: 'Mark shipped' }, { value: 'cancelled', label: 'Cancel' }],
  shipped: [{ value: 'delivered', label: 'Confirm delivered' }],
  delivered: [{ value: 'completed', label: 'Mark completed' }],
  completed: [], cancelled: [],
};

export default function OrderSection({
  rfqId, poId, order, events,
}: { rfqId: string; poId: string; order: OrderRow | null; events: OrderEvent[] }) {
  const [note, setNote] = useState('');
  const [tracking, setTracking] = useState(order?.tracking_info ?? '');

  if (!order) {
    return (
      <form action={createOrder}>
        <input type="hidden" name="po_id" value={poId} />
        <input type="hidden" name="rfq_id" value={rfqId} />
        <SubmitButton pendingText="Creating…">Create order</SubmitButton>
      </form>
    );
  }

  const next = NEXT_STATUS[order.status] ?? [];

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <span className={`chip ${['delivered', 'completed'].includes(order.status) ? 'c-g' : order.status === 'cancelled' ? 'c-r' : 'c-a'}`}>
          {order.status.toUpperCase().replace('_', ' ')}
        </span>
      </div>

      {next.length > 0 && (
        <div className="card p-4 mb-4" style={{ background: 'var(--surface-2)' }}>
          <div className="row grid md:grid-cols-3 gap-3 mb-3">
            <div className="md:col-span-2">
              <label className="lab" htmlFor="tracking_info">Tracking / shipment info</label>
              <input id="tracking_info" value={tracking} onChange={e => setTracking(e.target.value)} />
            </div>
            <div>
              <label className="lab" htmlFor="note">Note</label>
              <input id="note" value={note} onChange={e => setNote(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {next.map(n => (
              <form key={n.value} action={advanceOrderStatus}>
                <input type="hidden" name="order_id" value={order.id} />
                <input type="hidden" name="rfq_id" value={rfqId} />
                <input type="hidden" name="status" value={n.value} />
                <input type="hidden" name="tracking_info" value={tracking} />
                <input type="hidden" name="note" value={note} />
                <SubmitButton className={n.value === 'cancelled' ? 'btn btn-o' : 'btn btn-p'} pendingText="…">
                  {n.label}
                </SubmitButton>
              </form>
            ))}
          </div>
        </div>
      )}

      <div className="text-[12px] font-bold uppercase tracking-[.07em] mb-2" style={{ color: 'var(--faint)' }}>
        Timeline
      </div>
      <div className="grid gap-2">
        {events.map((e, i) => (
          <div key={i} className="flex items-start gap-3 text-[13px]">
            <span className="chip c-n" style={{ fontSize: 11 }}>{e.status.toUpperCase().replace('_', ' ')}</span>
            <div>
              <div>{e.note}</div>
              <div className="text-[11.5px]" style={{ color: 'var(--faint)' }}>{new Date(e.at).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
