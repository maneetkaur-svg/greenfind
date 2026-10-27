'use client';
import { useEffect, useState } from 'react';
import { INDUSTRIES, REGIONS, STATES, panFromGstin } from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';
import { submitVendorSignup } from './actions';

export type Cat = { id: string; industry: string; code: string; label: string; subs: { id: string; label: string }[] };

const MAX_FILE = 10 * 1024 * 1024;
const OK_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const HOW_HEARD = ['Referral from another vendor', 'Social media', 'Google search', 'Industry event or exhibition', 'Fitsol team reached out', 'Other'];
type Contact = { name: string; designation: string; mobile: string; email: string };
const blankContact: Contact = { name: '', designation: '', mobile: '', email: '' };

function FileField({ label, file, onChange, required = true }: {
  label: string; file: File | null; onChange: (f: File | null) => void; required?: boolean;
}) {
  return (
    <div>
      <label className="lab">{label} {required && <span className="req">*</span>}</label>
      <label className="file-drop">
        <div className="file-drop-icon">📄</div>
        <div className="file-drop-label">{file ? file.name : 'Click to upload a file'}</div>
        <div className="file-drop-sub">{file ? `${(file.size / 1024).toFixed(0)} KB — click to replace` : 'PDF, JPG or PNG · up to 10 MB'}</div>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" className="sr-only"
               onChange={e => onChange(e.target.files?.[0] ?? null)} />
      </label>
    </div>
  );
}

type DocType = 'gst' | 'pan';
const DOC_LABEL: Record<DocType, string> = { gst: 'GST certificate', pan: 'PAN card' };

// The postal API's own state names don't always match this app's canonical
// GST-registry spelling (STATES, from lib/constants) — close enough for a
// human to read, not close enough for a controlled <select> to match. Only
// the handful that are known to differ are listed; anything else either
// already matches exactly or is left for the vendor to pick by hand.
const STATE_ALIASES: Record<string, string> = {
  'Dadra and Nagar Haveli and Daman and Diu': 'DNH & Daman Diu',
  'Andaman and Nicobar Islands': 'Andaman & Nicobar',
  'Pondicherry': 'Puducherry',
  'Orissa': 'Odisha',
  'NCT of Delhi': 'Delhi',
};
function resolveStateName(apiState: string): string | null {
  if (STATES.includes(apiState)) return apiState;
  return STATE_ALIASES[apiState] ?? null;
}

/** A single, continuously-scrolling page — a vendor fills this in start to
 *  finish and submits once, like a Google Form, not a multi-step wizard. */
export default function OnboardForm({ cats }: { cats: Cat[] }) {
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [panNumber, setPanNumber] = useState('');
  const [industry, setIndustry] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [pincodeStatus, setPincodeStatus] = useState<'idle' | 'loading' | 'found' | 'unresolved_state' | 'not_found' | 'error'>('idle');
  const [location, setLocation] = useState('');
  const [primary, setPrimary] = useState<Contact>({ ...blankContact });
  const [secondary, setSecondary] = useState<Contact>({ ...blankContact });
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [subIds, setSubIds] = useState<string[]>([]);
  const [geo, setGeo] = useState<string[]>([]);
  const [openRegions, setOpenRegions] = useState<string[]>([]);
  const [howHeard, setHowHeard] = useState('');
  const [howHeardOther, setHowHeardOther] = useState('');
  const [firstTime, setFirstTime] = useState(false);
  const [consent, setConsent] = useState(false);
  const [gstFile, setGstFile] = useState<File | null>(null);
  const [panFile, setPanFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ companyCode: string; siteCode: string } | null>(null);

  const derivedPan = panFromGstin(gstin);
  const industryCats = cats.filter(c => c.industry === industry);
  const selectedCats = industryCats.filter(c => categoryIds.includes(c.id));

  // Pincode drives city/state instead of the other way round, so the two
  // can never quietly disagree the way free-typed fields can. Fed by
  // India Post's own public lookup — no key, no account, and it is the
  // same registry GSTIN state codes ultimately come from.
  useEffect(() => {
    if (!/^[1-9][0-9]{5}$/.test(pincode)) { setPincodeStatus('idle'); return; }
    let cancelled = false;
    setPincodeStatus('loading');
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`);
        const data = await res.json();
        if (cancelled) return;
        const office = data?.[0]?.Status === 'Success' ? data[0].PostOffice?.[0] : null;
        if (!office) { setPincodeStatus('not_found'); return; }
        setCity(office.District ?? '');
        const resolved = resolveStateName(office.State ?? '');
        if (resolved) { setState(resolved); setPincodeStatus('found'); }
        else setPincodeStatus('unresolved_state');
      } catch {
        if (!cancelled) setPincodeStatus('error');
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [pincode]);

  const toggleRegion = (code: string, sts: string[]) => {
    if (openRegions.includes(code)) {
      setOpenRegions(p => p.filter(r => r !== code));
      setGeo(p => p.filter(s => !sts.includes(s)));
    } else {
      setOpenRegions(p => [...p, code]);
      setGeo(p => [...new Set([...p, ...sts])]);
    }
  };

  const uploadDoc = async (siteId: string, docType: DocType, file: File) => {
    const supabase = createClient();
    const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    const path = `${siteId}/${docType}/${Date.now()}_${safe}`;
    const { error: upErr } = await supabase.storage.from('vendor-documents')
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (upErr) throw new Error(`${DOC_LABEL[docType]}: ${upErr.message}`);
    // A security-definer RPC rather than a direct table insert -- see
    // sql/43_public_attach_document_rpc.sql for why.
    const { error: rpcErr } = await supabase.rpc('public_attach_document', {
      p_site_id: siteId, p_doc_type: docType, p_storage_path: path,
      p_file_name: file.name, p_file_size: file.size, p_mime_type: file.type || null,
    });
    if (rpcErr) throw new Error(`${DOC_LABEL[docType]}: ${rpcErr.message}`);
  };

  const submit = async () => {
    setError('');
    if (!consent) { setError('You must agree to the data-use disclaimer to submit.'); return; }
    for (const f of [...(gstFile ? [gstFile] : []), ...(panFile ? [panFile] : [])]) {
      if (f.size > MAX_FILE) { setError(`${f.name} is larger than 10 MB.`); return; }
      if (!OK_TYPES.includes(f.type)) { setError('Only PDF, JPG and PNG are accepted.'); return; }
    }

    setBusy(true);
    const res = await submitVendorSignup({
      gstin, pan_number: panNumber, industry, legal_name: legalName,
      site: { address_line1: addressLine1, city, state, pincode, location },
      contacts: [primary, secondary],
      category_ids: categoryIds, subcategory_ids: subIds, geography: geo,
      how_heard: howHeard === 'Other' ? howHeardOther : howHeard,
      first_time_with_fitsol: firstTime, consent,
    });
    if (res.error || !res.siteId) {
      setBusy(false); setError(res.error ?? 'Something went wrong.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    try {
      if (gstFile) {
        setUploading('Uploading GST certificate…');
        await uploadDoc(res.siteId, 'gst', gstFile);
      }
      if (panFile) {
        setUploading('Uploading PAN card…');
        await uploadDoc(res.siteId, 'pan', panFile);
      }
    } catch (e) {
      // The record itself is already created — a document that failed to
      // attach is not worth losing that over. Reviewers can ask for it again.
      setUploading('');
      setBusy(false);
      setResult({ companyCode: res.companyCode!, siteCode: res.siteCode! });
      setError(`Saved, but one document did not upload: ${(e as Error).message}. Our team will follow up for it.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setUploading(''); setBusy(false);
    setResult({ companyCode: res.companyCode!, siteCode: res.siteCode! });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (result) {
    return (
      <div className="card p-8 text-center">
        <div className="text-[34px] mb-2">✓</div>
        <h1 className="text-[20px] font-bold mb-2">Thanks — your details are in.</h1>
        <p className="text-[13.5px]" style={{ color: 'var(--muted)' }}>
          Reference {result.siteCode} under company {result.companyCode}. Our team will review
          what you have submitted and be in touch.
        </p>
        {error && <div className="note a mt-4 text-left">{error}</div>}
      </div>
    );
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[24px] font-bold mb-2" style={{ letterSpacing: '-.01em' }}>HI, WELCOME TO FITSOL</h1>
        <p className="text-[13.5px]" style={{ color: 'var(--muted)' }}>
          Fill in the form below to register as a GreenFind vendor. Our team reviews every
          submission and connects verified vendors with clients whose requirements match what
          you already do — real work, not just a listing. Everything marked <span className="req">*</span> is required.
          {' '}Want to submit everything in one sitting instead — banking, certificates, every
          document — rather than have our team follow up for it? Use the{' '}
          <a href="/onboard/full" style={{ color: 'var(--p600)', fontWeight: 600 }}>complete onboarding form</a>.
        </p>
      </div>

      {error && <div className="note r mb-5">{error}</div>}

      <div className="card p-6 mb-5">
        <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-3" style={{ color: 'var(--p600)' }}>
          Company
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="lab">Legal name <span className="req">*</span></label>
            <input value={legalName} maxLength={200} onChange={e => setLegalName(e.target.value)} />
          </div>
          <div>
            <label className="lab">GSTIN <span className="req">*</span></label>
            <input value={gstin} maxLength={15} placeholder="08AYEPP3943P1ZK"
                   onChange={e => {
                     const v = e.target.value.toUpperCase();
                     setGstin(v);
                     const derived = panFromGstin(v);
                     if (derived) setPanNumber(derived);
                   }} />
          </div>
          <div>
            <label className="lab">PAN number <span className="req">*</span></label>
            <input value={panNumber} maxLength={10} placeholder="AYEPP3943P"
                   onChange={e => setPanNumber(e.target.value.toUpperCase())} />
            {derivedPan && panNumber && panNumber !== derivedPan && (
              <div className="err">This does not match the PAN inside your GSTIN ({derivedPan}).</div>
            )}
          </div>
          <FileField label="GST certificate" file={gstFile} onChange={setGstFile} required={false} />
          <FileField label="PAN card" file={panFile} onChange={setPanFile} required={false} />
          <div>
            <label className="lab">Industry type <span className="req">*</span></label>
            <select value={industry} onChange={e => { setIndustry(e.target.value); setCategoryIds([]); setSubIds([]); }}>
              <option value="">Select…</option>
              {INDUSTRIES.map(i => <option key={i.code} value={i.code}>{i.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card p-6 mb-5">
        <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-1" style={{ color: 'var(--p600)' }}>
          Service
        </div>
        {!industry ? (
          <p className="text-[13px]" style={{ color: 'var(--faint)' }}>Choose an industry type above first.</p>
        ) : industryCats.length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--faint)' }}>No services are set up for this industry yet.</p>
        ) : (
          <>
            <p className="text-[13px] mb-3" style={{ color: 'var(--faint)' }}>
              Pick every service you&apos;re registered or set up for — more than one is fine.
            </p>
            <div className="flex gap-2 flex-wrap mb-4">
              {industryCats.map(c => {
                const on = categoryIds.includes(c.id);
                return (
                  <button key={c.id} type="button"
                          className={`chip ${on ? 'c-g tick' : 'c-n'}`}
                          style={{ padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
                          onClick={() => {
                            if (on) {
                              setCategoryIds(p => p.filter(x => x !== c.id));
                              setSubIds(p => p.filter(id => !c.subs.some(s => s.id === id)));
                            } else {
                              setCategoryIds(p => [...p, c.id]);
                            }
                          }}>
                    {on && '✓ '}{c.label}
                  </button>
                );
              })}
            </div>
            {selectedCats.map(c => {
              if (c.subs.length === 0) return null;
              const n = c.subs.filter(s => subIds.includes(s.id)).length;
              return (
                <div key={c.id} className="card p-4 mb-3" style={{ background: 'var(--surface-2)' }}>
                  <div className="flex justify-between items-center gap-3 mb-3 flex-wrap">
                    <div className="text-[12px] font-bold" style={{ color: 'var(--head)' }}>
                      {c.label} — sub-category <span className="req">*</span>
                    </div>
                    <span className={`chip ${n ? 'c-g' : 'c-r'}`} style={{ fontSize: 10.5 }}>{n}/{c.subs.length}</span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {c.subs.map(s => {
                      const on = subIds.includes(s.id);
                      return (
                        <button key={s.id} type="button"
                                className={`chip ${on ? 'c-g tick' : 'c-n'}`}
                                style={{ padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }}
                                onClick={() => setSubIds(p => on ? p.filter(x => x !== s.id) : [...p, s.id])}>
                          {on && '✓ '}{s.label}
                        </button>
                      );
                    })}
                  </div>
                  {!n && <div className="err mt-2">Pick at least one, or remove this service above.</div>}
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="card p-6 mb-5">
        <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-3" style={{ color: 'var(--p600)' }}>
          Registered address of business
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="lab">Address <span className="req">*</span></label>
            <input value={addressLine1} maxLength={255} onChange={e => setAddressLine1(e.target.value)} />
          </div>
          <div>
            <label className="lab">Pincode <span className="req">*</span></label>
            <input value={pincode} maxLength={6} inputMode="numeric"
                   onChange={e => setPincode(e.target.value.replace(/[^0-9]/g, ''))} />
            {pincodeStatus === 'loading' && <div className="hint">Looking up city and state…</div>}
            {pincodeStatus === 'found' && <div className="hint">City and state filled in from the pincode — edit either if something looks wrong.</div>}
            {pincodeStatus === 'not_found' && <div className="err">That pincode was not found. Enter city and state yourself.</div>}
            {pincodeStatus === 'unresolved_state' && <div className="err">City filled in, but pick your state from the list — it could not be matched automatically.</div>}
            {pincodeStatus === 'error' && <div className="err">Could not look up that pincode right now. Enter city and state yourself.</div>}
          </div>
          <div>
            <label className="lab">City <span className="req">*</span></label>
            <input value={city} maxLength={100} onChange={e => setCity(e.target.value)} />
          </div>
          <div>
            <label className="lab">State <span className="req">*</span></label>
            <select value={state} onChange={e => setState(e.target.value)}>
              <option value="">Select…</option>
              {STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="lab">Location</label>
            <input value={location} maxLength={120} placeholder="e.g. Khushkhera Plant"
                   onChange={e => setLocation(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card p-6 mb-5">
        <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-1" style={{ color: 'var(--p600)' }}>
          Serviceable Geography
        </div>
        <p className="text-[13px] mb-4" style={{ color: 'var(--faint)' }}>
          Pick a region and its states appear, all selected. Untick anything you do not serve.
        </p>
        <div className="flex gap-2 flex-wrap mb-4">
          <button type="button" className={`chip ${geo.length === STATES.length ? 'c-g tick' : 'c-n'}`}
                  style={{ padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
                  onClick={() => {
                    if (geo.length === STATES.length) { setGeo([]); setOpenRegions([]); }
                    else { setGeo([...STATES]); setOpenRegions(REGIONS.map(r => r[0])); }
                  }}>
            {geo.length === STATES.length && '✓ '}Pan India
          </button>
          {REGIONS.map(([code, label, sts]) => {
            const on = openRegions.includes(code);
            const n = sts.filter(s => geo.includes(s)).length;
            const full = n === sts.length;
            return (
              <button key={code} type="button" className={`chip ${on ? (full ? 'c-g tick' : 'c-a') : 'c-n'}`}
                      style={{ padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
                      onClick={() => toggleRegion(code, sts)}>
                {on && full && '✓ '}{label}{on && ` · ${n}/${sts.length}`}
              </button>
            );
          })}
        </div>
        {openRegions.map(code => {
          const r = REGIONS.find(x => x[0] === code);
          if (!r) return null;
          return (
            <div key={code} className="card p-4 mb-3" style={{ background: 'var(--surface-2)' }}>
              <div className="text-[13px] font-bold mb-3" style={{ color: 'var(--head)' }}>{r[1]}</div>
              <div className="flex gap-2 flex-wrap">
                {r[2].map(s => {
                  const on = geo.includes(s);
                  return (
                    <button key={s} type="button" className={`chip ${on ? 'c-g tick' : 'c-n'}`}
                            style={{ padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }}
                            onClick={() => setGeo(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s])}>
                      {on && '✓ '}{s}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="hint">{geo.length} of {STATES.length} states selected.</div>
      </div>

      <div className="card p-6 mb-5">
        <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-3" style={{ color: 'var(--p600)' }}>
          Point of contact
        </div>
        <div className="text-[12px] font-bold mb-3" style={{ color: 'var(--head)' }}>
          Primary contact <span className="req">*</span>
        </div>
        <div className="grid md:grid-cols-4 gap-4 mb-5">
          <div>
            <label className="lab">Name <span className="req">*</span></label>
            <input value={primary.name} maxLength={100} onChange={e => setPrimary(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className="lab">Designation <span className="req">*</span></label>
            <input value={primary.designation} maxLength={100} onChange={e => setPrimary(p => ({ ...p, designation: e.target.value }))} />
          </div>
          <div>
            <label className="lab">Mobile number <span className="req">*</span></label>
            <input value={primary.mobile} maxLength={10} placeholder="9414011223" onChange={e => setPrimary(p => ({ ...p, mobile: e.target.value }))} />
          </div>
          <div>
            <label className="lab">Email ID <span className="req">*</span></label>
            <input value={primary.email} maxLength={255} onChange={e => setPrimary(p => ({ ...p, email: e.target.value }))} />
          </div>
        </div>
        <div className="text-[12px] font-bold mb-3 pt-5 border-t" style={{ color: 'var(--head)', borderColor: 'var(--line)' }}>
          Secondary contact <span className="text-[11px] font-normal" style={{ color: 'var(--faint)' }}>(optional)</span>
        </div>
        <div className="grid md:grid-cols-4 gap-4">
          <div>
            <label className="lab">Name</label>
            <input value={secondary.name} maxLength={100} onChange={e => setSecondary(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className="lab">Designation</label>
            <input value={secondary.designation} maxLength={100} onChange={e => setSecondary(p => ({ ...p, designation: e.target.value }))} />
          </div>
          <div>
            <label className="lab">Mobile number</label>
            <input value={secondary.mobile} maxLength={10} placeholder="9414011223" onChange={e => setSecondary(p => ({ ...p, mobile: e.target.value }))} />
          </div>
          <div>
            <label className="lab">Email ID</label>
            <input value={secondary.email} maxLength={255} onChange={e => setSecondary(p => ({ ...p, email: e.target.value }))} />
          </div>
        </div>
      </div>

      <div className="card p-6 mb-5">
        <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-3" style={{ color: 'var(--p600)' }}>
          A little more
        </div>
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="lab">How did you hear about Fitsol?</label>
            <select value={howHeard} onChange={e => setHowHeard(e.target.value)}>
              <option value="">Select…</option>
              {HOW_HEARD.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          {howHeard === 'Other' && (
            <div>
              <label className="lab">Please specify</label>
              <input value={howHeardOther} maxLength={150} onChange={e => setHowHeardOther(e.target.value)} />
            </div>
          )}
        </div>
        <label className="flex items-start gap-2 text-[13px]" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={firstTime} onChange={e => setFirstTime(e.target.checked)}
                 style={{ width: 'auto', marginTop: 2 }} />
          This is the first time we are doing business with Fitsol.
        </label>
      </div>

      <div className="card p-6 mb-5">
        <label className="flex items-start gap-2 text-[13px]" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}
                 style={{ width: 'auto', marginTop: 2 }} />
          <span>
            I confirm the data shared in this form is given voluntarily, and Fitsol retains the
            right to use it for internal circulation and vendor evaluation purposes.
            <span className="req"> *</span>
          </span>
        </label>
      </div>

      <button type="button" className="btn btn-p" disabled={busy || !consent} onClick={submit}>
        {busy && <span className="spinner" aria-hidden="true" />}
        {uploading || (busy ? 'Submitting…' : 'Submit')}
      </button>
    </>
  );
}
