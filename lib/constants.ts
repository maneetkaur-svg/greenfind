/** Reference data that does not change per install.
 *  Categories and document rules live in the database — see 03_reference_data.sql. */

export const INDUSTRIES = [
  { code: 'recycling',      label: 'Recycling' },
  { code: 'packaging',      label: 'Packaging' },
  { code: 'transportation', label: 'Transportation' },
] as const;
export type Industry = (typeof INDUSTRIES)[number]['code'];

export const ENTITY_TYPES = [
  ['proprietorship', 'Proprietorship'], ['partnership', 'Partnership'],
  ['llp', 'LLP'], ['llc', 'LLC'], ['pvt_ltd', 'Private Limited'],
  ['public_ltd', 'Public Limited'], ['trust', 'Trust'], ['foreign', 'Foreign'],
] as const;

export const MSME_CATEGORIES = [
  ['micro', 'Micro'], ['small', 'Small'], ['medium', 'Medium'],
] as const;

export const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin', operations: 'Operations', user: 'User',
};

export const GST_STATES: Record<string, string> = {
  '01':'Jammu & Kashmir','02':'Himachal Pradesh','03':'Punjab','04':'Chandigarh',
  '05':'Uttarakhand','06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh',
  '10':'Bihar','11':'Sikkim','12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur',
  '15':'Mizoram','16':'Tripura','17':'Meghalaya','18':'Assam','19':'West Bengal',
  '20':'Jharkhand','21':'Odisha','22':'Chhattisgarh','23':'Madhya Pradesh','24':'Gujarat',
  '26':'DNH & Daman Diu','27':'Maharashtra','29':'Karnataka','30':'Goa','31':'Lakshadweep',
  '32':'Kerala','33':'Tamil Nadu','34':'Puducherry','35':'Andaman & Nicobar',
  '36':'Telangana','37':'Andhra Pradesh','38':'Ladakh',
};
export const STATES = Object.values(GST_STATES);

export const REGIONS: [string, string, string[]][] = [
  ['north','North',['Jammu & Kashmir','Ladakh','Himachal Pradesh','Punjab','Chandigarh','Uttarakhand','Haryana','Delhi','Rajasthan','Uttar Pradesh']],
  ['central','Central',['Madhya Pradesh','Chhattisgarh']],
  ['west','West',['Gujarat','Maharashtra','Goa','DNH & Daman Diu']],
  ['south','South',['Karnataka','Kerala','Tamil Nadu','Telangana','Andhra Pradesh','Puducherry','Lakshadweep','Andaman & Nicobar']],
  ['east','East',['Bihar','Jharkhand','Odisha','West Bengal','Sikkim']],
  ['northeast','North-East',['Assam','Arunachal Pradesh','Manipur','Meghalaya','Mizoram','Nagaland','Tripura']],
];

/* ---------- Validation, same rules as the database constraints ---------- */
export const RX = {
  gstin: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/,
  pan:   /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  ifsc:  /^[A-Z]{4}0[A-Z0-9]{6}$/,
  mobile:/^[6-9][0-9]{9}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  pincode:/^[1-9][0-9]{5}$/,
};

/** Characters 3–12 of a GSTIN are the PAN. This one fact is what lets the
 *  system detect that two registrations belong to the same company. */
export const panFromGstin = (g: string) =>
  RX.gstin.test((g || '').toUpperCase()) ? g.toUpperCase().slice(2, 12) : null;

export const stateFromGstin = (g: string) =>
  GST_STATES[(g || '').slice(0, 2)] ?? null;
