'use client';
import { useActionState } from 'react';
import { createFirstAdmin, type SetupState } from './actions';
import SubmitButton from '@/app/SubmitButton';

export default function SetupPage() {
  const [state, action] = useActionState<SetupState, FormData>(createFirstAdmin, {});

  return (
    <div className="min-h-screen grid place-items-center p-5">
      <div className="card w-full max-w-[440px] p-7">
        <h1 className="text-[20px] font-bold mb-1">Create the first account</h1>
        <p className="text-[13.5px] mb-5" style={{ color: 'var(--faint)' }}>
          This page works once. The account it creates is a Super Admin, and after
          that everyone else is added from inside the app.
        </p>

        {state.error && <div className="note r mb-4">{state.error}</div>}

        <form action={action} className="space-y-4">
          <div>
            <label className="lab" htmlFor="full_name">Your name</label>
            <input id="full_name" name="full_name" required autoComplete="name" />
          </div>
          <div>
            <label className="lab" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div>
            <label className="lab" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required
                   minLength={8} autoComplete="new-password" />
            <div className="hint">At least 8 characters. Write it down.</div>
          </div>
          <div>
            <label className="lab" htmlFor="confirm">Confirm password</label>
            <input id="confirm" name="confirm" type="password" required
                   minLength={8} autoComplete="new-password" />
          </div>
          <SubmitButton className="btn btn-p w-full justify-center" pendingText="Creating…">
            Create account and sign in
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
