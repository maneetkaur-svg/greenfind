'use client';
import { closeRequirement } from '../actions';
import SubmitButton from '@/app/SubmitButton';

export default function CloseRequirementButton({ id }: { id: string }) {
  return (
    <form action={closeRequirement}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton className="btn btn-o" pendingText="Closing…" style={{ padding: '6px 12px', fontSize: 13 }}>
        Close
      </SubmitButton>
    </form>
  );
}
