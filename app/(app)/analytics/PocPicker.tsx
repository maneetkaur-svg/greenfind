'use client';
import { useRouter } from 'next/navigation';

/** A plain <select> of every distinct primary-contact name on record —
 *  deliberately its own lookup, not combined with the industry/source/tier
 *  tile filters above. Picking a name just answers one question (how many
 *  vendors is this person the contact for), so it keeps its own url param
 *  instead of folding into the others. */
export default function PocPicker({ value, options }: { value?: string; options: string[] }) {
  const router = useRouter();

  return (
    <select
      value={value ?? ''}
      onChange={e => router.push(e.target.value ? `/analytics?poc=${encodeURIComponent(e.target.value)}` : '/analytics')}
    >
      <option value="">Select a contact…</option>
      {options.map(name => <option key={name} value={name}>{name}</option>)}
    </select>
  );
}
