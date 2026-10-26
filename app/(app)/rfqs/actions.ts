'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient, getMe } from '@/lib/supabase/server';
import { INDUSTRIES } from '@/lib/constants';

export type FormState = { error?: string; ok?: string };

function requireWriter(me: Awaited<ReturnType<typeof getMe>>): string | null {
  if (!me) return 'You are not signed in.';
  if (me.role === 'user') return 'Your role is read-only.';
  return null;
}

/* ---------- Requirements ---------- */

export async function createRequirement(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await getMe();
  const denied = requireWriter(me);
  if (denied) return { error: denied };

  const title = String(formData.get('title') ?? '').trim();
  const industry = String(formData.get('industry') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  const geography = formData.getAll('geography').map(String);
  const quantity = String(formData.get('quantity') ?? '').trim();
  const unit = String(formData.get('unit') ?? '').trim();
  const targetPrice = String(formData.get('target_price') ?? '').trim();
  const neededBy = String(formData.get('needed_by') ?? '').trim();

  if (!title) return { error: 'Give the requirement a title.' };
  if (!INDUSTRIES.some(i => i.code === industry))
    return { error: 'Choose an industry type.' };

  const supabase = await createClient();
  const { error } = await supabase.from('requirement').insert({
    title, industry, description: description || null, geography,
    quantity: quantity ? Number(quantity) : null, unit: unit || null,
    target_price: targetPrice ? Number(targetPrice) : null,
    needed_by: neededBy || null, created_by: me!.id,
  });
  if (error) return { error: error.message };

  revalidatePath('/rfqs/requirements');
  return { ok: 'Requirement added.' };
}

export async function closeRequirement(formData: FormData) {
  const me = await getMe();
  if (requireWriter(me)) return;
  const id = String(formData.get('id') ?? '');
  const supabase = await createClient();
  await supabase.from('requirement').update({ status: 'closed' }).eq('id', id);
  revalidatePath('/rfqs/requirements');
}

/* ---------- RFQ creation + vendor matching ---------- */

export async function createRfq(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await getMe();
  const denied = requireWriter(me);
  if (denied) return { error: denied };

  const requirementId = String(formData.get('requirement_id') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  if (!requirementId) return { error: 'Choose a requirement.' };
  if (!title) return { error: 'Give the RFQ a title.' };

  const supabase = await createClient();
  const { data, error } = await supabase.from('rfq').insert({
    requirement_id: requirementId, title, created_by: me!.id,
  }).select('id').single();
  if (error) return { error: error.message };

  redirect(`/rfqs/orders/${data.id}`);
}

export async function runVendorMatching(formData: FormData) {
  const me = await getMe();
  if (requireWriter(me)) return;
  const rfqId = String(formData.get('rfq_id') ?? '');
  const requirementId = String(formData.get('requirement_id') ?? '');

  const supabase = await createClient();
  // Clear out previous, unselected candidates so re-running this reflects
  // the current vendor list — but never touch a row a human already
  // confirmed (selected) or already sent.
  await supabase.from('rfq_vendor').delete().eq('rfq_id', rfqId).eq('selected', false);

  const { data: matches } = await supabase.rpc('match_vendors_for_requirement', {
    p_requirement_id: requirementId, p_limit: 10,
  });
  if (matches?.length) {
    await supabase.from('rfq_vendor').upsert(
      matches.map((m: { site_id: string; match_rank: number | null; match_score: number }, i: number) => ({
        rfq_id: rfqId, site_id: m.site_id, match_rank: i + 1, match_score: m.match_score,
      })),
      { onConflict: 'rfq_id,site_id', ignoreDuplicates: true }
    );
  }
  revalidatePath(`/rfqs/orders/${rfqId}`);
}

export async function confirmVendorsAndSend(formData: FormData) {
  const me = await getMe();
  if (requireWriter(me)) return;
  const rfqId = String(formData.get('rfq_id') ?? '');
  const siteIds = formData.getAll('site_id').map(String);
  if (!siteIds.length) return;

  const supabase = await createClient();
  const now = new Date().toISOString();
  await supabase.from('rfq_vendor')
    .update({ selected: true, sent_at: now, status: 'sent' }).eq('rfq_id', rfqId).in('site_id', siteIds);
  await supabase.from('rfq')
    .update({ status: 'sent', sent_at: now }).eq('id', rfqId);

  revalidatePath(`/rfqs/orders/${rfqId}`);
}

/** For a vendor who was sent the RFQ but, after the response window, never
 *  replied through any channel — logged explicitly rather than left blank,
 *  since it feeds the vendor's response rate (public.vendor_score). */
export async function markNoResponse(formData: FormData) {
  const me = await getMe();
  if (requireWriter(me)) return;
  const rfqId = String(formData.get('rfq_id') ?? '');
  const siteId = String(formData.get('site_id') ?? '');

  const supabase = await createClient();
  await supabase.from('rfq_vendor')
    .update({ status: 'no_response', responded_at: new Date().toISOString() })
    .eq('rfq_id', rfqId).eq('site_id', siteId);

  revalidatePath(`/rfqs/orders/${rfqId}`);
}

export async function setResponseDeadline(formData: FormData) {
  const me = await getMe();
  if (requireWriter(me)) return;
  const rfqId = String(formData.get('rfq_id') ?? '');
  const hours = Number(formData.get('hours') ?? 24);
  const deadline = new Date(Date.now() + hours * 3600 * 1000).toISOString();

  const supabase = await createClient();
  await supabase.from('rfq')
    .update({ response_deadline: deadline, status: 'collecting_responses' }).eq('id', rfqId);
  revalidatePath(`/rfqs/orders/${rfqId}`);
}

/* ---------- Quotations ---------- */

export async function addQuotation(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await getMe();
  const denied = requireWriter(me);
  if (denied) return { error: denied };

  const rfqId = String(formData.get('rfq_id') ?? '');
  const siteId = String(formData.get('site_id') ?? '');
  const price = String(formData.get('price') ?? '').trim();
  const terms = String(formData.get('terms') ?? '').trim();
  const validUntil = String(formData.get('valid_until') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();
  if (!siteId) return { error: 'Choose which vendor this quotation is from.' };
  if (!price) return { error: 'Enter the quoted price.' };

  const supabase = await createClient();
  const { error } = await supabase.from('rfq_quotation').upsert({
    rfq_id: rfqId, site_id: siteId, price: Number(price),
    terms: terms || null, valid_until: validUntil || null, notes: notes || null,
    entered_by: me!.id,
  }, { onConflict: 'rfq_id,site_id' });
  if (error) return { error: error.message };

  revalidatePath(`/rfqs/orders/${rfqId}`);
  return { ok: 'Quotation recorded.' };
}

export async function selectQuotation(formData: FormData) {
  const me = await getMe();
  if (requireWriter(me)) return;
  const rfqId = String(formData.get('rfq_id') ?? '');
  const quotationId = String(formData.get('quotation_id') ?? '');

  const supabase = await createClient();
  await supabase.from('rfq_quotation').update({ is_selected: false }).eq('rfq_id', rfqId);
  await supabase.from('rfq_quotation').update({ is_selected: true }).eq('id', quotationId);
  await supabase.from('rfq').update({ status: 'quote_selected' }).eq('id', rfqId);

  revalidatePath(`/rfqs/orders/${rfqId}`);
}

/* ---------- Purchase order ---------- */

export async function createPurchaseOrder(formData: FormData) {
  const me = await getMe();
  if (requireWriter(me)) return;
  const rfqId = String(formData.get('rfq_id') ?? '');
  const siteId = String(formData.get('site_id') ?? '');
  const amount = String(formData.get('amount') ?? '').trim();
  const terms = String(formData.get('terms') ?? '').trim();

  const supabase = await createClient();
  await supabase.from('purchase_order').insert({
    rfq_id: rfqId, site_id: siteId, amount: amount ? Number(amount) : null,
    terms: terms || null, created_by: me!.id,
  });
  revalidatePath(`/rfqs/orders/${rfqId}`);
}

export async function markPoSent(formData: FormData) {
  const me = await getMe();
  if (requireWriter(me)) return;
  const poId = String(formData.get('po_id') ?? '');
  const rfqId = String(formData.get('rfq_id') ?? '');

  const supabase = await createClient();
  await supabase.from('purchase_order')
    .update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', poId);
  await supabase.from('rfq').update({ status: 'po_sent' }).eq('id', rfqId);
  revalidatePath(`/rfqs/orders/${rfqId}`);
}

export async function markPoSigned(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await getMe();
  const denied = requireWriter(me);
  if (denied) return { error: denied };

  const poId = String(formData.get('po_id') ?? '');
  const rfqId = String(formData.get('rfq_id') ?? '');
  const file = formData.get('file') as File | null;

  const supabase = await createClient();
  let signedPath: string | null = null;

  if (file && file.size > 0) {
    if (file.size > 10 * 1024 * 1024) return { error: 'That file is larger than 10 MB.' };
    const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    signedPath = `po/${poId}/${Date.now()}_${safe}`;
    const { error: upErr } = await supabase.storage.from('vendor-documents')
      .upload(signedPath, file, { contentType: file.type || undefined, upsert: false });
    if (upErr) return { error: 'Upload failed: ' + upErr.message };
  }

  const { error } = await supabase.from('purchase_order').update({
    status: 'signed', signed_at: new Date().toISOString(),
    ...(signedPath ? { signed_document_path: signedPath } : {}),
  }).eq('id', poId);
  if (error) return { error: error.message };

  await supabase.from('rfq').update({ status: 'po_signed' }).eq('id', rfqId);
  revalidatePath(`/rfqs/orders/${rfqId}`);
  return { ok: 'Purchase order marked signed.' };
}

export async function getPoSignedUrl(path: string): Promise<string | null> {
  const me = await getMe();
  if (!me) return null;
  const supabase = await createClient();
  const { data } = await supabase.storage.from('vendor-documents').createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

/* ---------- Order journey ---------- */

export async function createOrder(formData: FormData) {
  const me = await getMe();
  if (requireWriter(me)) return;
  const poId = String(formData.get('po_id') ?? '');
  const rfqId = String(formData.get('rfq_id') ?? '');

  const supabase = await createClient();
  const { data: order, error } = await supabase.from('vendor_order').insert({
    purchase_order_id: poId, rfq_id: rfqId,
  }).select('id').single();
  if (error || !order) return;

  await supabase.from('order_status_event').insert({
    order_id: order.id, status: 'created', changed_by: me!.id,
  });
  await supabase.from('rfq').update({ status: 'order_created' }).eq('id', rfqId);
  revalidatePath(`/rfqs/orders/${rfqId}`);
}

const ORDER_TO_RFQ_STATUS: Record<string, string> = {
  in_progress: 'in_progress', shipped: 'shipped', delivered: 'delivered',
  completed: 'completed', cancelled: 'cancelled',
};

export async function advanceOrderStatus(formData: FormData) {
  const me = await getMe();
  if (requireWriter(me)) return;
  const orderId = String(formData.get('order_id') ?? '');
  const rfqId = String(formData.get('rfq_id') ?? '');
  const status = String(formData.get('status') ?? '');
  const note = String(formData.get('note') ?? '').trim();
  const trackingInfo = String(formData.get('tracking_info') ?? '').trim();
  if (!status) return;

  const supabase = await createClient();
  await supabase.from('vendor_order').update({
    status, ...(trackingInfo ? { tracking_info: trackingInfo } : {}),
    ...(status === 'delivered' ? { delivered_at: new Date().toISOString() } : {}),
  }).eq('id', orderId);
  await supabase.from('order_status_event').insert({
    order_id: orderId, status, note: note || null, changed_by: me!.id,
  });
  const rfqStatus = ORDER_TO_RFQ_STATUS[status];
  if (rfqStatus) await supabase.from('rfq').update({ status: rfqStatus }).eq('id', rfqId);

  revalidatePath(`/rfqs/orders/${rfqId}`);
}

/* ---------- Feedback ---------- */

export async function submitFeedback(formData: FormData) {
  const me = await getMe();
  if (requireWriter(me)) return;
  const orderId = String(formData.get('order_id') ?? '');
  const rfqId = String(formData.get('rfq_id') ?? '');
  const fromParty = String(formData.get('from_party') ?? '');
  const rating = String(formData.get('rating') ?? '').trim();
  const comments = String(formData.get('comments') ?? '').trim();
  if (!['vendor', 'fitsol', 'client'].includes(fromParty)) return;

  const supabase = await createClient();
  await supabase.from('rfq_feedback').upsert({
    order_id: orderId, from_party: fromParty,
    rating: rating ? Number(rating) : null, comments: comments || null,
    submitted_by: me!.id,
  }, { onConflict: 'order_id,from_party' });

  revalidatePath(`/rfqs/orders/${rfqId}`);
}
