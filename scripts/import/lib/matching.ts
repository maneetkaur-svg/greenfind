import type { ParsedRow } from './types';

export type MatchedSite = {
  id: string;
  siteCode: string;
  gstin: string | null;
  companyId: string;
  companyLegalName: string;
  companyPan: string;
};

/** Compares what the sheet says against the vendor_site/company already on
 *  record for the matched Vendor Code. Returns a reason string the moment
 *  something looks like a different vendor wearing the same code — never
 *  guessed past, only reported so a person can decide. */
export function detectConflict(row: ParsedRow, site: MatchedSite): string | null {
  const sheetPan = row.pan.toUpperCase().replace(/[\s-]/g, '');
  const sheetGstin = row.gstin.toUpperCase().replace(/[\s-]/g, '');

  if (sheetPan && site.companyPan && sheetPan !== site.companyPan)
    return `Sheet PAN ${sheetPan} does not match the PAN on record (${site.companyPan}) for this Vendor Code.`;

  if (sheetGstin && site.gstin && sheetGstin !== site.gstin)
    return `Sheet GSTIN ${sheetGstin} does not match the GSTIN on record (${site.gstin}) for this Vendor Code.`;

  if (row.legalName && site.companyLegalName) {
    const a = row.legalName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const b = site.companyLegalName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (a && b && a !== b && !a.includes(b) && !b.includes(a))
      return `Sheet vendor name "${row.legalName}" does not resemble the name on record ("${site.companyLegalName}").`;
  }

  return null;
}
