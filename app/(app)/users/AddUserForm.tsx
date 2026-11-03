'use client';
import { useActionState } from 'react';
import { addUser, type UserState } from './actions';
import SubmitButton from '@/app/SubmitButton';

export default function AddUserForm() {
  const [state, action] = useActionState<UserState, FormData>(addUser, {});

  return (
    <div className="card p-6">
      <h2 className="text-[15px] font-bold mb-1">Add someone</h2>
      <p className="text-[13px] mb-4" style={{ color: 'var(--faint)' }}>
        Creates the account right away with the password you set below. Nothing is emailed — tell them yourself.
      </p>

      {state.error && <div className="note r mb-4">{state.error}</div>}
      {state.ok && <div className="note mb-4">{state.ok}</div>}

      <form action={action} className="grid md:grid-cols-4 gap-4 items-end">
        <div>
          <label className="lab" htmlFor="full_name">Name</label>
          <input id="full_name" name="full_name" required />
        </div>
        <div>
          <label className="lab" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required />
        </div>
        <div>
          <label className="lab" htmlFor="password">Password</label>
          <input id="password" name="password" type="text" required minLength={8}
                 placeholder="At least 8 characters" />
        </div>
        <div>
          <label className="lab" htmlFor="role">Role</label>
          <select id="role" name="role" defaultValue="operations">
            <option value="operations">Operations</option>
            <option value="user">User — read only</option>
            <option value="super_admin">Super Admin</option>
          </select>
        </div>
        <div className="md:col-span-4">
          <SubmitButton pendingText="Creating…">Create account</SubmitButton>
        </div>
      </form>
    </div>
  );
}
