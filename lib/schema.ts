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
const POLLUTION: [string, string][] = [
  ['red', 'Red'], ['orange', 'Orange'], ['green', 'Green'], ['white', 'White'],
];
const EPR_TYPE: [string, string][] = [
  ['recycler', 'Recycler'], ['coprocessor', 'Co-processor'],
  ['pwp', 'Plastic waste processor'], ['pibo', 'PIBO'],
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
      { key: 'trade_name', label: 'Trade name', type: 'text', max: 200, half: true },
      { key: 'pan', label: 'PAN', type: 'readonly', half: true,
        hint: 'Taken from the GSTIN. Not editable.' },
      { key: 'entity', label: 'Entity type', type: 'select', options: ENTITY_TYPES.map(([a, b]) => [a, b] as [string, string]), half: true },
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
        hint: 'Not editable — it decides which company this site belongs to.' },
      { key: 'industry', label: 'Industry type', type: 'select', required: true,
        options: INDUSTRIES.map(i => [i.code, i.label] as [string, string]), half: true },
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
    ],
  },
  {
    id: 'banking',
    label: 'Banking',
    table: 'company',
    blurb: 'All of it required — a vendor with an incomplete bank record cannot be paid.',
    fields: [
      { key: 'bank_account_name', label: 'Bank account name', type: 'text', required: true, max: 150,
        hint: 'Should match the legal name. A mismatch holds up payment.' },
      { key: 'bank_account_number', label: 'Account number', type: 'text', required: true, max: 18, half: true },
      { key: 'ifsc', label: 'IFSC', type: 'text', required: true, max: 11, half: true,
        placeholder: 'HDFC0000432', hint: 'Eleven characters. The fifth is always zero.' },
      { key: 'bank_branch', label: 'Bank and branch', type: 'text', required: true, max: 150 },
      { key: 'cheque_on_file', label: 'Cancelled cheque on file', type: 'bool', required: true,
        hint: 'Must be yes before any payment is released.' },
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
    blurb: 'Read off the CTO. These values drive the evaluation.',
    industries: ['recycling'],
    fields: [
      { key: 'cto_order_no', label: 'Order number', type: 'text', max: 60, half: true },
      { key: 'cto_file_no', label: 'File number', type: 'text', max: 90, half: true },
      { key: 'cto_board', label: 'Issuing board', type: 'text', max: 90, half: true },
      { key: 'cto_unit_id', label: 'Unit ID', type: 'text', max: 30, half: true },
      { key: 'cto_valid_from', label: 'Valid from', type: 'date', half: true },
      { key: 'cto_valid_to', label: 'Valid until', type: 'date', half: true,
        hint: 'The date the whole evaluation hangs off.' },
      { key: 'cto_category', label: 'Pollution category', type: 'select', options: POLLUTION, half: true },
      { key: 'cto_category_sr', label: 'Category serial number', type: 'text', max: 60, half: true },
      { key: 'cto_product', label: 'Consented product', type: 'text', max: 150 },
      { key: 'cto_capacity', label: 'Consented capacity', type: 'number', half: true },
      { key: 'cto_capacity_unit', label: 'Capacity unit', type: 'select', options: CAP_UNITS, half: true },
      { key: 'cto_fresh_water_kld', label: 'Fresh water permitted (KLD)', type: 'number', half: true },
      { key: 'cto_groundwater', label: 'Source is groundwater', type: 'bool', half: true },
      { key: 'cto_trade_effluent_kld', label: 'Trade effluent generated (KLD)', type: 'number', half: true },
      { key: 'cto_effluent_recycled_kld', label: 'Trade effluent recycled (KLD)', type: 'number', half: true },
      { key: 'cto_zld', label: 'Zero liquid discharge required', type: 'bool', half: true },
      { key: 'cto_etp', label: 'ETP installed', type: 'bool', half: true },
      { key: 'cto_green_belt_pct', label: 'Green belt required (%)', type: 'number', half: true },
      { key: 'cto_project_cost_lakh', label: 'Project cost (₹ lakh)', type: 'number', half: true },
      { key: 'cto_cgwa_required', label: 'CGWA groundwater NOC required', type: 'bool', half: true },
      { key: 'cto_cgwa_obtained', label: 'CGWA NOC obtained', type: 'bool', half: true },
      { key: 'cto_conditions', label: 'Conditions worth tracking', type: 'longtext' },
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
      { key: 'epr_board', label: 'Issuing board', type: 'text', max: 90, half: true },
      { key: 'epr_type', label: 'Registered as', type: 'select', options: EPR_TYPE, half: true },
      { key: 'epr_issue_date', label: 'Issue date', type: 'date', half: true },
      { key: 'epr_valid_to', label: 'Valid until', type: 'date', half: true,
        hint: 'PWP registrations run one year. Renewal is due 90 days before.' },
      { key: 'epr_processing_code', label: 'Processing code', type: 'text', max: 20, half: true,
        placeholder: 'R1' },
      { key: 'epr_cat1', label: 'Cat-I capacity (TPA)', type: 'number', half: true },
      { key: 'epr_cat2', label: 'Cat-II capacity (TPA)', type: 'number', half: true },
      { key: 'epr_cat3', label: 'Cat-III capacity (TPA)', type: 'number', half: true },
      { key: 'epr_cat4', label: 'Cat-IV capacity (TPA)', type: 'number', half: true },
      { key: 'epr_product', label: 'Registered output product', type: 'text', max: 120, half: true },
      { key: 'epr_product_qty', label: 'Output capacity (TPA)', type: 'number', half: true },
      { key: 'intended_volume_tpa', label: 'Volume Fitsol intends to source (TPA)', type: 'number', half: true,
        hint: 'Set by Fitsol. Never source beyond the consented capacity.' },
      { key: 'epr_outstanding', label: 'Outstanding conditions', type: 'longtext',
        placeholder: 'Unpaid fees, undertakings, anything still owed' },
    ],
  },
];

export const sectionsFor = (industry: string) =>
  SECTIONS.filter(s => !s.industries || s.industries.includes(industry));
