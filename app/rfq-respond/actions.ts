'use server';
import { createClient } from '@/lib/supabase/server';

export type RespondState = { error?: string; ok?: string };

/** No getMe() check — there is no signed-in user here, same reasoning as
 *  app/onboard/actions.ts. The RPC is security definer and does every
 *  check itself, because nothing from an anonymous caller can be trusted. */
export async function submitRfqResponse(_prev: RespondState, formData: FormData): Promise<RespondState> {
  const token = String(formData.get('token') ?? '');
  const action = String(formData.get('action') ?? '');
  if (!token || !['quote', 'decline'].includes(action)) return { error: 'Something is missing from the form.' };

  const supabase = await createClient();

  if (action === 'decline') {
    const { error } = await supabase.rpc('submit_rfq_response', { p_token: token, p_action: 'decline' });
    if (error) return { error: error.message };
    return { ok: "Thanks for letting us know — we won't wait on a quote from you for this one." };
  }

  const price = String(formData.get('price') ?? '').trim();
  const terms = String(formData.get('terms') ?? '').trim();
  const validUntil = String(formData.get('valid_until') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();
  if (!price || Number(price) <= 0) return { error: 'Enter a price.' };

  const { error } = await supabase.rpc('submit_rfq_response', {
    p_token: token, p_action: 'quote', p_price: Number(price),
    p_terms: terms || null, p_valid_until: validUntil || null, p_notes: notes || null,
  });
  if (error) {
    if (error.message.includes('submit_rfq_response'))
      return { error: 'This form is not set up yet. Run sql/34_rfq_response_pipeline.sql in Supabase first.' };
    return { error: error.message };
  }
  return { ok: 'Your quote has been received. Thank you.' };
}
