'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** A plain text search box rather than a checklist — primary-contact names
 *  are numerous and free-typed, not a short fixed list like Source or
 *  Industry, so a checklist of hundreds of names would not be usable. */
export default function PocSearch({
  value, industry, source, tier,
}: { value?: string; industry?: string; source?: string; tier?: string }) {
  const router = useRouter();
  const [text, setText] = useState(value ?? '');

  const apply = () => {
    const params = new URLSearchParams();
    if (industry) params.set('industry', industry);
    if (source) params.set('source', source);
    if (tier) params.set('tier', tier);
    if (text.trim()) params.set('poc', text.trim());
    router.push(`/analytics?${params.toString()}`);
  };

  return (
    <input
      value={text}
      onChange={e => setText(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') apply(); }}
      onBlur={apply}
      placeholder="Search by contact name…"
      style={{ minWidth: 220 }}
    />
  );
}
