'use client';
import { useActionState } from 'react';
import { saveContacts, type SaveState } from './actions';
import SubmitButton from '@/app/SubmitButton';

type Contact = { rank: number; name: string; designation: string | null;
                 mobile: string | null; email: string | null };

const TITLES = ['Primary contact', 'Secondary contact', 'Other contact'];
const BLURBS = [
  'Day to day. Everything goes here first.',
  'Who we go to when the first is unreachable.',
  'Optional. Accounts, despatch, whoever else matters.',
];

export default function ContactsForm({
  contacts, siteId, readOnly,
}: { contacts: Contact[]; siteId: string; readOnly: boolean }) {
  const [state, action] = useActionState<SaveState, FormData>(saveContacts, {});
  const at = (r: number) => contacts.find(c => c.rank === r);

  return (
    <form action={action}>
      <input type="hidden" name="__site_id" value={siteId} />
      <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
        Two are required. A third is there if you have one.
      </p>
      {state.error && <div className="note r mb-4">{state.error}</div>}
      {state.ok && <div className="note mb-4">{state.ok}</div>}

      {[1, 2, 3].map(rank => {
        const c = at(rank);
        return (
          <div key={rank} className={rank > 1 ? 'mt-6 pt-5 border-t' : ''}
               style={rank > 1 ? { borderColor: 'var(--line)' } : undefined}>
            <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-1"
                 style={{ color: 'var(--p600)' }}>
              {TITLES[rank - 1]} {rank <= 2 && <span className="req">*</span>}
            </div>
            <p className="text-[12.5px] mb-3" style={{ color: 'var(--faint)' }}>
              {BLURBS[rank - 1]}
            </p>
            <div className="grid md:grid-cols-4 gap-4">
              <div>
                <label className="lab" htmlFor={`c${rank}_name`}>Name</label>
                <input id={`c${rank}_name`} name={`c${rank}_name`} disabled={readOnly}
                       defaultValue={c?.name ?? ''} maxLength={100} />
              </div>
              <div>
                <label className="lab" htmlFor={`c${rank}_designation`}>Designation</label>
                <input id={`c${rank}_designation`} name={`c${rank}_designation`} disabled={readOnly}
                       defaultValue={c?.designation ?? ''} maxLength={100} />
              </div>
              <div>
                <label className="lab" htmlFor={`c${rank}_mobile`}>Mobile</label>
                <input id={`c${rank}_mobile`} name={`c${rank}_mobile`} disabled={readOnly}
                       defaultValue={c?.mobile ?? ''} maxLength={10} placeholder="9414011223" />
              </div>
              <div>
                <label className="lab" htmlFor={`c${rank}_email`}>Email</label>
                <input id={`c${rank}_email`} name={`c${rank}_email`} disabled={readOnly}
                       defaultValue={c?.email ?? ''} maxLength={255} />
              </div>
            </div>
          </div>
        );
      })}

      {!readOnly && (
        <div className="mt-5">
          <SubmitButton pendingText="Saving…">Save contacts</SubmitButton>
        </div>
      )}
    </form>
  );
}
