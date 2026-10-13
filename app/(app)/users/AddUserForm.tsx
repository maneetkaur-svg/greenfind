'use client';
import { useActionState, useState } from 'react';
import { addUser, type UserState } from './actions';
import SubmitButton from '@/app/SubmitButton';

export default function AddUserForm() {
  const [state, action] = useActionState<UserState, FormData>(addUser, {});
  const [mode, setMode] = useState<'invite' | 'direct'>('invite');

  return (
    <div className="card p-6">
      <h2 className="text-[15px] font-bold mb-1">Add someone</h2>
      <p className="text-[13px] mb-4" style={{ color: 'var(--faint)' }}>
        {mode === 'invite'
          ? 'Sends an invite email automatically — they set their own password when they click it.'
          : 'Creates the account right away with the password you set below. Nothing is emailed — tell them yourself.'}
      </p>

      <div className="flex gap-2 mb-4">
        <button type="button"
                className={`chip ${mode === 'invite' ? 'c-g tick' : 'c-n'}`}
                style={{ padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
                onClick={() => setMode('invite')}>
          {mode === 'invite' && '✓ '}Email them an invite
        </button>
        <button type="button"
                className={`chip ${mode === 'direct' ? 'c-g tick' : 'c-n'}`}
                style={{ padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
                onClick={() => setMode('direct')}>
          {mode === 'direct' && '✓ '}Set the password myself
        </button>
      </div>

      {state.error && <div className="note r mb-4">{state.error}</div>}
      {state.ok && <div className="note mb-4">{state.ok}</div>}

      <form action={action} className="grid md:grid-cols-4 gap-4 items-end">
        <input type="hidden" name="mode" value={mode} />
        <div>
          <label className="lab" htmlFor="full_name">Name</label>
          <input id="full_name" name="full_name" required />
        </div>
        <div>
          <label className="lab" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required />
        </div>
        {mode === 'direct' && (
          <div>
            <label className="lab" htmlFor="password">Password</label>
            <input id="password" name="password" type="text" required minLength={8}
                   placeholder="At least 8 characters" />
          </div>
        )}
        <div>
          <label className="lab" htmlFor="role">Role</label>
          <select id="role" name="role" defaultValue="operations">
            <option value="operations">Operations</option>
            <option value="user">User — read only</option>
            <option value="super_admin">Super Admin</option>
          </select>
        </div>
        <div className="md:col-span-4">
          <SubmitButton pendingText={mode === 'invite' ? 'Sending invite…' : 'Creating…'}>
            {mode === 'invite' ? 'Send invite' : 'Create account'}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
