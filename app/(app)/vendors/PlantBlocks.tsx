import { STATES } from '@/lib/constants';

/** One block per plant — shared by the Add Vendor wizard and the existing-
 *  vendor record editor, so both stay in sync with no duplicated markup. */
export type Plant = {
  name: string; product: string; address_line1: string; city: string; state: string;
  pincode: string; gstin: string; contact_name: string; contact_mobile: string; contact_email: string;
};

export const blankPlant: Plant = {
  name: '', product: '', address_line1: '', city: '', state: '',
  pincode: '', gstin: '', contact_name: '', contact_mobile: '', contact_email: '',
};

export default function PlantBlocks({
  plants, onChange, disabled,
}: { plants: Plant[]; onChange: (i: number, k: keyof Plant, v: string) => void; disabled?: boolean }) {
  if (plants.length === 0) {
    return <div className="hint">Enter how many plants above to add their details.</div>;
  }

  return (
    <>
      {plants.map((p, i) => (
        <div key={i} className={`card p-4 ${i > 0 ? 'mt-4' : ''}`}
             style={{ background: 'var(--p50)', borderColor: 'var(--p100)' }}>
          <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-3"
               style={{ color: 'var(--p600)' }}>Plant {i + 1}</div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="lab" htmlFor={`pl_name_${i}`}>Plant name</label>
              <input id={`pl_name_${i}`} maxLength={120} value={p.name} disabled={disabled}
                     onChange={e => onChange(i, 'name', e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <label className="lab" htmlFor={`pl_product_${i}`}>Product produced here</label>
              <textarea id={`pl_product_${i}`} rows={3} value={p.product} disabled={disabled}
                        onChange={e => onChange(i, 'product', e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <label className="lab" htmlFor={`pl_addr_${i}`}>Address</label>
              <input id={`pl_addr_${i}`} maxLength={255} value={p.address_line1} disabled={disabled}
                     onChange={e => onChange(i, 'address_line1', e.target.value)} />
            </div>
            <div>
              <label className="lab" htmlFor={`pl_city_${i}`}>City</label>
              <input id={`pl_city_${i}`} maxLength={100} value={p.city} disabled={disabled}
                     onChange={e => onChange(i, 'city', e.target.value)} />
            </div>
            <div>
              <label className="lab" htmlFor={`pl_state_${i}`}>State</label>
              <select id={`pl_state_${i}`} value={p.state} disabled={disabled}
                      onChange={e => onChange(i, 'state', e.target.value)}>
                <option value="">Select…</option>
                {STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="lab" htmlFor={`pl_pin_${i}`}>Pincode</label>
              <input id={`pl_pin_${i}`} maxLength={6} value={p.pincode} disabled={disabled}
                     onChange={e => onChange(i, 'pincode', e.target.value)} />
            </div>
            <div>
              <label className="lab" htmlFor={`pl_gstin_${i}`}>GSTIN for this plant</label>
              <input id={`pl_gstin_${i}`} maxLength={15} value={p.gstin} disabled={disabled}
                     onChange={e => onChange(i, 'gstin', e.target.value.toUpperCase())} />
            </div>
            <div>
              <label className="lab" htmlFor={`pl_cname_${i}`}>Contact at this plant</label>
              <input id={`pl_cname_${i}`} maxLength={100} value={p.contact_name} disabled={disabled}
                     onChange={e => onChange(i, 'contact_name', e.target.value)} />
            </div>
            <div>
              <label className="lab" htmlFor={`pl_cmobile_${i}`}>Mobile</label>
              <input id={`pl_cmobile_${i}`} maxLength={10} value={p.contact_mobile} disabled={disabled}
                     onChange={e => onChange(i, 'contact_mobile', e.target.value)} />
            </div>
            <div>
              <label className="lab" htmlFor={`pl_cemail_${i}`}>Email</label>
              <input id={`pl_cemail_${i}`} maxLength={255} value={p.contact_email} disabled={disabled}
                     onChange={e => onChange(i, 'contact_email', e.target.value)} />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
