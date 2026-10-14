'use client';
import { useActionState } from 'react';
import { createRfq, type FormState } from '../actions';
import SubmitButton from '@/app/SubmitButton';

export default function CreateRfqForm({ requirements }: { requirements: { id: string; title: string }[] }) {
  const [state, action] = useActionState<FormState, FormData>(createRfq, {});

  if (!requirements.length) {
    return <p className="text-[13px]" style={{ color: 'var(--faint)' }}>No open requirements yet — add one first.</p>;
  }

  return (
    <form action={action} className="grid md:grid-cols-3 gap-4 items-end">
      {state.error && <div className="note r mb-2 md:col-span-3">{state.error}</div>}
      <div>
        <label className="lab" htmlFor="requirement_id">Requirement</label>
        <select id="requirement_id" name="requirement_id" required>
          <option value="">Select…</option>
          {requirements.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
      </div>
      <div>
        <label className="lab" htmlFor="title">RFQ title</label>
        <input id="title" name="title" required placeholder="e.g. RFQ — PET scrap, NCR, Nov batch" />
      </div>
      <SubmitButton pendingText="Creating…">Create RFQ</SubmitButton>
    </form>
  );
}
