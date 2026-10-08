import { createHash } from 'node:crypto';
import { assertPublicHttpUrl } from './ssrf';
import { detectFileType, MIME_FOR_TYPE, type DetectedType } from './magicBytes';
import { ImportDocError } from './errors';

export type DownloadResult = {
  buffer: Buffer;
  sha256: string;
  httpStatus: number;
  fileType: DetectedType;
  contentType: string;
};

const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

async function readBodyWithLimit(res: Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ImportDocError('TOO_LARGE', `Response exceeded ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Downloads a document URL safely: validates scheme/host — and re-validates
 *  on every redirect hop, so a redirect can't be used to reach a private
 *  address — times out at 30s, caps redirects at 5 and size at 10MB, and
 *  classifies the file by its magic bytes rather than trusting the
 *  extension, Content-Type header or HTTP status. */
export async function downloadDocument(rawUrl: string): Promise<DownloadResult> {
  let currentUrl = rawUrl;
  let lastStatus = 0;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = await assertPublicHttpUrl(currentUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(target, { redirect: 'manual', signal: controller.signal });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError')
        throw new ImportDocError('TIMEOUT', `Timed out after ${TIMEOUT_MS}ms`);
      throw new ImportDocError('NETWORK_ERROR', e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
    lastStatus = res.status;

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new ImportDocError('HTTP_ERROR', 'Redirect with no Location header', res.status);
      if (hop === MAX_REDIRECTS) throw new ImportDocError('TOO_MANY_REDIRECTS', `More than ${MAX_REDIRECTS} redirects`, res.status);
      currentUrl = new URL(location, target).toString();
      continue;
    }

    if (!res.ok) throw new ImportDocError('HTTP_ERROR', `HTTP ${res.status}`, res.status);

    const buffer = await readBodyWithLimit(res, MAX_BYTES);
    const fileType = detectFileType(buffer);
    if (!fileType)
      throw new ImportDocError('BAD_FILE_TYPE', 'File content is not a PDF, JPG or PNG (checked by content, not extension)', lastStatus);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    return { buffer, sha256, httpStatus: lastStatus, fileType, contentType: MIME_FOR_TYPE[fileType] };
  }

  throw new ImportDocError('TOO_MANY_REDIRECTS', `More than ${MAX_REDIRECTS} redirects`, lastStatus);
}

/** Never logs or reports the URL itself — only its shape, with the query
 *  string (where a signed link's token lives) redacted. */
export function redactUrlForLogging(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.host}${u.pathname}${u.search ? '?[redacted]' : ''}`;
  } catch {
    return '[unparseable url]';
  }
}
