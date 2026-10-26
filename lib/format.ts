/** GreenFind is an Indian operation — timestamps shown anywhere in the app
 *  should read in IST, regardless of what timezone the rendering server
 *  happens to be in. Date.prototype.toLocaleString() with no explicit
 *  timeZone uses the *runtime's* zone, not the viewer's — on a Next.js
 *  Server Component that's Vercel's Node runtime, which defaults to UTC,
 *  so every timestamp silently rendered 5.5 hours early. Pinning the zone
 *  here makes it correct regardless of where this actually executes. */
const IST = 'Asia/Kolkata';

export function formatDateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString('en-IN', { timeZone: IST, dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-IN', { timeZone: IST, dateStyle: 'medium' });
}

/** YYYY-MM-DD for the given instant's IST calendar day — for grouping
 *  events by day correctly. Slicing a UTC ISO string's first 10 characters
 *  (the obvious-looking shortcut) gives the UTC calendar day instead, which
 *  is wrong by a day for anything in the ~5.5-hour band where the two
 *  disagree (e.g. a 2am IST login is still "yesterday" in UTC). */
export function istDateKey(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: IST });
}
