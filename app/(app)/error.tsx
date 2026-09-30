'use client';
import { useEffect } from 'react';
import Link from 'next/link';

/** Shown instead of the blank "server-side exception" page.
 *  Whatever went wrong, you get the message and a way back. */
export default function Error({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <div className="card p-7 max-w-[640px] mx-auto mt-10">
      <h1 className="text-[19px] font-bold mb-2">Something went wrong on this page</h1>
      <p className="text-[13.5px] mb-4" style={{ color: 'var(--muted)' }}>
        Nothing you entered has been lost. The message below is the useful part.
      </p>

      <pre className="text-[12px] p-3 rounded-lg overflow-x-auto whitespace-pre-wrap"
           style={{ background: 'var(--surface-2)', border: '1px solid var(--line)',
                    color: 'var(--head)' }}>
        {error.message || 'No message was returned.'}
        {error.digest && `\n\nReference: ${error.digest}`}
      </pre>

      <div className="flex gap-3 mt-5 flex-wrap">
        <button className="btn btn-p" onClick={reset}>Try again</button>
        <Link href="/vendors" className="btn btn-o">Back to the vendor list</Link>
      </div>
    </div>
  );
}
