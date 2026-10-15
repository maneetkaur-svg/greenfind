'use client';
import { useActionState, useState } from 'react';
import { submitRfqResponse, type RespondState } from '../actions';

type ExistingQuote = { price: number; terms: string | null; valid_until: string | null; notes: string | null } | null;

export default function RfqRespondForm({
  token, status, existingQuote,
}: { token: string; status: 'sent' | 'responded' | 'declined' | 'no_response' | null; existingQuote: ExistingQuote }) {
  const [state, action] = useActionState<RespondState, FormData>(submitRfqResponse, {});
  const [mode, setMode] = useState<'quote' | 'decline'>('quote');

  if (status === 'declined') {
    return <div className="note">You&apos;ve already declined this RFQ. Contact Fitsol if that changes.</div>;
  }
  if (status === 'responded' && !state.ok) {
    return (
      <div className="note">
        <b>You already submitted a quote for this.</b>
        {existingQuote && (
          <div className="mt-2 text-[13px]">
            Price: {existingQuote.price}
            {existingQuote.terms && <> · Terms: {existingQuote.terms}</>}
            {existingQuote.valid_until && <> · Valid until: {existingQuote.valid_until}</>}
          </div>
        )}
        <div className="mt-2">Submitting below will replace it.</div>
        <RfqRespondFormInner token={token} action={action} mode={mode} setMode={setMode} state={state} />
      </div>
    );
  }

  if (state.ok) return <div className="note">{state.ok}</div>;

  return <RfqRespondFormInner token={token} action={action} mode={mode} setMode={setMode} state={state} />;
}

function RfqRespondFormInner({
  token, action, mode, setMode, state,
}: {
  token: string; action: (formData: FormData) => void; mode: 'quote' | 'decline';
  setMode: (m: 'quote' | 'decline') => void; state: RespondState;
}) {
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="action" value={mode} />

      {state.error && <div className="note r mb-4">{state.error}</div>}

      <div className="flex gap-2 mb-4">
        <button type="button" className={`btn ${mode === 'quote' ? 'btn-p' : 'btn-o'}`} onClick={() => setMode('quote')}>
          Submit a quote
        </button>
        <button type="button" className={`btn ${mode === 'decline' ? 'btn-p' : 'btn-o'}`} onClick={() => setMode('decline')}>
          Can&apos;t bid this time
        </button>
      </div>

      {mode === 'quote' && (
        <div className="space-y-4">
          <div>
            <label className="lab" htmlFor="price">Your price (INR) <span className="req">*</span></label>
            <input id="price" name="price" type="number" step="any" required />
          </div>
          <div>
            <label className="lab" htmlFor="valid_until">Quote valid until</label>
            <input id="valid_until" name="valid_until" type="date" />
          </div>
          <div>
            <label className="lab" htmlFor="terms">Terms</label>
            <input id="terms" name="terms" maxLength={255} placeholder="Payment terms, lead time, etc." />
          </div>
          <div>
            <label className="lab" htmlFor="notes">Anything else?</label>
            <textarea id="notes" name="notes" rows={3} />
          </div>
        </div>
      )}

      {mode === 'decline' && (
        <p className="text-[13px] mb-2" style={{ color: 'var(--faint)' }}>
          Let us know you can&apos;t bid this time, so we don&apos;t wait on a quote from you.
        </p>
      )}

      <button type="submit" className="btn btn-p w-full justify-center mt-4">
        {mode === 'quote' ? 'Submit quote' : "Confirm — can't bid"}
      </button>
    </form>
  );
}
