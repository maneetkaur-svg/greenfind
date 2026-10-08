/** One list that drives the importer, the template and the export headers.
 *  If a column is not in here it cannot be imported, and it cannot be exported
 *  as importable — so the two can never drift apart. */

export type ImportType =
  | 'text' | 'longtext' | 'number' | 'currency' | 'bool' | 'date'
  | 'enum' | 'gstin' | 'pan' | 'ifsc' | 'mobile' | 'email' | 'pincode' | 'list'
  | 'status' | 'credit' | 'docref';

export type ImportField = {
  key: string;                       // internal key; also the template header's meaning
  header: string;                    // exact header used in template AND export
  table: 'company' | 'vendor_site' | 'contact' | 'geography';
  type: ImportType;
  required: boolean;
  aliases: string[];                 // what people actually type
  allowed?: string;                  // human text for the How-to-fill sheet
  example: string;
  note?: string;
  /** Excel eats leading zeros / long digits unless the column is Text */
  excelText?: boolean;
};

const contactFields = (n: 1 | 2 | 3, label: string): ImportField[] => {
  const req = n < 3;
  const k = `contact${n}`;
  return [
    { key: `${k}_name`, header: `${label} name`, table: 'contact', type: 'text', required: req,
      aliases: [`${label} name`, `${label} contact`, n === 1 ? 'contact person' : '', n === 1 ? 'contact name' : '',
                n === 1 ? 'contact' : ''].filter(Boolean),
      example: n === 1 ? 'Ramesh Gupta' : n === 2 ? 'Sunita Rao' : '' },
    { key: `${k}_designation`, header: `${label} designation`, table: 'contact', type: 'text', required: false,
      aliases: [`${label} designation`, `${label} title`, n === 1 ? 'designation' : ''].filter(Boolean),
      example: n === 1 ? 'Director' : n === 2 ? 'Plant Head' : '' },
    { key: `${k}_mobile`, header: `${label} mobile`, table: 'contact', type: 'mobile', required: false, excelText: true,
      aliases: [`${label} mobile`, `${label} phone`, `${label} mobile no`, n === 1 ? 'mobile no' : '',
                n === 1 ? 'mobile' : '', n === 1 ? 'phone' : '', n === 1 ? 'contact number' : ''].filter(Boolean),
      allowed: '10 digits starting 6 to 9. +91 and spaces are removed.', example: n === 1 ? '9876543210' : n === 2 ? '9123456780' : '' },
    { key: `${k}_email`, header: `${label} email`, table: 'contact', type: 'email', required: false,
      aliases: [`${label} email`, `${label} e-mail`, `${label} email id`, n === 1 ? 'email' : '',
                n === 1 ? 'email id' : '', n === 1 ? 'e-mail' : ''].filter(Boolean),
      example: n === 1 ? 'ramesh@example.com' : n === 2 ? 'sunita@example.com' : '' },
  ];
};

export const IMPORT_FIELDS: ImportField[] = [
  // ---- company ----
  { key: 'legal_name', header: 'Legal name', table: 'company', type: 'text', required: true,
    aliases: ['legal name', 'company name', 'name of company', 'vendor name', 'name of the company', 'firm name', 'registered name', 'name'],
    note: 'Exactly as on the GST certificate.', example: 'Shree Jageram Industries' },
  { key: 'pan', header: 'PAN', table: 'company', type: 'pan', required: false, excelText: true,
    aliases: ['pan', 'pan no', 'pan number', 'pan card'],
    note: 'Optional. Worked out from the GSTIN when blank. If given it must match the GSTIN.', example: 'AYEPP3943P' },
  { key: 'entity', header: 'Entity type', table: 'company', type: 'enum', required: false,
    aliases: ['entity type', 'entity', 'constitution', 'type of entity', 'company type', 'constitution of business'],
    allowed: 'Proprietorship, Partnership, LLP, LLC, Private Limited, Public Limited, Trust, Foreign',
    example: 'Private Limited' },
  { key: 'cin', header: 'CIN / LLPIN', table: 'company', type: 'text', required: false, excelText: true,
    aliases: ['cin', 'cin / llpin', 'llpin', 'cin no', 'cin number'],
    note: 'Needed for Private Limited, Public Limited and LLP.', example: 'U37200RJ2016PTC054321' },
  { key: 'is_msme', header: 'MSME', table: 'company', type: 'bool', required: false,
    aliases: ['msme', 'msme?', 'is msme', 'msme registered', 'registered as msme', 'registered as an msme'],
    allowed: 'Yes or No (Y, TRUE, 1 also work). A Udyam number in this column is also understood.',
    example: 'Yes' },
  { key: 'msme_category', header: 'MSME category', table: 'company', type: 'enum', required: false,
    aliases: ['msme category', 'enterprise category', 'enterprise type', 'msme type'],
    allowed: 'Micro, Small, Medium', note: 'Only when MSME is Yes.', example: 'Small' },
  { key: 'udyam_number', header: 'Udyam number', table: 'company', type: 'text', required: false, excelText: true,
    aliases: ['udyam number', 'udyam no', 'udyam', 'udyam registration number', 'udyam reg no', 'msme number', 'msme no'],
    note: 'Needed when MSME is Yes.', example: 'UDYAM-RJ-02-0041178' },
  { key: 'year_established', header: 'Year established', table: 'company', type: 'number', required: false,
    aliases: ['year established', 'year of establishment', 'established', 'est year', 'year of incorporation', 'incorporation year', 'established in'],
    allowed: '1900 to the current year', example: '2016' },
  { key: 'website', header: 'Website', table: 'company', type: 'text', required: false,
    aliases: ['website', 'web site', 'url', 'website url', 'web'], example: 'www.jageram.example' },
  { key: 'turnover_current', header: 'Turnover current FY', table: 'company', type: 'currency', required: false,
    aliases: ['turnover current fy', 'turnover', 'annual turnover', 'current turnover', 'turnover current year', 'turnover (current fy)',
              'annual turnover (fy 24-25)', 'annual turnover (current fy)'],
    note: 'Rupees. Commas are removed.', example: '125000000' },
  { key: 'turnover_previous', header: 'Turnover previous FY', table: 'company', type: 'currency', required: false,
    aliases: ['turnover previous fy', 'turnover previous year', 'previous turnover', 'turnover last year', 'turnover (previous fy)',
              'annual turnover (fy 23-24)', 'annual turnover (previous fy)', 'turnover previous'],
    example: '98000000' },
  { key: 'serves_tier1_oem', header: 'Serves Tier-1 OEMs', table: 'company', type: 'bool', required: false,
    aliases: ['serves tier-1 oems', 'serves tier 1 oems', 'tier 1 oem', 'tier-1 oem', 'tier1', 'serves tier1 oem'], example: 'No' },
  { key: 'key_clients', header: 'Key clients', table: 'company', type: 'longtext', required: false,
    aliases: ['key clients', 'major clients', 'clients', 'top clients', 'customers', 'key customers'], example: 'Reliance; Tata; Hindustan Unilever' },
  { key: 'bank_account_name', header: 'Bank account name', table: 'company', type: 'text', required: false,
    aliases: ['bank account name', 'account name', 'account holder', 'account holder name', 'beneficiary name', 'name as per bank'],
    note: 'Should match the legal name.', example: 'Shree Jageram Industries' },
  { key: 'bank_account_number', header: 'Account number', table: 'company', type: 'text', required: false, excelText: true,
    aliases: ['account number', 'bank account number', 'account no', 'bank account no', 'a/c no', 'acc no', 'bank account'],
    example: '50200012345678' },
  { key: 'ifsc', header: 'IFSC', table: 'company', type: 'ifsc', required: false,
    aliases: ['ifsc', 'ifsc code', 'ifs code', 'bank ifsc'], allowed: 'Eleven characters, fifth is zero', example: 'HDFC0000432' },
  { key: 'bank_branch', header: 'Bank and branch', table: 'company', type: 'text', required: false,
    aliases: ['bank and branch', 'bank branch', 'bank name', 'bank name and branch', 'branch', 'bank'], example: 'HDFC Bank, Alwar' },
  { key: 'cheque_on_file', header: 'Cancelled cheque on file', table: 'company', type: 'bool', required: false,
    aliases: ['cancelled cheque on file', 'cheque on file', 'cheque received'], example: 'Yes' },
  { key: 'authorised_signatory', header: 'Authorised signatory', table: 'company', type: 'text', required: false,
    aliases: ['authorised signatory', 'authorized signatory', 'signatory', 'signing authority', 'name of signatory'], example: 'Ramesh Gupta' },
  { key: 'nda_status', header: 'NDA status', table: 'company', type: 'enum', required: false,
    aliases: ['nda status', 'nda', 'nda signed', 'nda done'], allowed: 'Yes, No, In process', example: 'In process' },
  { key: 'nda_signed_date', header: 'NDA signed date', table: 'company', type: 'date', required: false,
    aliases: ['nda signed date', 'nda date', 'date of nda'], allowed: 'DD/MM/YYYY or YYYY-MM-DD', example: '2026-09-15' },

  // ---- site ----
  { key: 'gstin', header: 'GSTIN', table: 'vendor_site', type: 'gstin', required: false, excelText: true,
    aliases: ['gstin', 'gst no', 'gst number', 'gstin number', 'gst', 'gstin no', 'gst in', 'gst registration number', 'gstin/uin',
              'gst aadhaar', 'gst aadhar', 'gstin aadhaar', 'gst aadhaar number', 'gst aadhaar no', 'gstin aadhaar number'],
    allowed: 'GSTIN, 15 characters. A 12-digit Aadhaar number is also understood; only its last four digits are kept.',
    note: 'A GSTIN or a PAN is needed so the row can be matched to a company. The PAN is taken from the GSTIN.',
    example: '08AYEPP3943P1ZK' },
  { key: 'industry', header: 'Industry', table: 'vendor_site', type: 'enum', required: false,
    aliases: ['industry', 'industry type', 'sector', 'vendor type', 'category of vendor', 'business type', 'vertical'],
    allowed: 'Recycling, Packaging, Transportation (Logistics, Circularity, Packing also understood)',
    note: 'Optional. If blank it is worked out from Services; if that is unclear the vendor is left Unclassified.',
    example: 'Recycling' },
  { key: 'site_name', header: 'Site name', table: 'vendor_site', type: 'text', required: false,
    aliases: ['site name', 'plant name', 'unit name', 'location name', 'unit'], example: 'Khushkhera Unit' },
  { key: 'address_line1', header: 'Address', table: 'vendor_site', type: 'text', required: false,
    aliases: ['address', 'registered address', 'address line 1', 'address line1', 'plant address', 'street address', 'office address'],
    example: 'Plot 14, RIICO Industrial Area' },
  { key: 'city', header: 'City', table: 'vendor_site', type: 'text', required: false,
    aliases: ['city', 'town', 'district', 'city / district'], example: 'Alwar' },
  { key: 'state', header: 'State', table: 'vendor_site', type: 'enum', required: false,
    aliases: ['state', 'state name', 'state / ut', 'province'], allowed: 'Any Indian state or UT; common spellings accepted',
    note: 'Blank is filled from the first two digits of the GSTIN.', example: 'Rajasthan' },
  { key: 'pincode', header: 'Pincode', table: 'vendor_site', type: 'pincode', required: false, excelText: true,
    aliases: ['pincode', 'pin code', 'pin', 'zip', 'postal code', 'zip code', 'pin no'],
    allowed: 'Six digits, cannot start with zero', example: '301707' },
  { key: 'geography', header: 'Serviceable states', table: 'geography', type: 'list', required: false,
    aliases: ['serviceable states', 'serviceable geography', 'geography', 'states served', 'areas served', 'service area', 'coverage', 'regions served'],
    allowed: 'States separated by semicolon, or Pan India', example: 'Rajasthan; Gujarat; Haryana' },

  // ---- fields that came with the legacy vendor sheet ----
  { key: 'legacy_code', header: 'Vendor code', table: 'vendor_site', type: 'text', required: false,
    aliases: ['vendor code', 'legacy code', 'vendor id', 'supplier code', 'code', 'vendor no', 'vendor number', 'old vendor code', 'vendor code old'],
    note: 'The code the old system used. Kept for search and so a re-import is recognised. Must be unique.', example: 'V-0042' },
  { key: 'services_text', header: 'Services', table: 'vendor_site', type: 'longtext', required: false,
    aliases: ['services', 'service', 'services offered', 'scope of services', 'scope', 'type of service', 'service type', 'nature of services'],
    note: 'Free text. Also used to work out the industry when the Industry column is blank.', example: 'PET bottle recycling; EPR' },
  { key: 'credit_period', header: 'Credit period', table: 'company', type: 'credit', required: false,
    aliases: ['credit period', 'credit days', 'payment terms', 'credit period (days)', 'credit', 'payment days'],
    allowed: 'A number of days (30, "45 days", "1 month"). Words like Advance or Immediate become 0 days and the wording is kept as a note.',
    example: '45' },
  { key: 'projects_text', header: 'Projects', table: 'vendor_site', type: 'longtext', required: false,
    aliases: ['projects', 'project', 'project name', 'project names', 'client projects', 'linked projects'],
    note: 'Free text, kept as written.', example: 'Reliance EPR 2025' },
  { key: 'status', header: 'Status', table: 'vendor_site', type: 'status', required: false,
    aliases: ['status', 'vendor status', 'current status', 'active status', 'onboarding status'],
    allowed: 'Active, Inactive, Pending, Blocked (Approved, Onboarded, Disabled, Blacklisted, Rejected, Draft and similar are understood)',
    note: 'A blank or unrecognised status is set to Pending, never Active, so the onboarded count is never overstated.', example: 'Active' },
  { key: 'created_date', header: 'Created date', table: 'company', type: 'date', required: false,
    aliases: ['created date', 'created on', 'date created', 'creation date', 'onboarded on', 'onboarding date', 'date of onboarding', 'created at'],
    allowed: 'DD/MM/YYYY or YYYY-MM-DD. A date in the future is ignored.', note: 'Keeps the original onboarding date on the record.', example: '2025-04-12' },
  { key: 'doc_gst', header: 'GST / Aadhaar document', table: 'vendor_site', type: 'docref', required: false,
    aliases: ['gst / aadhaar document', 'gst aadhaar document', 'gst document', 'gst certificate', 'gst doc', 'aadhaar document', 'gst/aadhaar doc'],
    note: 'A link or file name from the old system. Files cannot travel in a spreadsheet, so this is a reminder of what must be uploaded.', example: 'gst-cert.pdf' },
  { key: 'doc_pan', header: 'PAN document', table: 'vendor_site', type: 'docref', required: false,
    aliases: ['pan document', 'pan card document', 'pan doc', 'pan copy', 'pan card copy'], example: 'pan.pdf' },
  { key: 'doc_agreement', header: 'Agreement document', table: 'vendor_site', type: 'docref', required: false,
    aliases: ['agreement document', 'agreement', 'agreement doc', 'nda document', 'contract document', 'agreement copy'], example: 'agreement.pdf' },
  { key: 'doc_cheque', header: 'Cancelled cheque', table: 'vendor_site', type: 'docref', required: false,
    aliases: ['cancelled cheque', 'cancelled cheque document', 'cheque document', 'cancelled cheque copy', 'cheque copy'],
    note: 'If this has a value, the company is marked "cancelled cheque on file".', example: 'cheque.pdf' },
  { key: 'doc_msme', header: 'MSME document', table: 'vendor_site', type: 'docref', required: false,
    aliases: ['msme document', 'udyam document', 'msme certificate', 'udyam certificate', 'msme doc', 'udyam certificate document'], example: 'udyam.pdf' },

  ...contactFields(1, 'Primary contact'),
  ...contactFields(2, 'Secondary contact'),
  ...contactFields(3, 'Other contact'),
];

export const FIELD_BY_KEY: Record<string, ImportField> =
  Object.fromEntries(IMPORT_FIELDS.map(f => [f.key, f]));

/** Columns the export writes that the importer ignores. Documented on the
 *  How-to-fill sheet so nobody tries to fill them in. */
export const COMPUTED_COLUMNS: { header: string; why: string }[] = [
  { header: 'Company code', why: 'Generated by the system (VEN 007).' },
  { header: 'Site code', why: 'Generated by the system (VEN 007-A).' },
  { header: 'Completeness', why: 'Calculated from what is filled in.' },
  { header: 'Documents attached', why: 'Counted from uploaded files.' },
  { header: 'Last updated', why: 'Set when a record is saved.' },
];
