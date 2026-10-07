import * as XLSX from 'xlsx';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { IMPORT_FIELDS, COMPUTED_COLUMNS, type ImportField } from './fields';

const TYPE_LABEL: Record<string, string> = {
  text: 'Text', longtext: 'Text', number: 'Number', currency: 'Number (rupees)', bool: 'Yes / No',
  date: 'Date', enum: 'Pick one', gstin: 'Text, 15 characters', pan: 'Text, 10 characters',
  ifsc: 'Text, 11 characters', mobile: 'Text, 10 digits', email: 'Email', pincode: 'Text, 6 digits', list: 'List',
  status: 'Pick one', credit: 'Days, or words', docref: 'Link or file name',
};

/** A template and an export must agree on headers. Both read IMPORT_FIELDS. */
export const templateHeaders = () => IMPORT_FIELDS.map(f => f.header);

const TEXT_ROWS = 1000;   // how many rows below the header are pre-formatted as Text

export function buildTemplate(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // ---- Sheet 1: Vendor data — headers only, top row frozen ----
  const headers = templateHeaders();
  const ws1 = XLSX.utils.aoa_to_sheet([headers]);
  // Pre-format the columns Excel would otherwise mangle as Text, so a pincode
  // of 301707 or an account number stays exactly what was typed.
  IMPORT_FIELDS.forEach((f, c) => {
    if (!f.excelText) return;
    for (let r = 1; r <= TEXT_ROWS; r++)
      ws1[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: '', z: '@' };
  });
  ws1['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: TEXT_ROWS, c: headers.length - 1 } });
  ws1['!cols'] = headers.map(h => ({ wch: Math.max(14, h.length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws1, 'Vendor data');

  // ---- Sheet 2: How to fill ----
  const how: string[][] = [['Column', 'Required', 'Type', 'Allowed values', 'Example', 'Notes']];
  for (const f of IMPORT_FIELDS) how.push([
    f.header, f.required ? 'Yes' : 'No', TYPE_LABEL[f.type] ?? f.type, f.allowed ?? '', f.example,
    [f.note, f.excelText ? 'Format this column as Text in Excel, or leading zeros and long numbers are lost.' : ''].filter(Boolean).join(' '),
  ]);
  how.push([], ['Not importable — these appear in an export and are ignored if present'], ['Column', 'Why']);
  for (const c of COMPUTED_COLUMNS) how.push([c.header, c.why]);
  how.push([], ['How rows are handled'],
    ['One row is one site (one plant). Rows whose GSTINs share the same PAN (characters 3 to 12) become one company with several sites.'],
    ['Company details for a PAN come from the first row; later rows only fill blanks. If the company is already on record, its details are left alone and the new sites attach to it.'],
    ['A row with a bad optional value (IFSC, mobile, email, year) still imports; the bad value is left blank and reported.'],
    ['A row the database cannot store (GSTIN, pincode, address, city, state, industry or legal name missing or invalid) is held back and listed with its row number.'],
    ['Service categories are not part of the import. Add them on each vendor record afterwards.']);
  const ws2 = XLSX.utils.aoa_to_sheet(how);
  ws2['!cols'] = [{ wch: 30 }, { wch: 10 }, { wch: 22 }, { wch: 46 }, { wch: 28 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'How to fill');

  // ---- Sheet 3: Example — two rows, the second deliberately scruffy ----
  const tidy: Record<string, string> = {};
  for (const f of IMPORT_FIELDS) tidy[f.key] = f.example;
  const scruffy: Record<string, string> = {
    ...Object.fromEntries(IMPORT_FIELDS.map(f => [f.key, ''])),
    legal_name: 'RAJ PACKAGING PVT LTD', gstin: '27abcde1234f1z5', industry: 'Packing', entity: 'pvt ltd',
    cin: 'U21000MH2012PTC123456', is_msme: 'Y', msme_category: 'small', udyam_number: 'UDYAM-MH-19-0012345',
    year_established: '2012', turnover_current: '₹1,25,00,000', turnover_previous: '98,00,000', address_line1: 'Gat 44, MIDC Chakan',
    city: 'Pune', state: 'maharashtra', pincode: '410501', geography: 'West; Pan India', contact1_name: 'Anil Rao',
    contact1_mobile: '+91 98765-43210', contact1_email: 'anil@example.com', contact2_name: 'Meera Shah', contact2_mobile: '09123456780',
    bank_account_number: '50200012345678', ifsc: 'hdfc0000432', cheque_on_file: '✓',
    legacy_code: 'V-0107', services_text: 'Corrugated boxes and packing', credit_period: '1 month', status: ' ONBOARDED ', created_date: '12/04/2025',
    doc_pan: 'Yes', doc_cheque: 'cheque-raj.pdf',
  };
  const ws3 = XLSX.utils.aoa_to_sheet([
    headers, IMPORT_FIELDS.map((f: ImportField) => tidy[f.key]), IMPORT_FIELDS.map((f: ImportField) => scruffy[f.key]),
    [],
    ['Row 3 is deliberately untidy to show what is cleaned up: "Packing" becomes Packaging, "pvt ltd" becomes Private Limited, "Y" and "✓" become Yes, ' +
     '"₹1,25,00,000" becomes a number, "+91 98765-43210" becomes 9876543210, lower-case GSTIN and IFSC are upper-cased, "1 month" becomes 30 days, "ONBOARDED" becomes Active, and 12/04/2025 is read as 12 April. Do not leave the Example sheet selected when you import.'],
  ]);
  ws3['!cols'] = headers.map(h => ({ wch: Math.max(16, h.length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws3, 'Example');

  return wb;
}

/** The free edition of SheetJS cannot write a frozen header row, so the saved
 *  file is opened, the pane added to the first sheet's XML, and re-zipped. */
export function templateBytes(): Uint8Array {
  const raw = XLSX.write(buildTemplate(), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const files = unzipSync(new Uint8Array(raw));
  const key = 'xl/worksheets/sheet1.xml';
  const xml = strFromU8(files[key]);
  const frozen = '<sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>';
  files[key] = strToU8(xml.replace('<sheetView workbookViewId="0"/>', frozen));
  return zipSync(files);
}

export function downloadTemplate() {
  const blob = new Blob([templateBytes() as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'greenfind-vendor-import-template.xlsx';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
