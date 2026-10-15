import { createClient } from '@/lib/supabase/server';
import RfqRespondForm from './RfqRespondForm';

export const metadata = { title: 'Submit your quote — GreenFind' };

type Context = {
  legal_name: string; site_code: string; rfq_number: string; title: string;
  industry: string; description: string | null; quantity: number | null; unit: string | null;
  needed_by: string | null; response_deadline: string | null;
  status: 'sent' | 'responded' | 'declined' | 'no_response' | null;
  existing_quote: { price: number; terms: string | null; valid_until: string | null; notes: string | null } | null;
};

export default async function RfqRespondPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_rfq_response_context', { p_token: token });
  const ctx = data as Context | null;

  if (error || !ctx) {
    return (
      <div className="min-h-screen grid place-items-center p-5">
        <div className="card w-full max-w-[460px] p-7 text-center">
          <h1 className="text-[18px] font-bold mb-2">This link isn&apos;t valid</h1>
          <p className="text-[13.5px]" style={{ color: 'var(--faint)' }}>
            It may have expired, or been typed in wrong. Contact Fitsol directly if you still need to respond.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center p-5">
      <div className="card w-full max-w-[480px] p-7">
        <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-1" style={{ color: 'var(--p600)' }}>
          {ctx.rfq_number} · {ctx.legal_name} ({ctx.site_code})
        </div>
        <h1 className="text-[19px] font-bold mb-1">{ctx.title}</h1>
        <p className="text-[13px] mb-5" style={{ color: 'var(--faint)' }}>
          A request for quotation from Fitsol. Submit your price below, or let us know if you can&apos;t bid this time.
        </p>

        <div className="card p-4 mb-5" style={{ background: 'var(--surface-2)' }}>
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div><b>Industry:</b> {ctx.industry}</div>
            {ctx.quantity && <div><b>Quantity:</b> {ctx.quantity} {ctx.unit}</div>}
            {ctx.needed_by && <div><b>Needed by:</b> {new Date(ctx.needed_by).toLocaleDateString()}</div>}
            {ctx.response_deadline && (
              <div><b>Respond by:</b> {new Date(ctx.response_deadline).toLocaleString()}</div>
            )}
          </div>
          {ctx.description && <p className="text-[13px] mt-3" style={{ color: 'var(--muted)' }}>{ctx.description}</p>}
        </div>

        <RfqRespondForm token={token} status={ctx.status} existingQuote={ctx.existing_quote} />
      </div>
    </div>
  );
}
