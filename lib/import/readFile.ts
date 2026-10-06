import * as XLSX from 'xlsx';

export type Sheet = { name: string; rows: unknown[][] };   // rows[0] is the header row
export type ReadResult = { sheets: Sheet[]; defaultSheet: number };

const isEmptyRow = (r: unknown[]) => r.every(c => c === '' || c === null || c === undefined || String(c).trim() === '');

/** Reads .xlsx, .xls, .csv and .json into plain rows. Runs in the browser:
 *  the file is never uploaded anywhere. Only the checked, cleaned rows are
 *  sent to the server. Blank rows are dropped but remember their original
 *  position, so "row 14" in a report is row 14 in the spreadsheet. */
export function readFile(name: string, buf: ArrayBuffer): ReadResult {
  const lower = name.toLowerCase();

  if (lower.endsWith('.json')) {
    const text = new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, '');
    let data: unknown = JSON.parse(text);
    if (!Array.isArray(data) && data && typeof data === 'object') {
      // {"vendors":[...]} or {"Vendors":[...], "Contacts":[...]} — take the first array of objects
      const first = Object.values(data as Record<string, unknown>).find(v => Array.isArray(v));
      if (first) data = first;
    }
    if (!Array.isArray(data)) throw new Error('The JSON file should be a list of vendor records.');
    const objs = data.filter(x => x && typeof x === 'object') as Record<string, unknown>[];
    if (!objs.length) throw new Error('The JSON file has no records in it.');
    const headers: string[] = [];
    for (const o of objs) for (const k of Object.keys(o)) if (!headers.includes(k)) headers.push(k);
    const rows = [headers, ...objs.map(o => headers.map(h => {
      const v = o[h]; return Array.isArray(v) ? v.join('; ') : v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : v;
    }))];
    return { sheets: [{ name: 'JSON', rows }], defaultSheet: 0 };
  }

  if (!/\.(xlsx|xls|csv)$/.test(lower)) throw new Error('Use an .xlsx, .xls, .csv or .json file.');

  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheets: Sheet[] = wb.SheetNames.map(n => ({
    name: n,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: true, defval: '', blankrows: true }),
  })).filter(s => s.rows.some(r => !isEmptyRow(r)));
  if (!sheets.length) throw new Error('That file has no data in it.');

  // The template has three sheets; the data is on "Vendor data".
  const idx = sheets.findIndex(s => s.name.toLowerCase() === 'vendor data');
  return { sheets, defaultSheet: idx >= 0 ? idx : 0 };
}

/** Header row = first non-empty row. Returns data rows with their spreadsheet row number. */
export function splitSheet(rows: unknown[][]): { headers: unknown[]; data: { rowNumber: number; cells: unknown[] }[] } {
  const h = rows.findIndex(r => !isEmptyRow(r));
  if (h < 0) return { headers: [], data: [] };
  const data = rows.slice(h + 1).map((cells, i) => ({ rowNumber: h + i + 2, cells }))
    .filter(r => !isEmptyRow(r.cells));
  return { headers: rows[h], data };
}
