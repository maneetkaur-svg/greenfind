'use client';
import { useActionState } from 'react';
import { deleteUser, type UserState } from './actions';
import SubmitButton from '@/app/SubmitButton';

/** A real delete, not Disable — asks once, in plain language, before it
 *  does anything irreversible. Most of the time this will come back with
 *  a friendly "can't, they have activity on record" rather than actually
 *  deleting anything; see the action itself for why. */
export default function DeleteUserButton({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState<UserState, FormData>(deleteUser, {});

  return (
    <form action={action}
          onSubmit={e => {
            if (!window.confirm(`Permanently delete ${name}'s account? This cannot be undone.`)) {
              e.preventDefault();
            }
          }}>
      <input type="hidden" name="id" value={id} />
      {state.error && <div className="note r mb-2" style={{ maxWidth: 260 }}>{state.error}</div>}
      <SubmitButton className="btn btn-o" pendingText="Deleting…"
                    style={{ padding: '6px 12px', fontSize: 13, color: 'var(--err)', borderColor: 'var(--err)' }}>
        Delete
      </SubmitButton>
    </form>
  );
}
