'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import FieldGrid from '../FieldGrid';
import { SECTIONS, type Field } from '@/lib/schema';
import { REGIONS, STATES, RX, panFromGstin, stateFromGstin } from '@/lib/constants';
import { createVendor, lookupCompany, type LookupResult } from './actions';
import { uploadDocument } from '../[id]/documentActions';

export type Cat = { id: string; industry: string; code: string; label: string;
                    subs: { id: string; label: string }[] };

export type DocRule = {
  industry: string; level: string; code: string; label: string;
  applies_to: string | null; expiry_tracked: boolean;
  uploaded_by_party: string; sort: number;
};

/** A file chosen during the wizard. Held in the browser until the vendor
 *  exists, because a document needs a site to belong to. */
type Pending = { file: File; number: string; validUntil: string };

type Vals = Record<string, unknown>;
const sec = (id: string) => SECTIONS.find(s => s.id === id)!;
const blank = { name: '', designation: '', mobile: '', email: '' };

export default function Wizard({ cats, docRules }: { cats: Cat[]; docRules: DocRule[] }) {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [company, setCompany] = useState<Vals>({ is_msme: false });
  const [site, setSite] = useState<Vals>({ is_registered_address: true });
  const [ops, setOps] = useState<Vals>({});
  const [certs, setCerts] = useState<Vals>({});
  const [contacts, setContacts] = useState([{ ...blank }, { ...blank }, { ...blank }]);
  const [geo, setGeo] = useState<string[]>([]);
  const [openRegions, setOpenRegions] = useState<string[]>([]);
  const [pickedCats, setPickedCats] = useState<string[]>([]);
  const [pickedSubs, setPickedSubs] = useState<string[]>([]);
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [linkTo, setLinkTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [files, setFiles] = useState<Record<string, Pending>>({});
  const [uploading, setUploading] = useState('');

  const gstin = String(site.gstin ?? '');
  const pan = panFromGstin(gstin);
  const gstState = stateFromGstin(gstin);
  const gstinBad = gstin.length > 0 && !RX.gstin.test(gstin.toUpperCase());
  const industry = String(site.industry ?? '');
  const linked = !!linkTo;
  // Narrowed once, so the union does not have to be re-checked at every use.
  const parent = lookup && lookup.found ? lookup : null;

  // The PAN lives inside the GSTIN, so the company can be found without asking.
  useEffect(() => {
    if (!pan) { setLookup(null); setLinkTo(null); return; }
    let dead = false;
    lookupCompany(gstin).then(r => { if (!dead) { setLookup(r); if (!r.found) setLinkTo(null); } });
    return () => { dead = true; };
  }, [pan, gstin]);

  useEffect(() => { if (gstState && !site.state) setSite(p => ({ ...p, state: gstState })); },
            [gstState, site.state]);

  const industryCats = useMemo(() => cats.filter(c => c.industry === industry), [cats, industry]);

  // Before an industry is chosen, show the ones common to all three — the GST
  // certificate, PAN and cancelled cheque are needed whatever the vendor does.
  const docs = useMemo(() => {
    if (industry) return docRules.filter(d => d.industry === industry);
    const counts = new Map<string, number>();
    docRules.forEach(d => counts.set(d.code, (counts.get(d.code) ?? 0) + 1));
    const seen = new Set<string>();
    return docRules.filter(d => {
      if (counts.get(d.code) !== 3 || seen.has(d.code)) return false;
      seen.add(d.code); return true;
    });
  }, [docRules, industry]);

  const steps = useMemo(() => {
    const list = [
      { id: 'identity', label: 'Identity and registration' },
      { id: 'site', label: 'Address' },
      { id: 'geography', label: 'Geography' },
      { id: 'contacts', label: 'Contacts' },
    ];
    if (industry === 'transportation') list.push({ id: 'fleet', label: 'Fleet' });
    else if (industry) list.push({ id: 'operations', label: 'Operations' });
    list.push({ id: 'commercial', label: 'Commercial' });
    list.push({ id: 'banking', label: 'Banking' });
    list.push({ id: 'agreements', label: 'Agreements' });
    if (industry === 'recycling') {
      list.push({ id: 'cto', label: 'Consent to Operate' });
      list.push({ id: 'epr', label: 'EPR registration' });
    }
    list.push({ id: 'documents', label: 'Documents' });
    list.push({ id: 'review', label: 'Review and create' });
    return list;
  }, [industry]);

  const current = steps[Math.min(step, steps.length - 1)];

  /* ---------- Problems, gathered but never blocking ----------
     You can move around freely and fill things in any order. Everything is
     checked once, at the end, and each problem says which step it is on. */
  const problems = (): { step: number; text: string }[] => {
    const at = (id: string) => steps.findIndex(s => s.id === id);
    const out: { step: number; text: string }[] = [];

    if (!pan) out.push({ step: at('identity'), text: 'Enter a valid GSTIN.' });
    if (!industry) out.push({ step: at('identity'), text: 'Choose an industry type.' });
    if (!linked && !company.legal_name)
      out.push({ step: at('identity'), text: 'Legal name is required.' });
    if (!linked && company.is_msme === true && (!company.msme_category || !company.udyam_number))
      out.push({ step: at('identity'), text: 'An MSME needs an enterprise category and a Udyam number.' });

    if (!site.address_line1) out.push({ step: at('site'), text: 'Address is required.' });
    if (!site.city) out.push({ step: at('site'), text: 'City is required.' });
    if (!site.state) out.push({ step: at('site'), text: 'State is required.' });
    if (!RX.pincode.test(String(site.pincode ?? '')))
      out.push({ step: at('site'), text: 'Pincode must be six digits and cannot start with zero.' });

    if (!contacts[0].name.trim())
      out.push({ step: at('contacts'), text: 'The primary contact needs a name.' });
    if (!contacts[1].name.trim())
      out.push({ step: at('contacts'), text: 'The secondary contact needs a name.' });

    for (const id of pickedCats) {
      const c = industryCats.find(x => x.id === id);
      if (c && c.subs.length && !c.subs.some(x => pickedSubs.includes(x.id)))
        out.push({ step: at('identity'),
                   text: `${c.label}: pick at least one sub-category, or remove the category.` });
    }

    const ifsc = String(company.ifsc ?? '');
    if (ifsc && !RX.ifsc.test(ifsc.toUpperCase()))
      out.push({ step: at('banking'), text: 'IFSC must be eleven characters, like HDFC0000432.' });

    return out;
  };

  const [issues, setIssues] = useState<{ step: number; text: string }[]>([]);

  /* Any step, any order. Nothing is gated. */
  const go = (i: number) => {
    setError(''); setStep(Math.max(0, Math.min(i, steps.length - 1)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const next = () => go(step + 1);
  const back = () => go(step - 1);

  const submit = async () => {
    const found = problems();
    if (found.length) {
      setIssues(found);
      setError(`${found.length} thing${found.length === 1 ? '' : 's'} still to fix before this can be created.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setIssues([]);
    setBusy(true); setError('');
    const res = await createVendor({
      linkCompanyId: linkTo,
      company: linked ? {} : company,
      site, operations: ops, certificates: certs,
      contacts: contacts.map((c, i) => ({ ...c, rank: i + 1 })),
      geography: geo, categories: pickedCats, subcategories: pickedSubs,
    });
    if (res.error) { setBusy(false); setError(res.error); return; }

    // The vendor exists now, so the held files finally have somewhere to go.
    const entries = Object.entries(files);
    const failed: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const [code, f] = entries[i];
      setUploading(`Uploading ${f.file.name} (${i + 1} of ${entries.length})…`);
      const fd = new FormData();
      fd.set('site_id', res.siteId!);
      fd.set('doc_type', code);
      fd.set('file', f.file);
      fd.set('doc_number', f.number);
      fd.set('valid_until', f.validUntil);
      const up = await uploadDocument({}, fd);
      if (up.error) failed.push(`${code}: ${up.error}`);
    }
    setUploading('');
    setBusy(false);

    if (failed.length) {
      setError('The vendor was created, but some documents did not upload: '
        + failed.join(' · ') + '. Add them from the record.');
      setTimeout(() => router.push(`/vendors/${res.siteId}`), 4000);
      return;
    }
    router.push(`/vendors/${res.siteId}`);
  };

  /* ---------- registration step fields ---------- */
  const regFields: Field[] = [
    { key: 'gstin', label: 'GSTIN', type: 'text', required: true, max: 15,
      placeholder: '08AYEPP3943P1ZK',
      hint: 'The PAN sits inside it, which is how the company is recognised.' },
    { key: 'industry', label: 'Industry type', type: 'select', required: true, half: true,
      options: sec('site').fields.find(f => f.key === 'industry')!.options },
    { key: 'site_name', label: 'Site name', type: 'text', max: 120, half: true,
      placeholder: 'Khushkhera Unit' },
  ];

  const toggleRegion = (code: string, sts: string[]) => {
    if (openRegions.includes(code)) {
      setOpenRegions(p => p.filter(r => r !== code));
      setGeo(p => p.filter(s => !sts.includes(s)));
    } else {
      setOpenRegions(p => [...p, code]);
      setGeo(p => [...new Set([...p, ...sts])]);
    }
  };

  const categoryPicker = (
    industryCats.length ? (
      <>
        <div className="flex gap-2 flex-wrap mb-4">
          {industryCats.map(c => (
            <button key={c.id} type="button"
                    className={`chip ${pickedCats.includes(c.id) ? 'c-g' : 'c-n'}`}
                    style={{ padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
                    onClick={() => {
                      if (pickedCats.includes(c.id)) {
                        setPickedCats(p => p.filter(x => x !== c.id));
                        setPickedSubs(p => p.filter(sub => !c.subs.some(x => x.id === sub)));
                      } else setPickedCats(p => [...p, c.id]);
                    }}>{c.label}</button>
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
                {c.subs.map(sub => (
                  <button key={sub.id} type="button"
                          className={`chip ${pickedSubs.includes(sub.id) ? 'c-g' : 'c-n'}`}
                          style={{ padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }}
                          onClick={() => setPickedSubs(p =>
                            p.includes(sub.id) ? p.filter(x => x !== sub.id) : [...p, sub.id])}>
                    {sub.label}
                  </button>
                ))}
              </div>
              {!n && <div className="err mt-2">Pick at least one, or remove the category.</div>}
            </div>
          );
        })}
        {pickedCats.some(id => {
          const c = industryCats.find(x => x.id === id);
          return c && !c.subs.length;
        }) && (
          <div className="hint">
            Categories with no sub-categories are complete on their own — those lists
            have not been supplied yet.
          </div>
        )}
      </>
    ) : (
      <div className="note a">
        No categories are set up for this industry yet. Run <b>03_reference_data.sql</b>
        in Supabase, then reload this page.
      </div>
    )
  );

  return (
    <>
      <Link href="/vendors" className="text-[13px] font-semibold"
            style={{ color: 'var(--faint)' }}>← All vendors</Link>
      <h1 className="text-[26px] font-bold mt-2 mb-1">Add a vendor</h1>
      <p className="text-[13.5px] mb-6" style={{ color: 'var(--faint)' }}>
        One record per site. Step {step + 1} of {steps.length}.
      </p>

      <div className="grid lg:grid-cols-[230px_1fr] gap-6 items-start">
        <aside className="card p-2 lg:sticky lg:top-24">
          {steps.map((s, i) => (
            <button key={s.id} type="button"
                    onClick={() => go(i)}
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
              <span className="text-[13px]">{s.label}</span>
            </button>
          ))}
        </aside>

        <main className="card p-6">
          <h2 className="text-[17px] font-bold mb-1">{current.label}</h2>
          {error && <div className="note r my-4">{error}</div>}
          {issues.length > 0 && (
            <div className="note a mb-4">
              <b>Still to fix:</b>
              <ul className="mt-2 ml-4 list-disc">
                {issues.map((p, i) => (
                  <li key={i} className="mb-1">
                    {p.text}{' '}
                    <button type="button" onClick={() => go(p.step)}
                            style={{ color: 'var(--p600)', fontWeight: 600,
                                     textDecoration: 'underline' }}>
                      go to {steps[p.step]?.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {current.id === 'identity' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                Start with the GSTIN. The PAN sits inside it, which is how the company
                is recognised, and the industry decides which steps follow.
              </p>

              <FieldGrid fields={regFields} values={site}
                         onChange={(k, v) => setSite(p => ({ ...p, [k]: k === 'gstin'
                           ? String(v).toUpperCase() : v }))} />
              {gstinBad && <div className="err">Fifteen characters: two-digit state code, ten-character PAN, then three more.</div>}
              {pan && !gstinBad && (
                <div className="hint">PAN <b>{pan}</b>{gstState && <> · {gstState}</>}</div>
              )}

              {parent && (
                <div className="note a mt-4">
                  <b>{parent.legal_name}</b> ({parent.company_code}) is already on record
                  under this PAN, with {parent.site_count} site{parent.site_count === 1 ? '' : 's'}.
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <button type="button" className={`btn ${linked ? 'btn-p' : 'btn-o'}`}
                            onClick={() => setLinkTo(parent.id)}>
                      {linked ? '✓ Linking as another site' : 'Link as another site'}
                    </button>
                    <button type="button" className={`btn ${!linked ? 'btn-p' : 'btn-o'}`}
                            onClick={() => setLinkTo(null)}>
                      This is a different company
                    </button>
                  </div>
                </div>
              )}

              {industry && (
                <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--line)' }}>
                  <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-1"
                       style={{ color: 'var(--p600)' }}>Service category</div>
                  <p className="text-[13px] mb-3" style={{ color: 'var(--faint)' }}>
                    What this site is registered or set up for. Where a category has
                    sub-categories, pick at least one.
                  </p>
                  {categoryPicker}
                </div>
              )}

              {linked ? (
                <div className="note mt-5">
                  <b>Company details come from {parent?.company_code}.</b> Identity,
                  banking and agreements already exist and are shared by every site.
                  Edit them on any of that company&apos;s records and all of them see it.
                </div>
              ) : (
                <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--line)' }}>
                  <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-3"
                       style={{ color: 'var(--p600)' }}>Company</div>
                  <FieldGrid
                    fields={sec('identity').fields.filter(f => f.key !== 'pan')}
                    values={company}
                    onChange={(k, v) => setCompany(p => ({ ...p, [k]: v }))} />
                  <div className="hint mt-3">PAN will be {pan ?? 'taken from the GSTIN'}.</div>
                </div>
              )}
            </>
          )}

          {current.id === 'site' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                Where this plant is. A second plant becomes a second linked record.
              </p>
              <FieldGrid
                fields={sec('site').fields.filter(f =>
                  !['gstin', 'industry', 'geo_outside_india'].includes(f.key))}
                values={site} onChange={(k, v) => setSite(p => ({ ...p, [k]: v }))} />
              {gstState && site.state && gstState !== site.state && (
                <div className="err">The GSTIN says {gstState}. These should match.</div>
              )}
            </>
          )}

          {current.id === 'geography' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                Pick a region and its states appear, all selected. Untick anything this
                site does not serve.
              </p>
              <div className="flex gap-2 flex-wrap mb-4">
                <button type="button"
                        className={`chip ${geo.length === STATES.length ? 'c-g' : 'c-n'}`}
                        style={{ padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
                        onClick={() => {
                          if (geo.length === STATES.length) { setGeo([]); setOpenRegions([]); }
                          else { setGeo([...STATES]); setOpenRegions(REGIONS.map(r => r[0])); }
                        }}>Pan India</button>
                {REGIONS.map(([code, label, sts]) => {
                  const on = openRegions.includes(code);
                  const n = sts.filter(s => geo.includes(s)).length;
                  return (
                    <button key={code} type="button"
                            className={`chip ${on ? 'c-g' : 'c-n'}`}
                            style={{ padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
                            onClick={() => toggleRegion(code, sts)}>
                      {label}{on && ` · ${n}/${sts.length}`}
                    </button>
                  );
                })}
                <button type="button"
                        className={`chip ${site.geo_outside_india === true ? 'c-g' : 'c-n'}`}
                        style={{ padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
                        onClick={() => setSite(p => ({ ...p,
                          geo_outside_india: p.geo_outside_india === true ? false : true }))}>
                  Outside India
                </button>
              </div>
              {openRegions.map(code => {
                const r = REGIONS.find(x => x[0] === code);
                if (!r) return null;
                return (
                  <div key={code} className="card p-4 mb-3" style={{ background: 'var(--surface-2)' }}>
                    <div className="text-[13px] font-bold mb-3" style={{ color: 'var(--head)' }}>{r[1]}</div>
                    <div className="flex gap-2 flex-wrap">
                      {r[2].map(s => (
                        <button key={s} type="button"
                                className={`chip ${geo.includes(s) ? 'c-g' : 'c-n'}`}
                                style={{ padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }}
                                onClick={() => setGeo(p =>
                                  p.includes(s) ? p.filter(x => x !== s) : [...p, s])}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div className="hint">{geo.length} of {STATES.length} states selected.</div>
            </>
          )}

          {current.id === 'contacts' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                Two are required. A third is there if you have one.
              </p>
              {['Primary contact', 'Secondary contact', 'Other contact'].map((title, i) => (
                <div key={i} className={i > 0 ? 'mt-6 pt-5 border-t' : ''}
                     style={i > 0 ? { borderColor: 'var(--line)' } : undefined}>
                  <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-3"
                       style={{ color: 'var(--p600)' }}>
                    {title} {i < 2 && <span className="req">*</span>}
                  </div>
                  <div className="grid md:grid-cols-4 gap-4">
                    {(['name', 'designation', 'mobile', 'email'] as const).map(k => (
                      <div key={k}>
                        <label className="lab" htmlFor={`c${i}_${k}`}>
                          {k === 'name' ? 'Name' : k === 'designation' ? 'Designation'
                           : k === 'mobile' ? 'Mobile' : 'Email'}
                        </label>
                        <input id={`c${i}_${k}`} value={contacts[i][k]}
                               maxLength={k === 'mobile' ? 10 : k === 'email' ? 255 : 100}
                               onChange={e => setContacts(p => {
                                 const n = [...p]; n[i] = { ...n[i], [k]: e.target.value }; return n;
                               })} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {(current.id === 'operations' || current.id === 'fleet') && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                {sec(current.id).blurb}
              </p>
              <FieldGrid fields={sec(current.id).fields} values={ops}
                         onChange={(k, v) => setOps(p => ({ ...p, [k]: v }))} />
            </>
          )}

          {['commercial', 'banking', 'agreements'].includes(current.id) && (
            linked && current.id !== 'commercial' ? (
              <div className="note">
                <b>Skipped.</b> {sec(current.id).label} belongs to the company, and this
                site is linked to {parent?.company_code}, which already has it.
              </div>
            ) : (
              <>
                <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                  {sec(current.id).blurb}
                </p>
                <FieldGrid fields={sec(current.id).fields} values={company}
                           onChange={(k, v) => setCompany(p => ({ ...p, [k]: v }))} />
              </>
            )
          )}

          {['cto', 'epr'].includes(current.id) && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                {sec(current.id).blurb} Everything here is optional now and can be
                filled in when the certificate arrives.
              </p>
              <FieldGrid fields={sec(current.id).fields} values={certs}
                         onChange={(k, v) => setCerts(p => ({ ...p, [k]: v }))} />
            </>
          )}

          {current.id === 'documents' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                Attach what you have. Anything missing can be added on the record
                afterwards — none of this blocks creating the vendor. PDF, JPG or PNG,
                up to 10 MB each.
              </p>

              {docs.map(d => {
                const chosen = files[d.code];
                return (
                  <div key={d.code} className="card p-4 mb-3"
                       style={chosen ? { borderColor: 'var(--p400)', background: 'var(--p50)' } : undefined}>
                    <div className="flex justify-between items-start gap-3 mb-3 flex-wrap">
                      <div>
                        <div className="text-[13.5px] font-bold" style={{ color: 'var(--head)' }}>
                          {d.label}
                        </div>
                        <div className="text-[12px]" style={{ color: 'var(--faint)' }}>
                          {d.applies_to}
                          {d.expiry_tracked && ' · expiry tracked'}
                          {d.uploaded_by_party === 'fitsol' && ' · issued by Fitsol, usually added later'}
                        </div>
                      </div>
                      <span className={`chip ${d.level === 'required' ? 'c-r'
                        : d.level === 'conditional' ? 'c-a' : 'c-n'}`}>
                        {d.level.toUpperCase()}
                      </span>
                    </div>

                    <div className="grid md:grid-cols-3 gap-4">
                      <div className={d.expiry_tracked ? '' : 'md:col-span-2'}>
                        <label className="lab" htmlFor={`wf_${d.code}`}>File</label>
                        <input id={`wf_${d.code}`} type="file"
                               accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
                               onChange={e => {
                                 const f = e.target.files?.[0];
                                 setFiles(p => {
                                   const n = { ...p };
                                   if (f) n[d.code] = { file: f,
                                     number: p[d.code]?.number ?? '',
                                     validUntil: p[d.code]?.validUntil ?? '' };
                                   else delete n[d.code];
                                   return n;
                                 });
                               }} />
                      </div>
                      <div>
                        <label className="lab" htmlFor={`wn_${d.code}`}>Document number</label>
                        <input id={`wn_${d.code}`} maxLength={60} placeholder="As printed on it"
                               value={chosen?.number ?? ''}
                               onChange={e => setFiles(p => chosen
                                 ? { ...p, [d.code]: { ...chosen, number: e.target.value } } : p)} />
                      </div>
                      {d.expiry_tracked && (
                        <div>
                          <label className="lab" htmlFor={`wv_${d.code}`}>Valid until</label>
                          <input id={`wv_${d.code}`} type="date"
                                 value={chosen?.validUntil ?? ''}
                                 onChange={e => setFiles(p => chosen
                                   ? { ...p, [d.code]: { ...chosen, validUntil: e.target.value } } : p)} />
                        </div>
                      )}
                    </div>

                    {chosen && (
                      <div className="hint mt-2">
                        {chosen.file.name} · {(chosen.file.size / 1024).toFixed(0)} KB, ready to upload
                      </div>
                    )}
                  </div>
                );
              })}

              {!docs.length && (
                <div className="note a">
                  No document rules are set up. Run <b>03_reference_data.sql</b> in Supabase.
                </div>
              )}

              {!industry && (
                <div className="note">
                  Showing the documents every vendor needs. Choose an industry type in
                  step 1 and any extra ones for it appear here too.
                </div>
              )}
            </>
          )}

          {current.id === 'review' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                A last look before this is written to the database.
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                {[
                  ['Company', linked ? `${parent?.legal_name} (linked)` : String(company.legal_name ?? '—')],
                  ['GSTIN', gstin || '—'],
                  ['PAN', pan ?? '—'],
                  ['Industry', String(site.industry ?? '—')],
                  ['Address', [site.address_line1, site.city, site.state, site.pincode]
                    .filter(Boolean).join(', ') || '—'],
                  ['Contacts', contacts.filter(c => c.name.trim()).map(c => c.name).join(', ') || '—'],
                  ['Serviceable states', geo.length ? `${geo.length} selected` : '—'],
                  ['Service categories', pickedCats.length
                    ? industryCats.filter(c => pickedCats.includes(c.id)).map(c => c.label).join(', ')
                    : '—'],
                  ['Documents ready', Object.keys(files).length
                    ? `${Object.keys(files).length} file${Object.keys(files).length === 1 ? '' : 's'}`
                    : 'None yet'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[10.5px] font-bold uppercase tracking-[.07em]"
                         style={{ color: 'var(--faint)' }}>{k}</div>
                    <div className="text-[13.5px] font-medium" style={{ color: 'var(--head)' }}>{v}</div>
                  </div>
                ))}
              </div>
              <div className="note mt-5">
                Anything left blank can be filled in on the record afterwards. Nothing
                here is a one-time chance.
              </div>
            </>
          )}

          <div className="flex justify-between gap-3 mt-6 pt-5 border-t flex-wrap"
               style={{ borderColor: 'var(--line)' }}>
            <button type="button" className="btn btn-o" onClick={back}
                    disabled={step === 0} style={step === 0 ? { opacity: .4 } : undefined}>
              Back
            </button>
            <div className="flex gap-3 flex-wrap">
              {current.id !== 'review' && (
                <button type="button" className="btn btn-o" onClick={() => go(steps.length - 1)}>
                  Skip to review
                </button>
              )}
              {current.id === 'review' ? (
                <button type="button" className="btn btn-p" onClick={submit} disabled={busy}>
                  {uploading || (busy ? 'Creating…' : 'Create vendor')}
                </button>
              ) : (
                <button type="button" className="btn btn-p" onClick={next}>Continue</button>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
