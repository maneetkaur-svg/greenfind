'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import FieldGrid from '../FieldGrid';
import { SECTIONS, type Field } from '@/lib/schema';
import { REGIONS, STATES, RX, panFromGstin, stateFromGstin } from '@/lib/constants';
import { createVendor, lookupCompany, type LookupResult } from './actions';

export type Cat = { id: string; industry: string; code: string; label: string;
                    subs: { id: string; label: string }[] };

type Vals = Record<string, unknown>;
const sec = (id: string) => SECTIONS.find(s => s.id === id)!;
const blank = { name: '', designation: '', mobile: '', email: '' };

export default function Wizard({ cats }: { cats: Cat[] }) {
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

  const steps = useMemo(() => {
    const list = [
      { id: 'registration', label: 'Registration' },
      { id: 'identity', label: 'Identity' },
      { id: 'site', label: 'Address' },
      { id: 'geography', label: 'Geography' },
      { id: 'contacts', label: 'Contacts' },
      { id: 'categories', label: 'Service categories' },
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
    list.push({ id: 'review', label: 'Review and create' });
    return list;
  }, [industry]);

  const current = steps[Math.min(step, steps.length - 1)];

  /* ---------- what blocks moving on ---------- */
  const blocker = (): string | null => {
    if (current.id === 'registration') {
      if (!pan) return 'Enter a valid GSTIN.';
      if (!industry) return 'Choose an industry type.';
    }
    if (current.id === 'identity' && !linked && !company.legal_name)
      return 'Legal name is required.';
    if (current.id === 'identity' && !linked && company.is_msme === true
        && (!company.msme_category || !company.udyam_number))
      return 'An MSME needs an enterprise category and a Udyam number.';
    if (current.id === 'site') {
      if (!site.address_line1) return 'Address is required.';
      if (!site.city) return 'City is required.';
      if (!site.state) return 'State is required.';
      if (!RX.pincode.test(String(site.pincode ?? ''))) return 'Pincode must be six digits.';
    }
    if (current.id === 'contacts') {
      if (!contacts[0].name.trim()) return 'The primary contact needs a name.';
      if (!contacts[1].name.trim()) return 'The secondary contact needs a name.';
    }
    if (current.id === 'categories') {
      for (const id of pickedCats) {
        const c = industryCats.find(x => x.id === id);
        if (c && c.subs.length && !c.subs.some(s => pickedSubs.includes(s.id)))
          return `${c.label}: pick at least one sub-category, or remove the category.`;
      }
    }
    if (current.id === 'banking') {
      const ifsc = String(company.ifsc ?? '');
      if (ifsc && !RX.ifsc.test(ifsc.toUpperCase()))
        return 'IFSC must be eleven characters, like HDFC0000432.';
    }
    return null;
  };

  const next = () => {
    const b = blocker();
    if (b) { setError(b); return; }
    setError(''); setStep(s => Math.min(s + 1, steps.length - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const back = () => { setError(''); setStep(s => Math.max(0, s - 1)); };

  const submit = async () => {
    setBusy(true); setError('');
    const res = await createVendor({
      linkCompanyId: linkTo,
      company: linked ? {} : company,
      site, operations: ops, certificates: certs,
      contacts: contacts.map((c, i) => ({ ...c, rank: i + 1 })),
      geography: geo, categories: pickedCats, subcategories: pickedSubs,
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
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
                    onClick={() => { if (i < step) { setError(''); setStep(i); } }}
                    className="w-full text-left flex gap-3 items-center px-3 py-2 rounded-lg"
                    style={i === step
                      ? { background: 'var(--p50)', color: 'var(--p700)', fontWeight: 700 }
                      : { color: i < step ? 'var(--head)' : 'var(--faint)',
                          cursor: i < step ? 'pointer' : 'default' }}>
              <span className="grid place-items-center rounded-full text-[11px] font-bold shrink-0"
                    style={{ width: 21, height: 21,
                             background: i < step ? 'var(--p100)' : i === step ? 'var(--p500)' : 'var(--surface-2)',
                             color: i === step ? '#fff' : i < step ? 'var(--p700)' : 'var(--faint)' }}>
                {i < step ? '✓' : i + 1}
              </span>
              <span className="text-[13px]">{s.label}</span>
            </button>
          ))}
        </aside>

        <main className="card p-6">
          <h2 className="text-[17px] font-bold mb-1">{current.label}</h2>
          {error && <div className="note r my-4">{error}</div>}

          {current.id === 'registration' && (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                Start here. The GSTIN decides which company this belongs to, and the
                industry decides which steps follow.
              </p>
              <FieldGrid fields={regFields} values={site}
                         onChange={(k, v) => setSite(p => ({ ...p, [k]: k === 'gstin'
                           ? String(v).toUpperCase() : v }))} />
              {gstinBad && <div className="err">Fifteen characters: two-digit state code, ten-character PAN, then three more.</div>}
              {pan && !gstinBad && (
                <div className="hint">PAN <b>{pan}</b>{gstState && <> · {gstState}</>}</div>
              )}

              {lookup?.found && (
                <div className="note a mt-4">
                  <b>{lookup.legal_name}</b> ({lookup.company_code}) is already on record
                  under this PAN, with {lookup.site_count} site{lookup.site_count === 1 ? '' : 's'}.
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <button type="button" className={`btn ${linked ? 'btn-p' : 'btn-o'}`}
                            onClick={() => setLinkTo(lookup.id)}>
                      {linked ? '✓ Linking as another site' : 'Link as another site'}
                    </button>
                    <button type="button" className={`btn ${!linked ? 'btn-p' : 'btn-o'}`}
                            onClick={() => setLinkTo(null)}>
                      This is a different company
                    </button>
                  </div>
                  {linked && (
                    <div className="hint mt-3">
                      Identity, banking and agreements come from {lookup.company_code} and
                      are skipped. This site keeps its own address and certificates.
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {current.id === 'identity' && (linked ? (
            <div className="note">
              <b>Skipped.</b> This site is being linked to {parent?.company_code}, so the
              identity, banking and agreement details already exist. Edit them on any of
              that company&apos;s records and every site sees the change.
            </div>
          ) : (
            <>
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                {sec('identity').blurb}
              </p>
              <FieldGrid
                fields={sec('identity').fields.filter(f => f.key !== 'pan')}
                values={company}
                onChange={(k, v) => setCompany(p => ({ ...p, [k]: v }))} />
              <div className="hint mt-3">PAN will be {pan ?? 'taken from the GSTIN'}.</div>
            </>
          ))}

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

          {current.id === 'categories' && (
            industryCats.length ? (
              <>
                <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
                  Pick every category this site is registered or set up for. Where a
                  category has sub-categories, pick at least one.
                </p>
                <div className="flex gap-2 flex-wrap mb-4">
                  {industryCats.map(c => (
                    <button key={c.id} type="button"
                            className={`chip ${pickedCats.includes(c.id) ? 'c-g' : 'c-n'}`}
                            style={{ padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
                            onClick={() => {
                              if (pickedCats.includes(c.id)) {
                                setPickedCats(p => p.filter(x => x !== c.id));
                                setPickedSubs(p => p.filter(s => !c.subs.some(x => x.id === s)));
                              } else setPickedCats(p => [...p, c.id]);
                            }}>{c.label}</button>
                  ))}
                </div>
                {pickedCats.map(id => {
                  const c = industryCats.find(x => x.id === id);
                  if (!c || !c.subs.length) return null;
                  const n = c.subs.filter(s => pickedSubs.includes(s.id)).length;
                  return (
                    <div key={id} className="card p-4 mb-3" style={{ background: 'var(--surface-2)' }}>
                      <div className="flex justify-between items-center gap-3 mb-3 flex-wrap">
                        <span className="text-[13px] font-bold" style={{ color: 'var(--head)' }}>{c.label}</span>
                        <span className={`chip ${n ? 'c-g' : 'c-r'}`}>{n}/{c.subs.length}</span>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {c.subs.map(s => (
                          <button key={s.id} type="button"
                                  className={`chip ${pickedSubs.includes(s.id) ? 'c-g' : 'c-n'}`}
                                  style={{ padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }}
                                  onClick={() => setPickedSubs(p =>
                                    p.includes(s.id) ? p.filter(x => x !== s.id) : [...p, s.id])}>
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="note a">
                No categories are configured for this industry. Run
                <b> 03_reference_data.sql</b> in Supabase.
              </div>
            )
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
            {current.id === 'review' ? (
              <button type="button" className="btn btn-p" onClick={submit} disabled={busy}>
                {busy ? 'Creating…' : 'Create vendor'}
              </button>
            ) : (
              <button type="button" className="btn btn-p" onClick={next}>Continue</button>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
