'use client';
import Link from 'next/link';

/** The invisible, stretched link that makes a whole table row clickable.
 *  It explicitly announces the navigation itself rather than relying on
 *  NavProgress's generic "was an <a> clicked" detector, which may or may
 *  not reliably catch a click landing on a content-less, absolutely
 *  positioned anchor spanning a <tr> instead of a normal visible link. */
export default function RowLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="absolute inset-0" style={{ zIndex: 1 }} aria-label={label}
          onClick={() => window.dispatchEvent(new Event('app:navigating'))} />
  );
}
