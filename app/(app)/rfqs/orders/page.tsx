import Link from 'next/link';
import { createClient, getMe } from '@/lib/supabase/server';
import CreateRfqForm from './CreateRfqForm';

type RfqRow = {
  id: string; rfq_number: string; title: string; status: string;
  response_deadline: string | null; created_at: string;
  requirement: { title: string; industry: string } | { title: string; industry: string }[] | null;
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', vendors_selected: 'Vendors selected', sent: 'Sent to vendors',
  collecting_responses: 'Collecting responses', quote_selected: 'Quote selected',
  po_sent: 'PO sent', po_signed: 'PO signed', order_created: 'Order created',
  in_progress: 'In progress', shipped: 'Shipped', delivered: 'Delivered',
  completed: 'Completed', cancelled: 'Cancelled',
};
const STATUS_CLASS = (s: string) =>
  ['completed', 'delivered'].includes(s) ? 'c-g'
  : s === 'cancelled' ? 'c-r'
  : ['draft'].includes(s) ? 'c-n' : 'c-a';

const one = <T,>(v: T | T[] | null): T | null => Array.isArray(v) ? (v[0] ?? null) : v;

export default async function OrderJourneyPage() {
  const me = await getMe();
  const supabase = await createClient();

  const [{ data: rfqRaw, error }, { data: openReqs }] = await Promise.all([
    supabase.from('rfq')
      .select('id, rfq_number, title, status, response_deadline, created_at, requirement:requirement_id(title, industry)')
      .order('created_at', { ascending: false }),
    supabase.from('requirement').select('id, title').eq('status', 'open').order('created_at', { ascending: false }),
  ]);
  const rows = (rfqRaw ?? []) as unknown as RfqRow[];

  return (
    <>
      {me?.role !== 'user' && (
        <div className="card p-6 mb-5">
          <h2 className="text-[15px] font-bold mb-1">Create an RFQ</h2>
          <p className="text-[13px] mb-4" style={{ color: 'var(--faint)' }}>
            Pick an open requirement to raise an RFQ against.
          </p>
          <CreateRfqForm requirements={(openReqs ?? []) as { id: string; title: string }[]} />
        </div>
      )}

      {error && <div className="note r mb-4">Could not load RFQs: {error.message}</div>}

      <div className="card overflow-x-auto">
        <table>
          <thead><tr><th>RFQ</th><th>Requirement</th><th>Status</th><th>Response deadline</th><th></th></tr></thead>
          <tbody>
            {rows.map(r => {
              const req = one(r.requirement);
              return (
                <tr key={r.id}>
                  <td>
                    <div className="font-semibold" style={{ color: 'var(--head)' }}>{r.rfq_number}</div>
                    <div className="text-[12px]" style={{ color: 'var(--faint)' }}>{r.title}</div>
                  </td>
                  <td className="text-[13px]">{req?.title ?? '—'}</td>
                  <td><span className={`chip ${STATUS_CLASS(r.status)}`}>{STATUS_LABEL[r.status] ?? r.status}</span></td>
                  <td className="text-[13px]">{r.response_deadline ? new Date(r.response_deadline).toLocaleString() : '—'}</td>
                  <td><Link href={`/rfqs/orders/${r.id}`} className="btn btn-o" style={{ padding: '6px 12px', fontSize: 13 }}>Open</Link></td>
                </tr>
              );
            })}
            {rows.length === 0 && !error && (
              <tr><td colSpan={5} className="text-center" style={{ color: 'var(--faint)' }}>No RFQs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
