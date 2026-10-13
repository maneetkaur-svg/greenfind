'use client';
import { useActionState, useState } from 'react';
import { deleteVendor, type DeleteState } from './actions';
import SubmitButton from '@/app/SubmitButton';

/** Deliberately not a one-click action. Collapsed by default, then asks for
 *  a real reason (the same ten-character minimum the database itself
 *  enforces on change_request.reason) and the vendor's own site code typed
 *  out, so an admin has to actually stop and look at what they're about to
 *  remove rather than click through a confirm() dialog on reflex. */
export default function DeleteVendorPanel({
  siteId, siteCode, legalName,
}: { siteId: string; siteCode: string; legalName: string }) {
  const [state, action] = useActionState<DeleteState, FormData>(deleteVendor, {});
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [reason, setReason] = useState('');
  const canSubmit = confirmText.trim() === siteCode && reason.trim().length >= 10;

  if (!open) {
    return (
      <div className="card p-6 mt-5" style={{ borderColor: 'var(--err)' }}>
        <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-2" style={{ color: 'var(--err)' }}>
          Danger zone
        </div>
        <p className="text-[13px] mb-3" style={{ color: 'var(--muted)' }}>
          Only a super admin can delete this vendor, and it asks for a reason before anything happens.
        </p>
        <button type="button" className="btn btn-o" style={{ color: 'var(--err)', borderColor: 'var(--err)' }}
                onClick={() => setOpen(true)}>
          Delete this vendor…
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="card p-6 mt-5" style={{ borderColor: 'var(--err)' }}>
      <input type="hidden" name="__site_id" value={siteId} />
      <input type="hidden" name="__site_code" value={siteCode} />

      <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-2" style={{ color: 'var(--err)' }}>
        Danger zone — delete {legalName}
      </div>
      {state.error && <div className="note r mb-4">{state.error}</div>}

      <p className="text-[13px] mb-4" style={{ color: 'var(--muted)' }}>
        This soft-deletes the site immediately — it disappears from every list and search right
        away — and the company too, if this is its only site. Nothing is permanently destroyed,
        and the reason below is kept on record (as an approved change_request row) regardless of
        what happens to the vendor afterward.
      </p>

      <label className="lab" htmlFor="reason">Reason for deletion <span className="req">*</span></label>
      <textarea id="reason" rows={3} name="reason" value={reason} onChange={e => setReason(e.target.value)}
                placeholder="Why is this vendor being removed?" />
      <div className="hint mb-4">
        {reason.trim().length < 10 ? `${10 - reason.trim().length} more character${10 - reason.trim().length === 1 ? '' : 's'} needed.` : 'Looks good.'}
      </div>

      <label className="lab" htmlFor="__confirm_code">
        Type this vendor&rsquo;s site code to confirm — <b>{siteCode}</b> <span className="req">*</span>
      </label>
      <input id="__confirm_code" name="__confirm_code" value={confirmText}
             onChange={e => setConfirmText(e.target.value)} placeholder={siteCode} className="mb-4" />

      <div className="flex gap-2 items-center">
        {canSubmit ? (
          <SubmitButton className="btn" style={{ background: 'var(--err)', color: '#fff' }} pendingText="Deleting…">
            Permanently remove this vendor
          </SubmitButton>
        ) : (
          <button type="button" disabled className="btn"
                  style={{ background: 'var(--line-2)', color: 'var(--faint)', cursor: 'not-allowed' }}>
            Permanently remove this vendor
          </button>
        )}
        <button type="button" className="btn btn-o" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
