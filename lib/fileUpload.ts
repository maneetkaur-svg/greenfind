/** Shared between documentActions.ts (server) and every file-picker client
 *  component, so the client-side check and the server-side one can never
 *  drift apart. The client-side check is the one that actually matters for
 *  avoiding a crash: a file this big arriving as a Server Action's request
 *  body is rejected by Next's own body-size limit before uploadDocument's
 *  own (graceful) size check ever runs -- that shows up to the user as a
 *  hard "Something went wrong" error page, not a clear message. Catching
 *  an oversized file here, before the form ever submits, avoids hitting
 *  that limit at all -- a multi-page scanned CTO or EPR certificate is
 *  exactly the kind of file that routinely exceeds it. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const OK_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export function fileValidationError(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) {
    return `${file.name} is ${(file.size / 1048576).toFixed(1)} MB. The limit is 10 MB.`;
  }
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (!OK_FILE_TYPES.includes(file.type) && !['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) {
    return 'Only PDF, JPG and PNG are accepted.';
  }
  return null;
}
