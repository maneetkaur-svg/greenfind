'use client';
import { useFormStatus } from 'react-dom';

/** A submit button that disables itself and shows a spinner the instant its
 *  form starts submitting — works whether the form uses useActionState or a
 *  plain `action={serverAction}` prop, because useFormStatus reads the
 *  nearest enclosing <form>, not a prop passed down from the caller. One
 *  component instead of each form re-wiring its own `disabled={pending}`,
 *  so a slow deployment can't be clicked ten times before it responds. */
export default function SubmitButton({
  children, pendingText, className = 'btn btn-p', style,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} style={style} disabled={pending} aria-busy={pending}>
      {pending && <span className="spinner" aria-hidden="true" />}
      {pending ? (pendingText ?? 'Working…') : children}
    </button>
  );
}
