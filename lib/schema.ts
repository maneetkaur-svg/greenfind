/** Every field the app edits, and which table it belongs to.
 *  This mirrors the database in 01_schema.sql. Adding a field here and to the
 *  table is all it takes — the forms build themselves from this list. */

export type FieldType =
  | 'text' | 'number' | 'currency' | 'date' | 'bool' | 'select' | 'longtext' | 'readonly';

export type Field = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: [string, string][];
  hint?: string;
  placeholder?: string;
  max?: number;
  /** show only when this returns true */
  showIf?: (v: Record<string, unknown>) => boolean;
  /** half width on wide screens */
  half?: boolean;
  /** editable by Super Admin only — operations sees it, disabled. Enforced
   *  again in actions.ts and by a database trigger, not just hidden here. */
  superAdminOnly?: boolean;
};

export type Section = {
  id: string;
  label: string;
  table: 'company' | 'vendor_site' | 'site_operations' | 'site_certificate_data';
  blurb?: string;
  fields: Field[];
  /** only show this section for these industries */
  industries?: string[];
};

import { ENTITY_TYPES, MSME_CATEGORIES, INDUSTRIES, STATES } from './constants';

const NDA_STATUS: [string, string][] = [['yes', 'Yes'], ['no', 'No'], ['inprocess', 'In process']];
const CAP_UNITS: [string, string][] = [
  ['mt_day', 'MT per day'], ['mt_month', 'MT per month'], ['tpa', 'MT per year (TPA)'],
];

export const SECTIONS: Section[] = [
  {
    id: 'identity',
    label: 'Identity',
    table: 'company',
    blurb: 'Statutory identity. Shared by every site this company has.',
    fields: [
      { key: 'legal_name', label: 'Legal name', type: 'text', required: true, max: 200,
        hint: 'Exactly as on the GST certificate.' },
      { key: 'pan', label: 'PAN', type: 'readonly', half: true,
        hint: 'Taken from the GSTIN, or recorded when the vendor was imported. Not editable.' },
      { key: 'entity', label: 'Entity type', type: 'readonly', options: ENTITY_TYPES.map(([a, b]) => [a, b] as [string, string]), half: true,
        hint: 'Read automatically from the GSTIN. Not editable.' },
      { key: 'cin', label: 'CIN / LLPIN', type: 'text', max: 21, half: true,
        showIf: v => ['pvt_ltd', 'public_ltd', 'llp'].includes(String(v.entity ?? '')),
        hint: 'Required for Private Limited, Public Limited and LLP.' },
      { key: 'is_msme', label: 'Registered as an MSME', type: 'bool', required: true },
      { key: 'msme_category', label: 'Enterprise category', type: 'select',
        options: MSME_CATEGORIES.map(([a, b]) => [a, b] as [string, string]), half: true, showIf: v => v.is_msme === true },
      { key: 'udyam_number', label: 'Udyam number', type: 'text', max: 19, half: true,
        showIf: v => v.is_msme === true, placeholder: 'UDYAM-RJ-02-0041178' },
      { key: 'year_established', label: 'Year established', type: 'number', half: true,
        placeholder: '2016', hint: '1900 to the current year.' },
      { key: 'website', label: 'Website', type: 'text', max: 255, half: true },
    ],
  },
  {
    id: 'site',
    label: 'Site',
    table: 'vendor_site',
    blurb: 'This plant. A second plant is a second record linked to the same company.',
    fields: [
      { key: 'gstin', label: 'GSTIN', type: 'readonly',
        hint: 'Not editable — it decides which company this site belongs to. Blank for vendors imported without one.' },
      { key: 'industry', label: 'Industry type', type: 'select', required: true,
        options: INDUSTRIES.map(i => [i.code, i.label] as [string, string]), half: true,
        superAdminOnly: true,
        hint: 'Reclassifying an existing vendor is Super Admin only — it changes which document rules and tabs apply.' },
      { key: 'site_name', label: 'Site name', type: 'text', max: 120, half: true,
        placeholder: 'Khushkhera Unit' },
      { key: 'address_line1', label: 'Address', type: 'text', required: true, max: 255 },
      { key: 'city', label: 'City', type: 'text', required: true, max: 100, half: true },
      { key: 'state', label: 'State', type: 'select', required: true,
        options: STATES.map(s => [s, s] as [string, string]), half: true },
      { key: 'pincode', label: 'Pincode', type: 'text', required: true, max: 6, half: true },
      { key: 'is_registered_address', label: 'This is the registered address', type: 'bool', half: true },
      { key: 'geo_outside_india', label: 'Serves locations outside India', type: 'bool' },
    ],
  },
  {
    id: 'commercial',
    label: 'Commercial',
    table: 'company',
    blurb: 'Turnover and clients. Years in market is worked out from year established.',
    fields: [
      { key: 'turnover_current', label: 'Turnover, current financial year', type: 'currency', half: true },
      { key: 'turnover_previous', label: 'Turnover, previous financial year', type: 'currency', half: true },
      { key: 'serves_tier1_oem', label: 'Serves Tier-1 OEMs', type: 'bool', half: true },
      { key: 'key_clients', label: 'Key clients', type: 'longtext' },
      { key: 'credit_period_days', label: 'Credit period (days)', type: 'number', half: true,
        hint: '0 means advance or immediate payment.' },
      { key: 'credit_period_note', label: 'Credit period, as originally written', type: 'text', max: 100, half: true,
        showIf: v => !!v.credit_period_note, hint: 'Kept from the old portal when it was not a plain number of days.' },
    ],
  },
  {
    id: 'status',
    label: 'Status & history',
    table: 'vendor_site',
    blurb: 'Where this vendor stands, and what the old portal recorded about it.',
    fields: [
      { key: 'status', label: 'Status', type: 'select', required: true, half: true,
        options: [['active', 'Active'], ['inactive', 'Inactive'], ['pending', 'Pending'], ['blocked', 'Blocked']],
        hint: 'Only Active vendors count as onboarded on the dashboard.' },
      { key: 'legacy_vendor_code', label: 'Old vendor code', type: 'readonly', half: true,
        hint: 'The code the previous system used. Searchable from the vendor list.' },
      { key: 'aadhaar_last4', label: 'Aadhaar (last four digits)', type: 'readonly', half: true,
        showIf: v => !!v.aadhaar_last4,
        hint: 'The full number is deliberately not stored.' },
      { key: 'services_text', label: 'Services', type: 'longtext',
        hint: 'As recorded. The structured categories are on the Service categories tab.' },
      { key: 'projects_text', label: 'Projects', type: 'longtext' },
    ],
  },
  {
    id: 'banking',
    label: 'Banking',
    table: 'company',
    blurb: 'All of it required — a vendor with an incomplete bank record cannot be paid.',
    fields: [
      { key: 'bank_account_name', label: "A/c holder's name", type: 'text', required: true, max: 150,
        hint: 'Should match the legal name. A mismatch holds up payment.' },
      { key: 'bank_account_number', label: 'Account number', type: 'text', required: true, max: 18, half: true },
      { key: 'ifsc', label: 'IFSC', type: 'text', required: true, max: 11, half: true,
        placeholder: 'HDFC0000432', hint: 'Eleven characters. The fifth is always zero.' },
      { key: 'bank_branch', label: 'Bank and branch', type: 'text', required: true, max: 150 },
    ],
  },
  {
    id: 'agreements',
    label: 'Agreements',
    table: 'company',
    blurb: 'Internal. The NDA is sent by Fitsol and returned signed.',
    fields: [
      { key: 'authorised_signatory', label: 'Authorised signatory', type: 'text', max: 100,
        hint: 'Whoever signs the NDA.' },
      { key: 'nda_status', label: 'NDA status', type: 'select', options: NDA_STATUS, half: true },
      { key: 'nda_signed_date', label: 'NDA signed date', type: 'date', half: true },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    table: 'site_operations',
    blurb: 'Optional throughout. Nothing here blocks a save.',
    industries: ['recycling', 'packaging'],
    fields: [
      { key: 'installed_capacity', label: 'Installed capacity', type: 'number', half: true },
      { key: 'capacity_unit', label: 'Capacity unit', type: 'select', options: CAP_UNITS, half: true },
      { key: 'utilisation_pct', label: 'Current utilisation %', type: 'number', half: true },
      { key: 'storage_capacity', label: 'Storage capacity', type: 'number', half: true },
      { key: 'products_made', label: 'Products made', type: 'longtext' },
      { key: 'minimum_order_qty', label: 'Minimum order quantity', type: 'number', half: true },
      { key: 'lead_time_days', label: 'Lead time (days)', type: 'number', half: true },
      { key: 'machines', label: 'Machines', type: 'number', half: true },
      { key: 'workers', label: 'Workers', type: 'number', half: true },
      { key: 'employees', label: 'Employees', type: 'number', half: true },
      { key: 'shifts_per_day', label: 'Shifts per day', type: 'number', half: true },
      { key: 'hours_per_shift', label: 'Hours per shift', type: 'number', half: true },
      { key: 'working_days_week', label: 'Working days per week', type: 'number', half: true },
      { key: 'floor_area', label: 'Floor area', type: 'number', half: true },
      { key: 'power_backup', label: 'Power backup', type: 'bool' },
    ],
  },
  {
    id: 'fleet',
    label: 'Fleet',
    table: 'site_operations',
    blurb: 'Optional. These fields are proposed — the approved schema has none for transport.',
    industries: ['transportation'],
    fields: [
      { key: 'fleet_owned', label: 'Owned vehicles', type: 'number', half: true },
      { key: 'fleet_attached', label: 'Attached vehicles', type: 'number', half: true },
      { key: 'fleet_ev', label: 'Electric vehicles', type: 'number', half: true },
      { key: 'fleet_cng', label: 'CNG or LNG vehicles', type: 'number', half: true },
      { key: 'charging_infra', label: 'Charging infrastructure', type: 'select', half: true,
        options: [['own', 'Own depot'], ['third', 'Third-party network'], ['none', 'None']] },
      { key: 'telematics_provider', label: 'Telematics provider', type: 'text', max: 100, half: true,
        placeholder: 'Fleetx, Loconav, none' },
      { key: 'drivers_on_roll', label: 'Drivers on roll', type: 'number', half: true },
      { key: 'depots', label: 'Depots or branches', type: 'number', half: true },
      { key: 'lanes_served', label: 'Primary lanes served', type: 'longtext',
        placeholder: 'Alwar–Gurugram, Alwar–Jaipur' },
    ],
  },
  {
    id: 'cto',
    label: 'Consent to Operate',
    table: 'site_certificate_data',
    blurb: 'Read off the CTO.',
    industries: ['recycling'],
    fields: [
      { key: 'cto_order_no', label: 'CTO number', type: 'text', max: 60, half: true },
      { key: 'cto_valid_from', label: 'Valid from', type: 'date', half: true },
      { key: 'cto_valid_to', label: 'Valid until', type: 'date', half: true },
    ],
  },
  {
    id: 'epr',
    label: 'EPR registration',
    table: 'site_certificate_data',
    blurb: 'Read off the EPR or PWP registration certificate.',
    industries: ['recycling'],
    fields: [
      { key: 'epr_reg_no', label: 'Registration number', type: 'text', max: 60,
        placeholder: 'PR-31-RAJ-05-AYEPP3943P-24',
        hint: 'The PAN sits inside this number and is checked against the company.' },
      { key: 'epr_issue_date', label: 'Valid from', type: 'date', half: true },
      { key: 'epr_valid_to', label: 'Valid until', type: 'date', half: true },
    ],
  },
];

export const sectionsFor = (industry: string | null | undefined) =>
  SECTIONS.filter(s => !s.industries || (!!industry && s.industries.includes(industry)));
