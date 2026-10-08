import ExcelJS from 'exceljs';

export type SheetRow = { rowNumber: number; cells: string[]; hyperlinks: (string | null)[] };
export type SheetData = { headers: string[]; rows: SheetRow[]; sheetName: string; sheetNames: string[] };

/** The real target of a hyperlink cell, never the displayed "Open Link" text.
 *  ExcelJS represents every hyperlink — whether typed in by hand or parsed
 *  from a real .xlsx's hyperlink relationships — as a {text, hyperlink}
 *  cell value; cell.hyperlink is a read-only mirror of the same thing. */
export function extractHyperlink(cell: ExcelJS.Cell): { url: string | null; displayText: string } {
  const v = cell.value as unknown;
  if (v && typeof v === 'object' && 'hyperlink' in (v as Record<string, unknown>)) {
    const obj = v as { text?: unknown; hyperlink?: unknown };
    const url = typeof obj.hyperlink === 'string' && obj.hyperlink ? obj.hyperlink : null;
    const displayText = obj.text == null ? '' : String(obj.text);
    return { url, displayText };
  }
  if (cell.hyperlink) {
    const displayText = cell.text ?? (v == null ? '' : String(v));
    return { url: String(cell.hyperlink), displayText };
  }
  const displayText = (cell.text ?? (v == null ? '' : String(v))).trim();
  if (/^https?:\/\//i.test(displayText)) return { url: displayText, displayText };
  return { url: null, displayText };
}

/** Reads the sheet into plain rows, keeping each row's real Excel row number
 *  (exceljs gives it directly — nothing to recompute). Fully blank rows,
 *  leading or in the middle of the data, are skipped. */
export async function readWorkbook(filePath: string, preferredSheetName?: string): Promise<SheetData> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheetNames = wb.worksheets.map(w => w.name);

  const ws = preferredSheetName
    ? wb.worksheets.find(w => w.name.toLowerCase() === preferredSheetName.toLowerCase())
    : (wb.worksheets.find(w => w.name.toLowerCase() === 'vendor data') ?? wb.worksheets[0]);

  if (!ws) {
    throw new Error(
      `No usable worksheet found${preferredSheetName ? ` named "${preferredSheetName}"` : ''}. ` +
      `Sheets in file: ${sheetNames.join(', ') || '(none)'}`
    );
  }

  const rows: SheetRow[] = [];
  let headers: string[] = [];
  let sawHeader = false;

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    const hyperlinks: (string | null)[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const { url, displayText } = extractHyperlink(cell);
      cells[colNumber - 1] = displayText.trim();
      hyperlinks[colNumber - 1] = url;
    });

    if (!sawHeader) {
      if (cells.every(c => !c)) return; // skip leading blank rows
      headers = cells;
      sawHeader = true;
      return;
    }
    if (cells.every(c => !c)) return; // skip fully blank data rows
    rows.push({ rowNumber, cells, hyperlinks });
  });

  return { headers, rows, sheetName: ws.name, sheetNames };
}
