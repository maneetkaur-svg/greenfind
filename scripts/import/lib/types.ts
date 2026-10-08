export type ParsedDocCell = { url: string | null; displayText: string };

export type ParsedRow = {
  excelRow: number;
  vendorCode: string;
  legalName: string;
  pan: string;
  gstin: string;
  isMsme: boolean | null;
  docs: Record<string, ParsedDocCell>;
};
