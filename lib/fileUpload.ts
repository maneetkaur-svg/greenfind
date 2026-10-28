/** Shared between every file-picker across the app, so the client-side
 *  check and whatever actually enforces a limit downstream can never drift
 *  apart. Two different ceilings exist because two different transports do:
 *
 *  MAX_FILE_BYTES (4MB) -- for anything that still goes to the server as
 *  part of a Server Action's own request body (the RFQ purchase order's
 *  signed-copy upload is the one remaining example). On Vercel, every
 *  Server Action runs as a Vercel Function, and Vercel enforces a hard,
 *  non-configurable 4.5MB request-body ceiling at the platform level --
 *  ahead of this app's own code, and ahead of next.config.ts's own
 *  bodySizeLimit setting. A file over it never reaches this app at all; it
 *  comes back as a raw 413 from Vercel's edge, which surfaces as a hard,
 *  generic "Something went wrong" page, not a clear message. This cap
 *  stays safely under that wall, with headroom for multipart overhead.
 *
 *  MAX_FILE_BYTES_DIRECT (10MB) -- for every vendor-document upload (the
 *  Documents tab, the NDA panel, every inline upload, the Add Vendor
 *  wizard, and both public onboarding forms). These upload the file
 *  straight from the browser to Supabase Storage first, then make a
 *  second, tiny, metadata-only call to record it -- the file itself never
 *  sits in a Server Action's request body, so Vercel's 4.5MB wall never
 *  applies. The only remaining ceiling is the vendor-documents Storage
 *  bucket's own file_size_limit (sql/02_security.sql), which is 10MB. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_FILE_BYTES_DIRECT = 10 * 1024 * 1024;
export const OK_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export function fileValidationError(file: File, maxBytes: number = MAX_FILE_BYTES): string | null {
  if (file.size > maxBytes) {
    return `${file.name} is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${maxBytes / 1048576} MB.`;
  }
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (!OK_FILE_TYPES.includes(file.type) && !['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) {
    return 'Only PDF, JPG and PNG are accepted.';
  }
  return null;
}
