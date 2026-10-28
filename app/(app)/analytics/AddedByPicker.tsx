'use client';
import { useRouter } from 'next/navigation';

/** A plain <select> of who added each vendor — a staff name (Rahul, Madhu,
 *  Biswajeet, Maneet, ...) from vendor_site.created_by, or "External" for
 *  anything with no staff attribution (a public sign-up, or an old bulk
 *  import nobody owns). Deliberately its own lookup, not folded into the
 *  industry/source/status tile filters above — picking one just answers a
 *  single question (how many vendors did this person bring in), independent
 *  of whatever else is filtered. */
export default function AddedByPicker({ value, options }: { value?: string; options: string[] }) {
  const router = useRouter();

  return (
    <select
      value={value ?? ''}
      onChange={e => router.push(e.target.value ? `/analytics?addedBy=${encodeURIComponent(e.target.value)}` : '/analytics')}
    >
      <option value="">Select…</option>
      {options.map(name => <option key={name} value={name}>{name}</option>)}
    </select>
  );
}
