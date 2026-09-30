'use client';
import { useState, useEffect, useActionState } from 'react';
import Link from 'next/link';
import { createVendor, lookupCompany, type LookupResult, type CreateState } from './actions';
import { INDUSTRIES, ENTITY_TYPES, MSME_CATEGORIES, STATES, RX,
         panFromGstin, stateFromGstin } from '@/lib/constants';

export default function NewVendorPage() {
  const [state, action, pending] = useActionState<CreateState, FormData>(createVendor, {});

  const [gstin, setGstin] = useState('');
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [linkTo, setLinkTo] = useState('');
  const [isMsme, setIsMsme] = useState('no');
  const [entity, setEntity] = useState('');
  const [stateName, setStateName] = useState('');

  const pan = panFromGstin(gstin);
  const gstState = stateFromGstin(gstin);
  const gstinBad = gstin.length > 0 && !RX.gstin.test(gstin.toUpperCase());

  // As soon as a valid GSTIN is typed, ask the database whether this PAN
  // is already on record. No "have you dealt with us before" question.
  useEffect(() => {
    if (!pan) { setLookup(null); setLinkTo(''); return; }
    let cancelled = false;
    setChecking(true);
    lookupCompany(gstin).then(r => {
      if (cancelled) return;
      setLookup(r); setChecking(false);
      if (!r.found) setLinkTo('');
    });
    return () => { cancelled = true; };
  }, [pan, gstin]);

  useEffect(() => { if (gstState && !stateName) setStateName(gstState); }, [gstState, stateName]);

  const linked = lookup?.found && linkTo === lookup.id;

  return (
    <>
      <Link href="/vendors" className="text-[13px] font-semibold"
            style={{ color: 'var(--faint)' }}>← All vendors</Link>
      <h1 className="text-[26px] font-bold mt-2 mb-1">Add a vendor</h1>
      <p className="text-[13.5px] mb-6" style={{ color: 'var(--faint)' }}>
        One record per site. If the company already has a site on file, this one links to it.
      </p>

      {state.error && <div className="note r mb-5">{state.error}</div>}

      <form action={action} className="space-y-5 max-w-[900px]">
        <input type="hidden" name="link_company_id" value={linked ? linkTo : ''} />

        {/* ---------- GSTIN first: it decides everything else ---------- */}
        <div className="card p-6">
          <h2 className="text-[15px] font-bold mb-1">Registration</h2>
          <p className="text-[13px] mb-4" style={{ color: 'var(--faint)' }}>
            Start with the GSTIN. The PAN sits inside it, which is how the system
            knows whether this company is already on record.
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="lab" htmlFor="gstin">GSTIN <span className="req">*</span></label>
              <input id="gstin" name="gstin" required maxLength={15}
                     className={gstinBad ? 'bad' : ''}
                     placeholder="08AYEPP3943P1ZK"
                     value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} />
              {gstinBad
                ? <div className="err">Fifteen characters: two-digit state code, ten-character PAN, then three more.</div>
                : pan && <div className="hint">PAN <b>{pan}</b>{gstState && <> · {gstState}</>}</div>}
            </div>
            <div>
              <label className="lab">PAN</label>
              <input value={pan ?? ''} disabled placeholder="Derived from the GSTIN" />
              <div className="hint">Never typed. Taken from characters 3 to 12.</div>
            </div>
          </div>

          {checking && <div className="hint mt-3">Checking whether this PAN is on record…</div>}

          {lookup?.found && (
            <div className="note a mt-4">
              <b>{lookup.legal_name}</b> ({lookup.company_code}) is already on record under this PAN,
              with {lookup.site_count} site{lookup.site_count === 1 ? '' : 's'}.
              <div className="flex gap-2 mt-3 flex-wrap">
                <button type="button"
                        className={`btn ${linked ? 'btn-p' : 'btn-o'}`}
                        onClick={() => setLinkTo(lookup.id)}>
                  {linked ? '✓ Linking as another site' : 'Link as another site'}
                </button>
                <button type="button"
                        className={`btn ${!linked ? 'btn-p' : 'btn-o'}`}
                        onClick={() => setLinkTo('')}>
                  This is a different company
                </button>
              </div>
              {linked && (
                <div className="hint mt-3">
                  Company details come from {lookup.company_code}. Bank, MSME status and the NDA
                  stay in one place; this site keeps its own address and certificates.
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---------- Company: hidden when linking ---------- */}
        {!linked && (
          <div className="card p-6">
            <h2 className="text-[15px] font-bold mb-4">Company</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="lab" htmlFor="legal_name">Legal name <span className="req">*</span></label>
                <input id="legal_name" name="legal_name" required maxLength={200}
                       placeholder="Shree Jageram Industries" />
                <div className="hint">Exactly as on the GST certificate.</div>
              </div>
              <div>
                <label className="lab" htmlFor="trade_name">Trade name</label>
                <input id="trade_name" name="trade_name" maxLength={200} />
              </div>
              <div>
                <label className="lab" htmlFor="entity">Entity type</label>
                <select id="entity" name="entity" value={entity}
                        onChange={e => setEntity(e.target.value)}>
                  <option value="">Select…</option>
                  {ENTITY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="lab" htmlFor="signatory">Authorised signatory</label>
                <input id="signatory" name="signatory" maxLength={100} />
              </div>
              <div>
                <label className="lab">Registered as an MSME <span className="req">*</span></label>
                <select name="is_msme" value={isMsme} onChange={e => setIsMsme(e.target.value)}>
                  <option value="no">No</option><option value="yes">Yes</option>
                </select>
              </div>
              {isMsme === 'yes' && (
                <>
                  <div>
                    <label className="lab" htmlFor="msme_category">Enterprise category <span className="req">*</span></label>
                    <select id="msme_category" name="msme_category" required>
                      <option value="">Select…</option>
                      {MSME_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="lab" htmlFor="udyam_number">Udyam number <span className="req">*</span></label>
                    <input id="udyam_number" name="udyam_number" required maxLength={19}
                           placeholder="UDYAM-RJ-02-0041178" />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ---------- Site ---------- */}
        <div className="card p-6">
          <h2 className="text-[15px] font-bold mb-1">Site</h2>
          <p className="text-[13px] mb-4" style={{ color: 'var(--faint)' }}>
            The plant this record is for. A second plant becomes a second linked record, not a repeat of this one.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="lab" htmlFor="industry">Industry type <span className="req">*</span></label>
              <select id="industry" name="industry" required>
                <option value="">Select…</option>
                {INDUSTRIES.map(i => <option key={i.code} value={i.code}>{i.label}</option>)}
              </select>
              <div className="hint">Decides which documents apply and whether the evaluation runs.</div>
            </div>
            <div>
              <label className="lab" htmlFor="site_name">Site name</label>
              <input id="site_name" name="site_name" maxLength={120} placeholder="Khushkhera Unit" />
            </div>
            <div className="md:col-span-2">
              <label className="lab" htmlFor="address_line1">Address <span className="req">*</span></label>
              <input id="address_line1" name="address_line1" required maxLength={255} />
            </div>
            <div>
              <label className="lab" htmlFor="city">City <span className="req">*</span></label>
              <input id="city" name="city" required maxLength={100} />
            </div>
            <div>
              <label className="lab" htmlFor="state">State <span className="req">*</span></label>
              <select id="state" name="state" required value={stateName}
                      onChange={e => setStateName(e.target.value)}>
                <option value="">Select…</option>
                {STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {gstState && stateName && gstState !== stateName && (
                <div className="err">The GSTIN says {gstState}. These should match.</div>
              )}
            </div>
            <div>
              <label className="lab" htmlFor="pincode">Pincode <span className="req">*</span></label>
              <input id="pincode" name="pincode" required maxLength={6} placeholder="301707" />
            </div>
          </div>
        </div>

        {/* ---------- Primary contact ---------- */}
        <div className="card p-6">
          <h2 className="text-[15px] font-bold mb-4">Primary contact</h2>
          <div className="grid md:grid-cols-4 gap-4">
            <div><label className="lab" htmlFor="pc_name">Name</label>
              <input id="pc_name" name="pc_name" maxLength={100} /></div>
            <div><label className="lab" htmlFor="pc_designation">Designation</label>
              <input id="pc_designation" name="pc_designation" maxLength={100} /></div>
            <div><label className="lab" htmlFor="pc_mobile">Mobile</label>
              <input id="pc_mobile" name="pc_mobile" maxLength={10} placeholder="9414011223" /></div>
            <div><label className="lab" htmlFor="pc_email">Email</label>
              <input id="pc_email" name="pc_email" maxLength={255} /></div>
          </div>
          <div className="hint mt-3">
            The second and third contacts, geography, categories, documents and the
            evaluation are all on the record once it exists.
          </div>
        </div>

        <div className="flex gap-3 items-center">
          <button className="btn btn-p" disabled={pending || gstinBad}>
            {pending ? 'Saving…' : 'Create vendor'}
          </button>
          <Link href="/vendors" className="btn btn-o">Cancel</Link>
        </div>
      </form>
    </>
  );
}
