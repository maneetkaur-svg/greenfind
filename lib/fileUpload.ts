/** Shared between documentActions.ts (server) and every file-picker client
 *  component, so the client-side check and the server-side one can never
 *  drift apart. The client-side check is the one that actually matters for
 *  avoiding a crash: on Vercel, every Server Action runs as a Vercel
 *  Function, and Vercel enforces a hard 4.5 MB request-body ceiling at the
 *  platform/infrastructure level -- before Next.js's own code, and before
 *  this app's next.config.ts bodySizeLimit, ever get a chance to run. It is
 *  not configurable on any plan. A file over it comes back as a raw 413
 *  from Vercel's edge, which Next's Server Action client sees as a
 *  malformed response and surfaces as a hard, generic "Something went
 *  wrong" page -- not a clear message, and not something uploadDocument's
 *  own (graceful) size check ever gets a chance to catch, because the
 *  request never reaches it. This cap is set comfortably under that 4.5 MB
 *  ceiling, with headroom for multipart overhead and the form's other
 *  fields, so an oversized file is always caught here, before the form
 *  ever submits, instead of hitting that wall. See:
 *  https://vercel.com/docs/concepts/solutions/file-storage (request body
 *  limits) -- a multi-page scanned CTO, EPR or NDA certificate is exactly
 *  the kind of file that routinely exceeds it. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const OK_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export function fileValidationError(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) {
    return `${file.name} is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MAX_FILE_BYTES / 1048576} MB.`;
  }
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (!OK_FILE_TYPES.includes(file.type) && !['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) {
    return 'Only PDF, JPG and PNG are accepted.';
  }
  return null;
}
