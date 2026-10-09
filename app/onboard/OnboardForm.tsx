'use client';
import { useState } from 'react';
import { INDUSTRIES, REGIONS, STATES, panFromGstin } from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';
import { submitVendorSignup } from './actions';

export type Cat = { id: string; industry: string; code: string; label: string; subs: { id: string; label: string }[] };

const MAX_FILE = 10 * 1024 * 1024;
const OK_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

function FileField({ label, file, onChange }: { label: string; file: File | null; onChange: (f: File | null) => void }) {
  return (
    <div>
      <label className="lab">{label} <span className="req">*</span></label>
      <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
             onChange={e => onChange(e.target.files?.[0] ?? null)} />
      {file && <div className="hint mt-1">{file.name} · {(file.size / 1024).toFixed(0)} KB</div>}
    </div>
  );
}

/** A single, continuously-scrolling page — a vendor fills this in start to
 *  finish and submits once, like a Google Form, not a multi-step wizard. */
export default function OnboardForm({ cats }: { cats: Cat[] }) {
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [industry, setIndustry] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [location, setLocation] = useState('');
  const [contactName, setContactName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subIds, setSubIds] = useState<string[]>([]);
  const [geo, setGeo] = useState<string[]>([]);
  const [openRegions, setOpenRegions] = useState<string[]>([]);
  const [gstFile, setGstFile] = useState<File | null>(null);
  const [panFile, setPanFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ companyCode: string; siteCode: string } | null>(null);

  const pan = panFromGstin(gstin);
  const industryCats = cats.filter(c => c.industry === industry);
  const category = industryCats.find(c => c.id === categoryId);

  const toggleRegion = (code: string, sts: string[]) => {
    if (openRegions.includes(code)) {
      setOpenRegions(p => p.filter(r => r !== code));
      setGeo(p => p.filter(s => !sts.includes(s)));
    } else {
      setOpenRegions(p => [...p, code]);
      setGeo(p => [...new Set([...p, ...sts])]);
    }
  };

  const uploadDoc = async (siteId: string, docType: 'gst' | 'pan', file: File) => {
    const supabase = createClient();
    const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    const path = `${siteId}/${docType}/${Date.now()}_${safe}`;
    const { error: upErr } = await supabase.storage.from('vendor-documents')
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (upErr) throw new Error(`${docType === 'gst' ? 'GST certificate' : 'PAN card'}: ${upErr.message}`);
    const { error: rowErr } = await supabase.from('site_document').insert({
      site_id: siteId, doc_type: docType, storage_path: path,
      file_name: file.name, file_size: file.size, mime_type: file.type || null,
    });
    if (rowErr) throw new Error(`${docType === 'gst' ? 'GST certificate' : 'PAN card'}: ${rowErr.message}`);
  };

  const submit = async () => {
    setError('');
    if (!gstFile) { setError('Upload the GST certificate.'); return; }
    if (!panFile) { setError('Upload the PAN card.'); return; }
    for (const f of [gstFile, panFile]) {
      if (f.size > MAX_FILE) { setError(`${f.name} is larger than 10 MB.`); return; }
      if (!OK_TYPES.includes(f.type)) { setError('Only PDF, JPG and PNG are accepted.'); return; }
    }

    setBusy(true);
    const res = await submitVendorSignup({
      gstin, industry, legal_name: legalName,
      site: { address_line1: addressLine1, city, state, pincode, location },
      contact: { name: contactName, mobile, email },
      category_id: categoryId, subcategory_ids: subIds, geography: geo,
    });
    if (res.error || !res.siteId) {
      setBusy(false); setError(res.error ?? 'Something went wrong.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    try {
      setUploading('Uploading GST certificate…');
      await uploadDoc(res.siteId, 'gst', gstFile);
      setUploading('Uploading PAN card…');
      await uploadDoc(res.siteId, 'pan', panFile);
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
        <h1 className="text-[24px] font-bold mb-2">Vendor sign-up</h1>
        <p className="text-[13.5px]" style={{ color: 'var(--muted)' }}>
          Tell us about your company so we can review and onboard you as a GreenFind vendor.
          No account or sign-in is needed — fill this in once, submit, and our team takes it
          from there. Everything marked <span className="req">*</span> is required.
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
                   onChange={e => setGstin(e.target.value.toUpperCase())} />
            {pan && <div className="hint">PAN {pan}</div>}
          </div>
          <div>
            <label className="lab">Industry type <span className="req">*</span></label>
            <select value={industry} onChange={e => { setIndustry(e.target.value); setCategoryId(''); setSubIds([]); }}>
              <option value="">Select…</option>
              {INDUSTRIES.map(i => <option key={i.code} value={i.code}>{i.label}</option>)}
            </select>
          </div>
          <FileField label="GST certificate" file={gstFile} onChange={setGstFile} />
          <FileField label="PAN card" file={panFile} onChange={setPanFile} />
        </div>
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
            <label className="lab">Pincode <span className="req">*</span></label>
            <input value={pincode} maxLength={6} onChange={e => setPincode(e.target.value)} />
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
          Service
        </div>
        {!industry ? (
          <p className="text-[13px]" style={{ color: 'var(--faint)' }}>Choose an industry type above first.</p>
        ) : industryCats.length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--faint)' }}>No services are set up for this industry yet.</p>
        ) : (
          <>
            <div className="flex gap-2 flex-wrap mb-4">
              {industryCats.map(c => (
                <button key={c.id} type="button"
                        className={`chip ${categoryId === c.id ? 'c-g tick' : 'c-n'}`}
                        style={{ padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
                        onClick={() => { setCategoryId(c.id); setSubIds([]); }}>
                  {categoryId === c.id && '✓ '}{c.label}
                </button>
              ))}
            </div>
            {category && category.subs.length > 0 && (
              <div className="card p-4" style={{ background: 'var(--surface-2)' }}>
                <div className="text-[12px] font-bold mb-3" style={{ color: 'var(--head)' }}>
                  Sub-category <span className="req">*</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {category.subs.map(s => {
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
              </div>
            )}
          </>
        )}
      </div>

      <div className="card p-6 mb-5">
        <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-1" style={{ color: 'var(--p600)' }}>
          Geography — locations serviceable
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
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="lab">POC name <span className="req">*</span></label>
            <input value={contactName} maxLength={100} onChange={e => setContactName(e.target.value)} />
          </div>
          <div>
            <label className="lab">Mobile number <span className="req">*</span></label>
            <input value={mobile} maxLength={10} placeholder="9414011223" onChange={e => setMobile(e.target.value)} />
          </div>
          <div>
            <label className="lab">Email ID</label>
            <input value={email} maxLength={255} onChange={e => setEmail(e.target.value)} />
          </div>
        </div>
      </div>

      <button type="button" className="btn btn-p" disabled={busy} onClick={submit}>
        {busy && <span className="spinner" aria-hidden="true" />}
        {uploading || (busy ? 'Submitting…' : 'Submit')}
      </button>
    </>
  );
}
