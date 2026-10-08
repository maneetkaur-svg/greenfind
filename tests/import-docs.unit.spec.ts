import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { extractHyperlink } from '../scripts/import/lib/excel';
import { matchColumns, findMissingRequiredColumns, DOC_COLUMN_TO_TYPE, DOC_COLUMN_KEYS } from '../scripts/import/lib/columns';
import { decideBlankStatus } from '../scripts/import/lib/docStatus';
import { isPrivateIPv4, isPrivateIPv6, assertPublicHttpUrl, SsrfBlockedError } from '../scripts/import/lib/ssrf';
import { detectFileType } from '../scripts/import/lib/magicBytes';
import { isTransient, ImportDocError } from '../scripts/import/lib/errors';
import { redactUrlForLogging } from '../scripts/import/lib/download';
import { assertNotProd, ImportEnvError } from '../scripts/import/lib/env';
import { detectConflict } from '../scripts/import/lib/matching';
import type { ParsedRow } from '../scripts/import/lib/types';

test.describe('hyperlink extraction', () => {
  test('reads the real URL from a {text, hyperlink} cell, not the display text', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.getCell('A1').value = { text: 'Open Link', hyperlink: 'https://example.com/cert.pdf' };
    const { url, displayText } = extractHyperlink(ws.getCell('A1'));
    expect(url).toBe('https://example.com/cert.pdf');
    expect(displayText).toBe('Open Link');
  });

  test('a plain URL typed as text (no real hyperlink relationship) is still recognised', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.getCell('A1').value = 'https://example.com/plain.pdf';
    const { url } = extractHyperlink(ws.getCell('A1'));
    expect(url).toBe('https://example.com/plain.pdf');
  });

  test('plain text with no link gives a null URL, not the text mistaken for one', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.getCell('A1').value = 'No';
    const { url, displayText } = extractHyperlink(ws.getCell('A1'));
    expect(url).toBeNull();
    expect(displayText).toBe('No');
  });

  test('a blank cell gives a null URL and empty text', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    const { url, displayText } = extractHyperlink(ws.getCell('A1'));
    expect(url).toBeNull();
    expect(displayText).toBe('');
  });
});

test.describe('blank-link handling', () => {
  test('a blank MSME document is NOT_APPLICABLE when MSME is No', () => {
    expect(decideBlankStatus('doc_msme', false)).toBe('NOT_APPLICABLE');
  });
  test('a blank MSME document is MISSING when MSME is Yes', () => {
    expect(decideBlankStatus('doc_msme', true)).toBe('MISSING');
  });
  test('a blank MSME document is MISSING when MSME is unclear, never guessed as not applicable', () => {
    expect(decideBlankStatus('doc_msme', null)).toBe('MISSING');
  });
  test('every other blank document column is always MISSING, whatever the MSME flag says', () => {
    for (const key of ['doc_gst', 'doc_pan', 'doc_agreement', 'doc_cheque'] as const) {
      expect(decideBlankStatus(key, false)).toBe('MISSING');
      expect(decideBlankStatus(key, true)).toBe('MISSING');
      expect(decideBlankStatus(key, null)).toBe('MISSING');
    }
  });
});

test.describe('doc-type mapping', () => {
  test('the five document columns map to exactly the five document_type codes confirmed on the live data, nothing invented', () => {
    expect(DOC_COLUMN_TO_TYPE).toEqual({
      doc_gst: 'gst', doc_pan: 'pan', doc_agreement: 'nda', doc_cheque: 'cheque', doc_msme: 'udyam',
    });
    expect(DOC_COLUMN_KEYS).toHaveLength(5);
    expect(Object.values(DOC_COLUMN_TO_TYPE)).not.toContain('cto');
    expect(Object.values(DOC_COLUMN_TO_TYPE)).not.toContain('epr');
  });

  test('recognises real-world header spellings', () => {
    const headers = ['Vendor Code', 'Vendor Name', 'MSME', 'GST / Aadhaar Document', 'PAN Document', 'Agreement Document', 'Cancelled Cheque', 'MSME Document'];
    const matches = matchColumns(headers);
    const byKey = Object.fromEntries(matches.map(m => [m.key, m.index]));
    expect(byKey.vendor_code).toBe(0);
    expect(byKey.is_msme).toBe(2);
    expect(byKey.doc_gst).toBe(3);
    expect(byKey.doc_pan).toBe(4);
    expect(byKey.doc_agreement).toBe(5);
    expect(byKey.doc_cheque).toBe(6);
    expect(byKey.doc_msme).toBe(7);
    expect(findMissingRequiredColumns(matches)).toEqual([]);
  });

  test('flags every required column that is missing', () => {
    const matches = matchColumns(['Vendor Code']);
    const missing = findMissingRequiredColumns(matches);
    expect(missing).toEqual(expect.arrayContaining(['is_msme', 'doc_gst', 'doc_pan', 'doc_agreement', 'doc_cheque', 'doc_msme']));
  });
});

test.describe('SSRF / URL checks', () => {
  test('rejects non-http(s) schemes', async () => {
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toThrow(SsrfBlockedError);
    await expect(assertPublicHttpUrl('ftp://example.com/x.pdf')).rejects.toThrow(SsrfBlockedError);
  });

  test('rejects localhost by name, without needing a DNS lookup', async () => {
    await expect(assertPublicHttpUrl('http://localhost/x.pdf')).rejects.toThrow(SsrfBlockedError);
    await expect(assertPublicHttpUrl('http://foo.localhost/x.pdf')).rejects.toThrow(SsrfBlockedError);
  });

  test('rejects loopback and private IPv4 literals', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1/x')).rejects.toThrow(SsrfBlockedError);
    await expect(assertPublicHttpUrl('http://10.1.2.3/x')).rejects.toThrow(SsrfBlockedError);
    await expect(assertPublicHttpUrl('http://192.168.1.1/x')).rejects.toThrow(SsrfBlockedError);
    await expect(assertPublicHttpUrl('http://169.254.1.1/x')).rejects.toThrow(SsrfBlockedError);
  });

  test('rejects loopback IPv6', async () => {
    await expect(assertPublicHttpUrl('http://[::1]/x')).rejects.toThrow(SsrfBlockedError);
  });

  test('classifies private ranges correctly', () => {
    expect(isPrivateIPv4('10.0.0.5')).toBe(true);
    expect(isPrivateIPv4('172.16.5.5')).toBe(true);
    expect(isPrivateIPv4('172.32.0.1')).toBe(false);
    expect(isPrivateIPv4('8.8.8.8')).toBe(false);
    expect(isPrivateIPv6('::1')).toBe(true);
    expect(isPrivateIPv6('fe80::1')).toBe(true);
    expect(isPrivateIPv6('2001:4860:4860::8888')).toBe(false);
  });

  test('redacts the query string but keeps host and path, for safe logging', () => {
    expect(redactUrlForLogging('https://files.example.com/a/b.pdf?token=SECRET&x=1'))
      .toBe('https://files.example.com/a/b.pdf?[redacted]');
    expect(redactUrlForLogging('https://files.example.com/a/b.pdf'))
      .toBe('https://files.example.com/a/b.pdf');
  });
});

test.describe('magic-byte validation', () => {
  test('recognises a PDF by its header bytes, not its name', () => {
    const buf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from([1, 2, 3])]);
    expect(detectFileType(buf)).toBe('pdf');
  });
  test('recognises a JPEG by its header bytes', () => {
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0]))).toBe('jpg');
  });
  test('recognises a PNG by its header bytes', () => {
    expect(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe('png');
  });
  test('rejects an HTML error page even if the URL ended in .pdf', () => {
    expect(detectFileType(Buffer.from('<!DOCTYPE html><html>Not found</html>'))).toBeNull();
  });
  test('rejects an empty buffer', () => {
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });
});

test.describe('SHA-256', () => {
  test('is deterministic and content-sensitive, which is what duplicate detection relies on', () => {
    const a = createHash('sha256').update(Buffer.from('hello')).digest('hex');
    const b = createHash('sha256').update(Buffer.from('hello')).digest('hex');
    const c = createHash('sha256').update(Buffer.from('hello!')).digest('hex');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64);
  });
});

test.describe('error classification', () => {
  test('timeouts and network errors are retried once', () => {
    expect(isTransient('TIMEOUT', null)).toBe(true);
    expect(isTransient('NETWORK_ERROR', null)).toBe(true);
  });
  test('a 5xx is transient, a 4xx is not', () => {
    expect(isTransient('HTTP_ERROR', 503)).toBe(true);
    expect(isTransient('HTTP_ERROR', 500)).toBe(true);
    expect(isTransient('HTTP_ERROR', 404)).toBe(false);
    expect(isTransient('HTTP_ERROR', 403)).toBe(false);
  });
  test('a bad file type or a blocked URL is permanent, never retried', () => {
    expect(isTransient('BAD_FILE_TYPE', null)).toBe(false);
    expect(isTransient('SSRF_BLOCKED', null)).toBe(false);
  });
  test('ImportDocError carries its code and HTTP status for the report', () => {
    const e = new ImportDocError('HTTP_ERROR', 'HTTP 503', 503);
    expect(e.code).toBe('HTTP_ERROR');
    expect(e.httpStatus).toBe(503);
  });
});

test.describe('production guard', () => {
  test('refuses when PROD_SUPABASE_HOST is unset, even without a match, unless --allow-prod', () => {
    expect(() => assertNotProd({ supabaseUrl: 'https://staging-abc.supabase.co', prodHost: null }, false))
      .toThrow(ImportEnvError);
    expect(() => assertNotProd({ supabaseUrl: 'https://staging-abc.supabase.co', prodHost: null }, true))
      .not.toThrow();
  });
  test('refuses when SUPABASE_URL matches the configured production host', () => {
    expect(() => assertNotProd({ supabaseUrl: 'https://prod-xyz.supabase.co', prodHost: 'prod-xyz.supabase.co' }, false))
      .toThrow(ImportEnvError);
  });
  test('allows a staging URL that does not match the configured production host', () => {
    expect(() => assertNotProd({ supabaseUrl: 'https://staging-abc.supabase.co', prodHost: 'prod-xyz.supabase.co' }, false))
      .not.toThrow();
  });
});

test.describe('conflict detection', () => {
  const baseRow: ParsedRow = {
    excelRow: 4, vendorCode: 'VEN-0053', legalName: 'Shree Jageram Industries',
    pan: '', gstin: '', isMsme: null, docs: {},
  };
  const site = {
    id: 's1', siteCode: 'VEN 007-A', gstin: '08AYEPP3943P1ZK',
    companyId: 'c1', companyLegalName: 'Shree Jageram Industries', companyPan: 'AYEPP3943P',
  };

  test('no conflict when the sheet simply leaves PAN/GSTIN/name blank', () => {
    expect(detectConflict(baseRow, site)).toBeNull();
  });
  test('flags a PAN that does not match the company on record', () => {
    const conflict = detectConflict({ ...baseRow, pan: 'ZZZZZ0000Z' }, site);
    expect(conflict).toMatch(/PAN/);
  });
  test('flags a GSTIN that does not match the site on record', () => {
    const conflict = detectConflict({ ...baseRow, gstin: '27AAAAA0000A1Z5' }, site);
    expect(conflict).toMatch(/GSTIN/);
  });
  test('flags a vendor name that does not resemble the name on record', () => {
    const conflict = detectConflict({ ...baseRow, legalName: 'Totally Different Traders' }, site);
    expect(conflict).toMatch(/name/);
  });
  test('does not flag a name that is a superset/subset of the one on record', () => {
    expect(detectConflict({ ...baseRow, legalName: 'Shree Jageram Industries Pvt Ltd' }, site)).toBeNull();
  });
});
