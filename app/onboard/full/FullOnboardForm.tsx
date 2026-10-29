'use client';
import { useEffect, useState, useMemo } from 'react';
import FieldGrid from '@/app/(app)/vendors/FieldGrid';
import PlantBlocks, { blankPlant, type Plant } from '@/app/(app)/vendors/PlantBlocks';
import { SECTIONS } from '@/lib/schema';
import { INDUSTRIES, REGIONS, STATES, RX, panFromGstin, stateFromGstin } from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';
import { fileValidationError, MAX_FILE_BYTES_DIRECT } from '@/lib/fileUpload';
import { submitVendorSignupFull } from './actions';

export type Cat = { id: string; industry: string; code: string; label: string; subs: { id: string; label: string }[] };
export type DocRule = {
  industry: string; code: string; label: string; level: string;
  applies_to: string | null; expiry_tracked: boolean; uploaded_by_party: string; sort: number;
};

type Vals = Record<string, unknown>;
type Contact = { name: string; designation: string; mobile: string; email: string };
const blankContact: Contact = { name: '', designation: '', mobile: '', email: '' };
// Every field this form edits comes from the same lib/schema.ts SECTIONS list
// the internal Add Vendor wizard and the per-vendor record editor both use —
// a field added or changed there (e.g. in "operations" or "fleet") appears
// here too, with no further code change.
const sec = (id: string) => SECTIONS.find(s => s.id === id)!;

// Every document chosen during the form is held in the browser until the
// vendor exists, because a document needs a site to attach to (same
// constraint the quick form and the internal Add Vendor wizard both have).
type Pending = { file: File; number: string; validUntil: string };
const CONTEXTUAL_DOC_CODES = ['gst', 'pan', 'udyam', 'cheque', 'nda', 'cto', 'epr'];

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

const HOW_HEARD = ['Referral from another vendor', 'Social media', 'Google search', 'Industry event or exhibition', 'Fitsol team reached out', 'Other'];

type Issue = { step: string; text: string };

/** Section by section, like the internal Add Vendor wizard — not a single
 *  long scroll. Every section is reachable at any time (the sidebar list,
 *  Back/Continue) — nothing blocks moving around. Only Submit itself is
 *  gated, checking everything at once and naming which section to fix. */
export default function FullOnboardForm({ cats, docRules }: { cats: Cat[]; docRules: DocRule[] }) {
  const [gstin, setGstin] = useState('');
  const [panNumber, setPanNumber] = useState('');
  const [industry, setIndustry] = useState('');
  const [company, setCompany] = useState<Vals>({ is_msme: false });
  const [site, setSite] = useState<Vals>({ is_registered_address: true });
  const [ops, setOps] = useState<Vals>({});
  const [certs, setCerts] = useState<Vals>({});
  const [contacts, setContacts] = useState<Contact[]>([{ ...blankContact }, { ...blankContact }, { ...blankContact }]);
  const [showThirdContact, setShowThirdContact] = useState(false);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [geo, setGeo] = useState<string[]>([]);
  const [openRegions, setOpenRegions] = useState<string[]>([]);
  const [geoOutsideIndia, setGeoOutsideIndia] = useState(false);
  const [pickedCats, setPickedCats] = useState<string[]>([]);
  const [pickedSubs, setPickedSubs] = useState<string[]>([]);
  const [howHeard, setHowHeard] = useState('');
  const [howHeardOther, setHowHeardOther] = useState('');
  const [firstTime, setFirstTime] = useState(false);
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState<Record<string, Pending>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [extraFiles, setExtraFiles] = useState<{ id: string; label: string; file: File | null }[]>([]);
  const [addingExtra, setAddingExtra] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [result, setResult] = useState<{ companyCode: string; siteCode: string } | null>(null);
  const [step, setStep] = useState(0);
  const [started, setStarted] = useState(false);
  const [docsReady, setDocsReady] = useState(false);

  const pan = panFromGstin(gstin);
  const gstState = stateFromGstin(gstin);
  const gstinBad = gstin.length > 0 && !RX.gstin.test(gstin.toUpperCase());
  const sameAsRegistered = site.is_registered_address !== false;
  const plantCount = Math.min(50, Math.max(0, Math.floor(Number(site.plant_count) || 0)));
  const industryCats = useMemo(() => cats.filter(c => c.industry === industry), [cats, industry]);
  const showCtoEpr = industry === 'recycling' || industry === 'scrap_trading';
  const docs = useMemo(() => docRules.filter(d => d.industry === industry), [docRules, industry]);

  const steps = useMemo(() => {
    const list = [
      { id: 'identity', label: 'Company' },
      { id: 'site', label: 'Facility' },
      { id: 'geography', label: 'Serviceable Geography' },
      { id: 'contacts', label: 'Contacts' },
    ];
    if (industry === 'transportation') list.push({ id: 'operations', label: 'Fleet' });
    else if (industry) list.push({ id: 'operations', label: 'Operational Capacity' });
    list.push({ id: 'commercial', label: 'Commercials' });
    list.push({ id: 'banking', label: 'Payments and Banking' });
    list.push({ id: 'agreements', label: 'Agreements' });
    if (showCtoEpr) list.push({ id: 'cto', label: 'Consent to Operate & EPR' });
    list.push({ id: 'documents', label: 'Documents' });
    list.push({ id: 'review', label: 'Review and submit' });
    return list;
  }, [industry, showCtoEpr]);
  const current = steps[Math.min(step, steps.length - 1)];
  const go = (i: number) => {
    setStep(Math.max(0, Math.min(i, steps.length - 1)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    if (sameAsRegistered) { setPlants([]); return; }
    setPlants(prev => {
      if (prev.length === plantCount) return prev;
      const next = prev.slice(0, plantCount);
      while (next.length < plantCount) next.push({ ...blankPlant });
      return next;
    });
  }, [plantCount, sameAsRegistered]);
  const setPlantField = (i: number, k: keyof Plant, v: string) =>
    setPlants(prev => prev.map((p, idx) => idx === i ? { ...p, [k]: v } : p));

  useEffect(() => { if (gstState && !site.state) setSite(p => ({ ...p, state: gstState })); }, [gstState, site.state]);

  // Pincode drives city/state, same as the quick form.
  const [pincodeStatus, setPincodeStatus] = useState<'idle' | 'loading' | 'found' | 'unresolved_state' | 'not_found' | 'error'>('idle');
  useEffect(() => {
    const pincode = String(site.pincode ?? '');
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
        setSite(p => ({ ...p, city: office.District ?? p.city }));
        const resolved = resolveStateName(office.State ?? '');
        if (resolved) { setSite(p => ({ ...p, state: resolved })); setPincodeStatus('found'); }
        else setPincodeStatus('unresolved_state');
      } catch {
        if (!cancelled) setPincodeStatus('error');
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.pincode]);

  const toggleRegion = (code: string, sts: string[]) => {
    if (openRegions.includes(code)) {
      setOpenRegions(p => p.filter(r => r !== code));
      setGeo(p => p.filter(s => !sts.includes(s)));
    } else {
      setOpenRegions(p => [...p, code]);
      setGeo(p => [...new Set([...p, ...sts])]);
    }
  };

  const renderDocCard = (code: string) => {
    const d = docs.find(x => x.code === code);
    if (!d) return null;
    const chosen = files[d.code];
    return (
      <div key={d.code} className="card p-4 mb-3"
           style={chosen ? { borderColor: 'var(--p400)', background: 'var(--p50)' } : undefined}>
        <div className="flex justify-between items-start gap-3 mb-3 flex-wrap">
          <div>
            <div className="text-[13.5px] font-bold" style={{ color: 'var(--head)' }}>{d.label}</div>
            <div className="text-[12px]" style={{ color: 'var(--faint)' }}>
              {d.applies_to}
              {d.expiry_tracked && ' · expiry tracked'}
              {d.uploaded_by_party === 'fitsol' && ' · issued by Fitsol, usually added later'}
            </div>
          </div>
          <span className={`chip ${d.level === 'required' ? 'c-r' : d.level === 'conditional' ? 'c-a' : 'c-n'}`}>
            {d.level.toUpperCase()}
          </span>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <div className={d.expiry_tracked ? '' : 'md:col-span-2'}>
            <label className="lab" htmlFor={`f_${d.code}`}>File</label>
            <label className="file-drop" htmlFor={`f_${d.code}`}>
              <div className="file-drop-icon">📄</div>
              <div className="file-drop-label">{chosen ? chosen.file.name : 'Click to upload a file'}</div>
              <div className="file-drop-sub">
                {chosen ? `${(chosen.file.size / 1024).toFixed(0)} KB — click to replace` : 'PDF, JPG or PNG · up to 10 MB'}
              </div>
              <input id={`f_${d.code}`} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" className="sr-only"
                     onChange={e => {
                       const f = e.target.files?.[0];
                       if (f) {
                         const err = fileValidationError(f, MAX_FILE_BYTES_DIRECT);
                         setFileErrors(p => ({ ...p, [d.code]: err ?? '' }));
                         if (err) { e.target.value = ''; return; }
                       } else {
                         setFileErrors(p => ({ ...p, [d.code]: '' }));
                       }
                       setFiles(p => {
                         const n = { ...p };
                         if (f) n[d.code] = { file: f, number: p[d.code]?.number ?? '', validUntil: p[d.code]?.validUntil ?? '' };
                         else delete n[d.code];
                         return n;
                       });
                     }} />
            </label>
            {fileErrors[d.code] && <div className="err mt-1">{fileErrors[d.code]}</div>}
          </div>
          <div>
            <label className="lab" htmlFor={`n_${d.code}`}>Document number</label>
            <input id={`n_${d.code}`} maxLength={60} placeholder="As printed on it"
                   value={chosen?.number ?? ''}
                   onChange={e => setFiles(p => chosen ? { ...p, [d.code]: { ...chosen, number: e.target.value } } : p)} />
          </div>
          {d.expiry_tracked && (
            <div>
              <label className="lab" htmlFor={`v_${d.code}`}>Valid until</label>
              <input id={`v_${d.code}`} type="date" value={chosen?.validUntil ?? ''}
                     onChange={e => setFiles(p => chosen ? { ...p, [d.code]: { ...chosen, validUntil: e.target.value } } : p)} />
            </div>
          )}
        </div>
      </div>
    );
  };

  /* Gathered whenever asked for (on Submit, and to drive the small dot next
     to a section in the sidebar) — never blocks moving between sections,
     only blocks the final Submit. */
  const problems = (): Issue[] => {
    const out: Issue[] = [];
    if (!pan) out.push({ step: 'identity', text: 'Enter a valid GSTIN.' });
    else if (panNumber.toUpperCase() !== pan) out.push({ step: 'identity', text: 'The typed PAN does not match the one inside the GSTIN.' });
    if (!industry) out.push({ step: 'identity', text: 'Choose an industry type.' });
    if (!String(company.legal_name ?? '').trim()) out.push({ step: 'identity', text: 'Legal name is required.' });
    if (company.is_msme === true && (!company.msme_category || !company.udyam_number))
      out.push({ step: 'identity', text: 'An MSME needs both an enterprise category and a Udyam number.' });
    if (!pickedCats.length) out.push({ step: 'identity', text: 'Pick at least one service.' });
    for (const id of pickedCats) {
      const c = industryCats.find(x => x.id === id);
      if (c && c.subs.length && !c.subs.some(x => pickedSubs.includes(x.id)))
        out.push({ step: 'identity', text: `${c.label}: pick at least one sub-category, or remove this service.` });
    }

    if (!site.address_line1) out.push({ step: 'site', text: 'Address is required.' });
    if (!site.city) out.push({ step: 'site', text: 'City is required.' });
    if (!site.state) out.push({ step: 'site', text: 'State is required.' });
    if (!RX.pincode.test(String(site.pincode ?? ''))) out.push({ step: 'site', text: 'Pincode must be six digits and cannot start with zero.' });

    if (!geoOutsideIndia && geo.length === 0)
      out.push({ step: 'geography', text: 'Pick at least one serviceable state, or mark this site as serving locations outside India.' });

    if (!contacts[0].name.trim()) out.push({ step: 'contacts', text: 'The primary contact needs a name.' });
    if (!contacts[0].mobile.trim()) out.push({ step: 'contacts', text: 'The primary contact needs a mobile number.' });
    else if (!RX.mobile.test(contacts[0].mobile)) out.push({ step: 'contacts', text: 'Primary contact: mobile must be ten digits starting 6 to 9.' });
    if (!contacts[1].name.trim()) out.push({ step: 'contacts', text: 'The secondary contact needs a name.' });
    if (!contacts[1].mobile.trim()) out.push({ step: 'contacts', text: 'The secondary contact needs a mobile number.' });
    else if (!RX.mobile.test(contacts[1].mobile)) out.push({ step: 'contacts', text: 'Secondary contact: mobile must be ten digits starting 6 to 9.' });

    const ifsc = String(company.ifsc ?? '');
    if (ifsc && !RX.ifsc.test(ifsc.toUpperCase())) out.push({ step: 'banking', text: 'IFSC must be eleven characters, like HDFC0000432.' });

    if (!consent) out.push({ step: 'review', text: 'You must agree to the data-use disclaimer to submit.' });
    return out;
  };
  const problemStepIds = new Set(problems().map(p => p.step));

  const uploadDoc = async (siteId: string, docType: string, p: Pending) => {
    const supabase = createClient();
    const safe = p.file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    const path = `${siteId}/${docType}/${Date.now()}_${safe}`;
    const { error: upErr } = await supabase.storage.from('vendor-documents')
      .upload(path, p.file, { contentType: p.file.type || undefined, upsert: false });
    if (upErr) throw new Error(`${docType}: ${upErr.message}`);
    const { error: rpcErr } = await supabase.rpc('public_attach_document', {
      p_site_id: siteId, p_doc_type: docType, p_storage_path: path,
      p_file_name: p.file.name, p_file_size: p.file.size, p_mime_type: p.file.type || null,
      p_doc_number: p.number || null, p_valid_until: p.validUntil || null,
    });
    if (rpcErr) throw new Error(`${docType}: ${rpcErr.message}`);
  };

  const submit = async () => {
    const found = problems();
    if (found.length) {
      setIssues(found);
      setError(`${found.length} thing${found.length === 1 ? '' : 's'} to fix before this can be submitted.`);
      go(steps.findIndex(s => s.id === found[0].step));
      return;
    }
    setIssues([]); setError(''); setBusy(true);

    const res = await submitVendorSignupFull({
      gstin, pan_number: panNumber, industry,
      company, site: { ...site, plants: sameAsRegistered ? [] : plants, geo_outside_india: geoOutsideIndia },
      operations: ops, certificates: showCtoEpr ? certs : {},
      contacts: contacts.map(c => ({ ...c })),
      category_ids: pickedCats, subcategory_ids: pickedSubs, geography: geo,
      how_heard: howHeard === 'Other' ? howHeardOther : howHeard,
      first_time_with_fitsol: firstTime, consent,
    });
    if (res.error || !res.siteId) {
      setBusy(false); setError(res.error ?? 'Something went wrong.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const entries = Object.entries(files);
    const extras = extraFiles.filter((x): x is { id: string; label: string; file: File } => x.id !== 'draft' && !!x.file);
    const total = entries.length + extras.length;
    const failed: string[] = [];
    let done = 0;
    for (const [code, p] of entries) {
      done++;
      setUploading(`Uploading ${p.file.name} (${done} of ${total})…`);
      try { await uploadDoc(res.siteId, code, p); } catch (e) { failed.push((e as Error).message); }
    }
    for (const x of extras) {
      done++;
      setUploading(`Uploading ${x.file.name} (${done} of ${total})…`);
      try { await uploadDoc(res.siteId, 'other', { file: x.file, number: x.label, validUntil: '' }); }
      catch (e) { failed.push((e as Error).message); }
    }

    setUploading(''); setBusy(false);
    setResult({ companyCode: res.companyCode!, siteCode: res.siteCode! });
    if (failed.length)
      setError(`Saved, but some documents did not upload: ${failed.join(' · ')}. Our team will follow up for them.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** A one-screen gate in front of the form itself — same URL, no route
   *  change, just what renders first. Sets expectations (what this does,
   *  how long it takes, what to have ready) before the eleven-step form
   *  starts, so nobody gets three sections in before realising they need
   *  their GST certificate. */
  if (!started) {
    return (
      <div className="card p-7 md:p-9" style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1 className="text-[22px] font-bold mb-2" style={{ letterSpacing: '-.01em' }}>
          Complete vendor onboarding
        </h1>
        <p className="text-[13.5px] mb-5" style={{ color: 'var(--muted)' }}>
          This form onboards your company onto the Fitsol / GreenFind vendor marketplace.
          Once submitted, our team reviews and verifies your details — after verification,
          you&apos;ll start receiving RFQs (requests for quotes) directly, so keep an eye on
          your <b>email and WhatsApp</b>.
        </p>

        <div className="card p-4 mb-4 flex items-center gap-3" style={{ background: 'var(--p50)', borderColor: 'var(--p100)' }}>
          <span className="text-[22px]">⏱️</span>
          <div>
            <div className="text-[13.5px] font-bold" style={{ color: 'var(--head)' }}>About 15–20 minutes</div>
            <div className="text-[12px]" style={{ color: 'var(--faint)' }}>Company, facility, contacts, banking, agreements and documents — in one sitting.</div>
          </div>
        </div>

        <div className="card p-4 mb-5" style={{ background: 'var(--surface-2)' }}>
          <div className="text-[13.5px] font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--head)' }}>
            <span className="text-[18px]">📄</span> Keep these documents ready to upload
          </div>
          <ul className="flex flex-col gap-2">
            {[
              ['GST certificate', 'Required', 'c-r'],
              ['PAN card', 'Required', 'c-r'],
              ['Udyam / MSME certificate', 'If MSME-registered', 'c-a'],
              ['Consent to Operate (CTO) certificate', 'Recycling & scrap trading only', 'c-a'],
              ['EPR / PWP registration certificate', 'Recycling & scrap trading only', 'c-a'],
            ].map(([label, note, cls]) => (
              <li key={label} className="flex items-center justify-between gap-3 text-[13px]">
                <span style={{ color: 'var(--head)' }}>{label}</span>
                <span className={`chip ${cls}`} style={{ whiteSpace: 'nowrap' }}>{note}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12px] mt-3" style={{ color: 'var(--faint)' }}>
            Good to also have, if available: a cancelled cheque, a signed NDA, and a company profile or brochure.
          </p>
        </div>

        <label className="flex items-start gap-2 text-[13.5px] mb-5" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={docsReady} onChange={e => setDocsReady(e.target.checked)}
                 style={{ width: 'auto', marginTop: 2 }} />
          I have these documents ready to upload.
        </label>

        <button type="button" className="btn btn-p w-full" disabled={!docsReady}
                style={!docsReady ? { opacity: .5, cursor: 'not-allowed' } : undefined}
                onClick={() => { setStarted(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
          Proceed to the form
        </button>

        <p className="text-[12.5px] text-center mt-4" style={{ color: 'var(--faint)' }}>
          In a hurry instead? Use the <a href="/onboard" style={{ color: 'var(--p600)', fontWeight: 600 }}>quick sign-up</a> and
          our team will follow up for the rest.
        </p>
      </div>
    );
  }

  if (result) {
    return (
      <div className="card p-8 text-center">
        <div className="text-[34px] mb-2">✓</div>
        <h1 className="text-[20px] font-bold mb-2">Thanks — everything is in.</h1>
        <p className="text-[13.5px]" style={{ color: 'var(--muted)' }}>
          Reference {result.siteCode} under company {result.companyCode}. Our team will review
          what you have submitted and be in touch.
        </p>
        {error && <div className="note a mt-4 text-left">{error}</div>}
      </div>
    );
  }

  const categoryPicker = (
    industryCats.length ? (
      <>
        <div className="flex gap-2 flex-wrap mb-4">
          {industryCats.map(c => (
            <button key={c.id} type="button" className={`chip ${pickedCats.includes(c.id) ? 'c-g tick' : 'c-n'}`}
                    style={{ padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
                    onClick={() => {
                      if (pickedCats.includes(c.id)) {
                        setPickedCats(p => p.filter(x => x !== c.id));
                        setPickedSubs(p => p.filter(sub => !c.subs.some(x => x.id === sub)));
                      } else setPickedCats(p => [...p, c.id]);
                    }}>{pickedCats.includes(c.id) && '✓ '}{c.label}</button>
          ))}
        </div>
        {pickedCats.map(id => {
          const c = industryCats.find(x => x.id === id);
          if (!c || !c.subs.length) return null;
          const n = c.subs.filter(x => pickedSubs.includes(x.id)).length;
          return (
            <div key={id} className="card p-4 mb-3" style={{ background: 'var(--surface-2)' }}>
              <div className="flex justify-between items-center gap-3 mb-3 flex-wrap">
                <span className="text-[13px] font-bold" style={{ color: 'var(--head)' }}>{c.label}</span>
                <span className={`chip ${n ? 'c-g' : 'c-r'}`}>{n}/{c.subs.length}</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {c.subs.map(s => (
                  <button key={s.id} type="button" className={`chip ${pickedSubs.includes(s.id) ? 'c-g tick' : 'c-n'}`}
                          style={{ padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }}
                          onClick={() => setPickedSubs(p => p.includes(s.id) ? p.filter(x => x !== s.id) : [...p, s.id])}>
                    {pickedSubs.includes(s.id) && '✓ '}{s.label}
                  </button>
                ))}
              </div>
              {!n && <div className="err mt-2">Pick at least one, or remove this service above.</div>}
            </div>
          );
        })}
      </>
    ) : (
      <p className="text-[13px]" style={{ color: 'var(--faint)' }}>No services are set up for this industry yet.</p>
    )
  );

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[24px] font-bold mb-2" style={{ letterSpacing: '-.01em' }}>Complete vendor onboarding</h1>
        <p className="text-[13.5px]" style={{ color: 'var(--muted)' }}>
          Every section our team would otherwise fill in with you — identity, address, banking,
          agreements, certificates, categories and documents. Move between sections freely with
          Back/Continue or the list alongside; only Submit itself checks everything is in. In a
          hurry instead? Use the <a href="/onboard" style={{ color: 'var(--p600)', fontWeight: 600 }}>quick sign-up</a> and
          our team will follow up for the rest.
        </p>
      </div>

      {error && <div className="note r mb-5">{error}</div>}
      {issues.length > 0 && (
        <div className="note a mb-5">
          <b>{issues.length} thing{issues.length === 1 ? '' : 's'} to fix:</b>
          <ul className="mt-2 ml-4 list-disc">
            {issues.map((p, i) => (
              <li key={i} className="mb-1">
                {p.text}{' '}
                <button type="button" onClick={() => go(steps.findIndex(s => s.id === p.step))}
                        style={{ color: 'var(--p600)', fontWeight: 600, textDecoration: 'underline' }}>
                  go to {steps.find(s => s.id === p.step)?.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid lg:grid-cols-[230px_1fr] gap-6 items-start">
        <aside className="card p-2 lg:sticky lg:top-24">
          {steps.map((s, i) => (
            <button key={s.id} type="button" onClick={() => go(i)}
                    className="w-full text-left flex gap-3 items-center px-3 py-2 rounded-lg"
                    style={i === step
                      ? { background: 'var(--p50)', color: 'var(--p700)', fontWeight: 700 }
                      : { color: 'var(--head)', cursor: 'pointer' }}>
              <span className="grid place-items-center rounded-full text-[11px] font-bold shrink-0"
                    style={{ width: 21, height: 21,
                             background: i === step ? 'var(--p500)' : 'var(--surface-2)',
                             color: i === step ? '#fff' : 'var(--faint)',
                             border: '1px solid ' + (i === step ? 'var(--p500)' : 'var(--line-2)') }}>
                {i + 1}
              </span>
              <span className="text-[13px] flex-1">{s.label}</span>
              {problemStepIds.has(s.id) && (
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--err)' }} title="Something here still needs fixing" />
              )}
            </button>
          ))}
        </aside>

        <main className="card p-6">
          <h2 className="text-[17px] font-bold mb-1">{current.label}</h2>

          {current.id === 'identity' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                Start with the GSTIN. The PAN sits inside it, which is how the company is recognised.
              </p>
              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="lab">GSTIN <span className="req">*</span></label>
                  <input value={gstin} maxLength={15} placeholder="08AYEPP3943P1ZK"
                         onChange={e => {
                           const v = e.target.value.toUpperCase();
                           setGstin(v);
                           const derived = panFromGstin(v);
                           if (derived) setPanNumber(derived);
                         }} />
                  {gstinBad && <div className="err">Fifteen characters: two-digit state code, ten-character PAN, then three more.</div>}
                </div>
                <div>
                  <label className="lab">PAN number <span className="req">*</span></label>
                  <input value={panNumber} maxLength={10} placeholder="AYEPP3943P"
                         onChange={e => setPanNumber(e.target.value.toUpperCase())} />
                  {pan && panNumber && panNumber !== pan && (
                    <div className="err">This does not match the PAN inside your GSTIN ({pan}).</div>
                  )}
                </div>
                <div>
                  <label className="lab">Industry type <span className="req">*</span></label>
                  <select value={industry} onChange={e => { setIndustry(e.target.value); setPickedCats([]); setPickedSubs([]); }}>
                    <option value="">Select…</option>
                    {INDUSTRIES.map(i => <option key={i.code} value={i.code}>{i.label}</option>)}
                  </select>
                </div>
              </div>

              <FieldGrid fields={sec('identity').fields.filter(f => !['pan', 'entity'].includes(f.key))}
                         values={company} onChange={(k, v) => setCompany(p => ({ ...p, [k]: v }))} />

              <div className="mt-5">
                {renderDocCard('gst')}
                {renderDocCard('pan')}
                {company.is_msme === true && renderDocCard('udyam')}
              </div>

              {industry && (
                <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--line)' }}>
                  <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-1" style={{ color: 'var(--p600)' }}>
                    Service category <span className="req">*</span>
                  </div>
                  <p className="text-[13px] mb-3" style={{ color: 'var(--faint)' }}>
                    Pick every service you&apos;re registered or set up for. Where a service has
                    sub-categories, pick at least one.
                  </p>
                  {categoryPicker}
                </div>
              )}
            </>
          )}

          {current.id === 'site' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                Where this plant is. A second plant is described below, not as a separate submission.
              </p>
              <FieldGrid fields={sec('site').fields.filter(f => !['gstin', 'industry', 'geo_outside_india'].includes(f.key))}
                         values={site} onChange={(k, v) => setSite(p => ({ ...p, [k]: v }))} />
              {gstState && !!site.state && gstState !== String(site.state) && (
                <div className="err">The GSTIN says {gstState}. These should match.</div>
              )}
              {pincodeStatus === 'loading' && <div className="hint">Looking up city and state from the pincode…</div>}
              {pincodeStatus === 'not_found' && <div className="err">That pincode was not found. Enter city and state yourself.</div>}

              {!sameAsRegistered && (
                <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--line)' }}>
                  <PlantBlocks plants={plants} onChange={setPlantField} />
                </div>
              )}
            </>
          )}

          {current.id === 'geography' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                Pick a region and its states appear, all selected. Untick anything you do not serve.
              </p>
              <div className="flex gap-2 flex-wrap mb-4">
                <button type="button" className={`chip ${geo.length === STATES.length ? 'c-g tick' : 'c-n'}`}
                        style={{ padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
                        onClick={() => {
                          if (geo.length === STATES.length) { setGeo([]); setOpenRegions([]); }
                          else { setGeo([...STATES]); setOpenRegions(REGIONS.map(r => r[0])); }
                        }}>{geo.length === STATES.length && '✓ '}Pan India</button>
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
                <button type="button" className={`chip ${geoOutsideIndia ? 'c-g tick' : 'c-n'}`}
                        style={{ padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
                        onClick={() => setGeoOutsideIndia(p => !p)}>
                  {geoOutsideIndia && '✓ '}Outside India
                </button>
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
            </>
          )}

          {current.id === 'contacts' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>Two are required.</p>
              {['Primary contact', 'Secondary contact', 'Other contact']
                .slice(0, showThirdContact ? 3 : 2)
                .map((title, i) => (
                <div key={i} className={i > 0 ? 'mt-6 pt-5 border-t' : ''} style={i > 0 ? { borderColor: 'var(--line)' } : undefined}>
                  <div className="text-[12px] font-bold mb-3" style={{ color: 'var(--head)' }}>
                    {title} {i < 2 && <span className="req">*</span>}
                  </div>
                  <div className="grid md:grid-cols-4 gap-4">
                    {(['name', 'designation', 'mobile', 'email'] as const).map(k => (
                      <div key={k}>
                        <label className="lab">
                          {k === 'name' ? 'Name' : k === 'designation' ? 'Designation' : k === 'mobile' ? 'Mobile number' : 'Email ID'}
                          {i < 2 && (k === 'name' || k === 'mobile') && <span className="req"> *</span>}
                        </label>
                        <input value={contacts[i][k]} maxLength={k === 'mobile' ? 10 : k === 'email' ? 255 : 100}
                               placeholder={k === 'mobile' ? '9414011223' : undefined}
                               onChange={e => setContacts(p => { const n = [...p]; n[i] = { ...n[i], [k]: e.target.value }; return n; })} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {!showThirdContact && (
                <button type="button" className="btn btn-o mt-5" onClick={() => setShowThirdContact(true)}>
                  + Add another contact
                </button>
              )}
            </>
          )}

          {current.id === 'operations' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                {sec(industry === 'transportation' ? 'fleet' : 'operations').blurb}
              </p>
              <FieldGrid fields={sec(industry === 'transportation' ? 'fleet' : 'operations').fields}
                         values={ops} onChange={(k, v) => setOps(p => ({ ...p, [k]: v }))} />
            </>
          )}

          {current.id === 'commercial' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>{sec('commercial').blurb}</p>
              <FieldGrid fields={sec('commercial').fields} values={company} onChange={(k, v) => setCompany(p => ({ ...p, [k]: v }))} />
            </>
          )}

          {current.id === 'banking' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>{sec('banking').blurb}</p>
              <FieldGrid fields={sec('banking').fields} values={company} onChange={(k, v) => setCompany(p => ({ ...p, [k]: v }))} />
              <div className="mt-5">{renderDocCard('cheque')}</div>
            </>
          )}

          {current.id === 'agreements' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>{sec('agreements').blurb}</p>
              <FieldGrid fields={sec('agreements').fields} values={company} onChange={(k, v) => setCompany(p => ({ ...p, [k]: v }))} />
              <div className="mt-5">{renderDocCard('nda')}</div>
            </>
          )}

          {current.id === 'cto' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                Read off the certificates. Everything here is optional now and can be filled in when the certificate arrives.
              </p>
              <FieldGrid fields={sec('cto').fields} values={certs} onChange={(k, v) => setCerts(p => ({ ...p, [k]: v }))} />
              <div className="mt-4">{renderDocCard('cto')}</div>
              <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--line)' }}>
                <FieldGrid fields={sec('epr').fields} values={certs} onChange={(k, v) => setCerts(p => ({ ...p, [k]: v }))} />
                <div className="mt-4">{renderDocCard('epr')}</div>
              </div>
            </>
          )}

          {current.id === 'documents' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                Most documents were already asked for on the section they belong to — here is
                anything left, plus anything extra. PDF, JPG or PNG, up to 10 MB each.
              </p>

              {docs.filter(d => CONTEXTUAL_DOC_CODES.includes(d.code)).length > 0 && (
                <div className="card p-4 mb-4" style={{ background: 'var(--surface-2)' }}>
                  <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-3"
                       style={{ color: 'var(--faint)' }}>Already asked for, elsewhere in this form</div>
                  <div className="grid gap-2">
                    {docs.filter(d => CONTEXTUAL_DOC_CODES.includes(d.code)).map(d => {
                      const ready = !!files[d.code];
                      const stepId = d.code === 'gst' || d.code === 'pan' || d.code === 'udyam' ? 'identity'
                        : d.code === 'cheque' ? 'banking' : d.code === 'nda' ? 'agreements' : d.code;
                      return (
                        <div key={d.code} className="flex items-center justify-between gap-3">
                          <span className="text-[13px]" style={{ color: 'var(--head)' }}>
                            {ready ? '✓ ' : '○ '}{d.label}
                          </span>
                          <button type="button" className="text-[12.5px] font-semibold"
                                  style={{ color: 'var(--p600)' }}
                                  onClick={() => go(steps.findIndex(s => s.id === stepId))}>
                            {ready ? 'View' : 'Go add it'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {docs.filter(d => !CONTEXTUAL_DOC_CODES.includes(d.code)).map(d => renderDocCard(d.code))}

              <div className="card p-4 mb-3">
                <div className="flex justify-between items-center gap-3 flex-wrap">
                  <div>
                    <div className="text-[13.5px] font-bold" style={{ color: 'var(--head)' }}>Anything else</div>
                    <div className="text-[12px]" style={{ color: 'var(--faint)' }}>ISO certificates, a rate card — whatever else is worth attaching.</div>
                  </div>
                  {!addingExtra && (
                    <button type="button" className="btn btn-o" onClick={() => setAddingExtra(true)}>+ Add a document</button>
                  )}
                </div>
                {extraFiles.map(x => (
                  <div key={x.id} className="flex items-center justify-between gap-3 mt-3 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
                    <span className="text-[13px]" style={{ color: 'var(--head)' }}>
                      {x.label}{x.file && <span style={{ color: 'var(--faint)' }}> · {x.file.name}</span>}
                    </span>
                    <button type="button" className="text-[12.5px] font-semibold" style={{ color: 'var(--err)' }}
                            onClick={() => setExtraFiles(p => p.filter(e => e.id !== x.id))}>Remove</button>
                  </div>
                ))}
                {addingExtra && (
                  <div className="grid md:grid-cols-3 gap-4 mt-4 pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
                    <div className="md:col-span-2">
                      <label className="lab">What document is this?</label>
                      <input placeholder="e.g. ISO 14001 certificate"
                             value={extraFiles.find(x => x.id === 'draft')?.label ?? ''}
                             onChange={e => setExtraFiles(p => {
                               const rest = p.filter(x => x.id !== 'draft');
                               return [...rest, { id: 'draft', label: e.target.value, file: p.find(x => x.id === 'draft')?.file ?? null }];
                             })} />
                    </div>
                    <div>
                      <label className="lab">File</label>
                      <label className="file-drop">
                        <div className="file-drop-icon">📄</div>
                        <div className="file-drop-label">
                          {extraFiles.find(x => x.id === 'draft')?.file ? extraFiles.find(x => x.id === 'draft')!.file!.name : 'Click to upload a file'}
                        </div>
                        <div className="file-drop-sub">
                          {extraFiles.find(x => x.id === 'draft')?.file
                            ? `${(extraFiles.find(x => x.id === 'draft')!.file!.size / 1024).toFixed(0)} KB — click to replace`
                            : 'PDF, JPG or PNG · up to 10 MB'}
                        </div>
                        <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" className="sr-only"
                               onChange={e => {
                                 const f = e.target.files?.[0] ?? null;
                                 if (f) {
                                   const err = fileValidationError(f, MAX_FILE_BYTES_DIRECT);
                                   setFileErrors(p => ({ ...p, extra: err ?? '' }));
                                   if (err) { e.target.value = ''; return; }
                                 } else setFileErrors(p => ({ ...p, extra: '' }));
                                 setExtraFiles(p => {
                                   const rest = p.filter(x => x.id !== 'draft');
                                   return [...rest, { id: 'draft', label: p.find(x => x.id === 'draft')?.label ?? '', file: f }];
                                 });
                               }} />
                      </label>
                      {fileErrors.extra && <div className="err mt-1">{fileErrors.extra}</div>}
                    </div>
                    <div className="md:col-span-3 flex gap-3">
                      <button type="button" className="btn btn-p"
                              disabled={!extraFiles.find(x => x.id === 'draft')?.label.trim() || !extraFiles.find(x => x.id === 'draft')?.file}
                              onClick={() => {
                                const draft = extraFiles.find(x => x.id === 'draft');
                                if (!draft?.label.trim() || !draft.file) return;
                                setExtraFiles(p => [...p.filter(x => x.id !== 'draft'),
                                  { id: `extra_${Date.now()}`, label: draft.label.trim(), file: draft.file }]);
                                setAddingExtra(false);
                              }}>Add</button>
                      <button type="button" className="btn btn-o"
                              onClick={() => { setExtraFiles(p => p.filter(x => x.id !== 'draft')); setAddingExtra(false); }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {current.id === 'review' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                A last look before this is sent to our team.
              </p>
              <div className="grid md:grid-cols-2 gap-4 mb-5">
                {[
                  ['Company', String(company.legal_name ?? '—')],
                  ['GSTIN', gstin || '—'],
                  ['Industry', INDUSTRIES.find(i => i.code === industry)?.label ?? '—'],
                  ['Address', [site.address_line1, site.city, site.state, site.pincode].filter(Boolean).join(', ') || '—'],
                  ['Contacts', contacts.filter(c => c.name.trim()).map(c => c.name).join(', ') || '—'],
                  ['Serviceable states', geoOutsideIndia ? 'Outside India' : geo.length ? `${geo.length} selected` : '—'],
                  ['Service categories', pickedCats.length ? industryCats.filter(c => pickedCats.includes(c.id)).map(c => c.label).join(', ') : '—'],
                  ['Documents ready', (Object.keys(files).length + extraFiles.filter(x => x.id !== 'draft').length) > 0
                    ? `${Object.keys(files).length + extraFiles.filter(x => x.id !== 'draft').length} file${(Object.keys(files).length + extraFiles.filter(x => x.id !== 'draft').length) === 1 ? '' : 's'}`
                    : 'None yet'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[10.5px] font-bold uppercase tracking-[.07em]" style={{ color: 'var(--faint)' }}>{k}</div>
                    <div className="text-[13.5px] font-medium" style={{ color: 'var(--head)' }}>{v}</div>
                  </div>
                ))}
              </div>

              <div className="pt-5 border-t" style={{ borderColor: 'var(--line)' }}>
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
                <label className="flex items-start gap-2 text-[13px] mb-4" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={firstTime} onChange={e => setFirstTime(e.target.checked)}
                         style={{ width: 'auto', marginTop: 2 }} />
                  This is the first time we are doing business with Fitsol.
                </label>
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
            </>
          )}

          <div className="flex justify-between gap-3 mt-6 pt-5 border-t flex-wrap" style={{ borderColor: 'var(--line)' }}>
            <button type="button" className="btn btn-o" onClick={() => go(step - 1)}
                    disabled={step === 0} style={step === 0 ? { opacity: .4 } : undefined}>
              Back
            </button>
            {current.id === 'review' ? (
              <button type="button" className="btn btn-p" onClick={submit} disabled={busy}>
                {(busy || uploading) && <span className="spinner" aria-hidden="true" />}
                {uploading || (busy ? 'Submitting…' : 'Submit')}
              </button>
            ) : (
              <button type="button" className="btn btn-p" onClick={() => go(step + 1)}>Continue</button>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
