import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, getMe } from '@/lib/supabase/server';
import VendorMatching, { type Candidate } from './VendorMatching';
import QuotationSection, { type Vendor, type Quotation } from './QuotationSection';
import PoSection, { type Po } from './PoSection';
import OrderSection, { type OrderEvent, type OrderRow } from './OrderSection';
import FeedbackSection, { type FeedbackRow } from './FeedbackSection';

const one = <T,>(v: T | T[] | null): T | null => Array.isArray(v) ? (v[0] ?? null) : v;

const STAGE_AFTER_SENT = new Set([
  'sent', 'collecting_responses', 'quote_selected', 'po_sent', 'po_signed',
  'order_created', 'in_progress', 'shipped', 'delivered', 'completed',
]);
const STAGE_AFTER_QUOTE = new Set([
  'quote_selected', 'po_sent', 'po_signed', 'order_created',
  'in_progress', 'shipped', 'delivered', 'completed',
]);
const STAGE_AFTER_PO_SIGNED = new Set([
  'po_signed', 'order_created', 'in_progress', 'shipped', 'delivered', 'completed',
]);

export default async function RfqWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await getMe();
  const supabase = await createClient();

  const { data: rfq } = await supabase.from('rfq')
    .select('*, requirement:requirement_id(id, title, industry, geography, description)')
    .eq('id', id).maybeSingle();
  if (!rfq) notFound();
  type ReqRef = { id: string; title: string; industry: string; geography: string[]; description: string | null };
  const requirement = one(rfq.requirement as unknown as ReqRef | ReqRef[] | null);

  const { data: candidateRows } = await supabase.from('rfq_vendor')
    .select('site_id, match_rank, selected, sent_at, site:site_id(site_code, state, city, company:company_id(legal_name))')
    .eq('rfq_id', id).order('match_rank');

  const siteIds = (candidateRows ?? []).map(c => c.site_id);
  const { data: contactRows } = siteIds.length
    ? await supabase.from('site_contact').select('site_id, name, mobile, email').eq('rank', 1).in('site_id', siteIds)
    : { data: [] as { site_id: string; name: string; mobile: string | null; email: string | null }[] };
  const contactBySite = new Map((contactRows ?? []).map(c => [c.site_id, c]));

  const candidates: Candidate[] = (candidateRows ?? []).map(c => {
    const site = one(c.site as unknown) as { site_code: string; state: string | null; city: string | null; company: unknown } | null;
    const company = site ? one(site.company as unknown) as { legal_name: string } | null : null;
    return {
      site_id: c.site_id, site_code: site?.site_code ?? '—', legal_name: company?.legal_name ?? '—',
      state: site?.state ?? null, city: site?.city ?? null, match_rank: c.match_rank,
      selected: c.selected, sent_at: c.sent_at, contact: contactBySite.get(c.site_id) ?? null,
    };
  });
  const vendors: Vendor[] = candidates.filter(c => c.selected).map(c => ({ site_id: c.site_id, site_code: c.site_code, legal_name: c.legal_name }));

  const { data: quotations } = STAGE_AFTER_SENT.has(rfq.status)
    ? await supabase.from('rfq_quotation').select('*').eq('rfq_id', id).order('price')
    : { data: [] as Quotation[] };
  const selectedQuote = (quotations ?? []).find(q => q.is_selected) ?? null;

  const { data: po } = STAGE_AFTER_QUOTE.has(rfq.status)
    ? await supabase.from('purchase_order').select('*').eq('rfq_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null as Po | null };

  const { data: order } = STAGE_AFTER_PO_SIGNED.has(rfq.status) && po
    ? await supabase.from('vendor_order').select('*').eq('rfq_id', id).maybeSingle()
    : { data: null as OrderRow | null };

  const { data: events } = order
    ? await supabase.from('order_status_event').select('status, note, at').eq('order_id', order.id).order('at')
    : { data: [] as OrderEvent[] };

  const { data: feedback } = order && ['delivered', 'completed'].includes(order.status)
    ? await supabase.from('rfq_feedback').select('from_party, rating, comments').eq('order_id', order.id)
    : { data: [] as FeedbackRow[] };

  const Section = ({ n, title, blurb, children }: { n: string; title: string; blurb?: string; children: React.ReactNode }) => (
    <div className="card mb-5">
      <div className="p-4 border-b flex items-baseline gap-3" style={{ borderColor: 'var(--line)' }}>
        <span className="chip c-g" style={{ fontSize: 11 }}>{n}</span>
        <h2 className="text-[15px] font-bold">{title}</h2>
        {blurb && <span className="text-[12px] ml-auto" style={{ color: 'var(--faint)' }}>{blurb}</span>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );

  return (
    <>
      <Link href="/rfqs/orders" className="text-[13px] font-semibold" style={{ color: 'var(--faint)' }}>← Order Journey</Link>
      <div className="flex justify-between items-start gap-4 flex-wrap mt-2 mb-5">
        <div>
          <h1 className="text-[24px] font-bold">{rfq.rfq_number} — {rfq.title}</h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--faint)' }}>
            {requirement?.title} · {requirement?.industry}
          </p>
        </div>
        <span className="chip c-a">{String(rfq.status).toUpperCase().replace(/_/g, ' ')}</span>
      </div>

      <Section n="1" title="Vendor matching &amp; send" blurb="Top matches by industry + geography">
        <VendorMatching rfqId={id} requirementId={requirement?.id ?? ''} candidates={candidates}
                         alreadySent={STAGE_AFTER_SENT.has(rfq.status)} />
      </Section>

      {STAGE_AFTER_SENT.has(rfq.status) && (
        <Section n="2" title="Quotations">
          <QuotationSection rfqId={id} vendors={vendors} quotations={(quotations ?? []) as Quotation[]}
                            deadline={rfq.response_deadline} quoteSelected={!!selectedQuote} />
        </Section>
      )}

      {STAGE_AFTER_QUOTE.has(rfq.status) && selectedQuote && (
        <Section n="3" title="Purchase order">
          <PoSection rfqId={id} siteId={selectedQuote.site_id} quotedPrice={selectedQuote.price} po={po as Po | null} />
        </Section>
      )}

      {STAGE_AFTER_PO_SIGNED.has(rfq.status) && po && (
        <Section n="4" title="Order journey">
          <OrderSection rfqId={id} poId={po.id} order={order as OrderRow | null} events={(events ?? []) as OrderEvent[]} />
        </Section>
      )}

      {order && ['delivered', 'completed'].includes(order.status) && (
        <Section n="5" title="Feedback">
          <FeedbackSection orderId={order.id} rfqId={id} existing={(feedback ?? []) as FeedbackRow[]} />
        </Section>
      )}
    </>
  );
}
