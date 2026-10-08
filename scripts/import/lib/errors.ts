export type ErrorCode =
  | 'SSRF_BLOCKED' | 'TIMEOUT' | 'TOO_MANY_REDIRECTS' | 'HTTP_ERROR' | 'TOO_LARGE'
  | 'BAD_FILE_TYPE' | 'NETWORK_ERROR' | 'UPLOAD_FAILED' | 'DB_INSERT_FAILED'
  | 'NO_MATCH' | 'AMBIGUOUS_MATCH' | 'CONFLICT' | 'MISSING_VENDOR_CODE' | 'DUPLICATE_VENDOR_CODE_IN_FILE'
  | 'DOC_TYPE_NOT_CONFIGURED';

export class ImportDocError extends Error {
  code: ErrorCode;
  httpStatus: number | null;
  constructor(code: ErrorCode, message: string, httpStatus: number | null = null) {
    super(message);
    this.name = 'ImportDocError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** Only these are worth one automatic retry. A bad scheme, an SSRF block, a
 *  4xx, or content that isn't actually a PDF/JPG/PNG is a permanent failure
 *  that retrying cannot fix. */
export function isTransient(code: ErrorCode, httpStatus: number | null): boolean {
  if (code === 'TIMEOUT' || code === 'NETWORK_ERROR' || code === 'UPLOAD_FAILED' || code === 'DB_INSERT_FAILED') return true;
  if (code === 'HTTP_ERROR' && httpStatus !== null && httpStatus >= 500) return true;
  return false;
}
