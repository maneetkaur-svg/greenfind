export type DetectedType = 'pdf' | 'jpg' | 'png';

export const MIME_FOR_TYPE: Record<DetectedType, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png',
};
export const EXT_FOR_TYPE: Record<DetectedType, string> = { pdf: 'pdf', jpg: 'jpg', png: 'png' };

/** Looks at the bytes, never the file extension, the Content-Type header or
 *  the HTTP status — an error page served with a 200 and a .pdf-looking URL
 *  is still rejected. Matches the three types the vendor-documents bucket
 *  actually allows. */
export function detectFileType(buf: Buffer): DetectedType | null {
  if (buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d)
    return 'pdf'; // %PDF-
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return 'jpg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  )
    return 'png';
  return null;
}
