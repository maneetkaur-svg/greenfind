import fs from 'node:fs';

function toCsv(rows: string[][]): string {
  return '\uFEFF' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
}

export type ReportRow = {
  vendorCode: string;
  excelRow: number;
  docType: string;
  status: string;
  errorCode: string;
  httpStatus: string;
  sha256: string;
  storagePath: string;
};

export function writeReportCsv(path: string, rows: ReportRow[]): void {
  const header = ['Vendor Code', 'Excel Row', 'Document Type', 'Status', 'Error Code', 'HTTP Status', 'SHA-256', 'Storage Path'];
  const body = rows.map(r => [r.vendorCode, String(r.excelRow), r.docType, r.status, r.errorCode, r.httpStatus, r.sha256, r.storagePath]);
  fs.writeFileSync(path, toCsv([header, ...body]));
}

export type ReviewRow = { excelRow: number; vendorCode: string; vendorName: string; reason: string; detail: string };

export function writeReviewCsv(path: string, rows: ReviewRow[]): void {
  const header = ['Excel Row', 'Vendor Code', 'Vendor Name', 'Reason', 'Detail'];
  const body = rows.map(r => [String(r.excelRow), r.vendorCode, r.vendorName, r.reason, r.detail]);
  fs.writeFileSync(path, toCsv([header, ...body]));
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Reads a previous report.csv and returns just the (vendorCode, excelRow,
 *  docType) of rows that were FAILED, for --retry-failed. */
export function readPreviousFailed(path: string): { vendorCode: string; excelRow: number; docType: string }[] {
  if (!fs.existsSync(path)) return [];
  const text = fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const out: { vendorCode: string; excelRow: number; docType: string }[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    if (cells.length < 4) continue;
    const [vendorCode, excelRowStr, docType, status] = cells;
    if (status === 'FAILED') out.push({ vendorCode, excelRow: Number(excelRowStr), docType });
  }
  return out;
}
