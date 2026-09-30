import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, getMe } from '@/lib/supabase/server';
import { INDUSTRIES, ENTITY_TYPES, ROLE_LABEL } from '@/lib/constants';

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  const supabase = await createClient();

  const { data: site } = await supabase
    .from('vendor_site')
    .select(`*, company:company_id (*), contacts:site_contact (*)`)
    .eq('id', id).is('deleted_at', null).single();

  if (!site) notFound();
  const company = site.company as Record<string, unknown>;

  const { data: siblings } = await supabase
    .from('vendor_site').select('id, site_code, site_name, city, state, industry')
    .eq('company_id', site.company_id).is('deleted_at', null).order('site_code');

  const { data: docs } = await supabase
    .from('site_document')
    .select('id, doc_type, file_name, valid_until, verified_at')
    .eq('site_id', id).is('superseded_at', null);

  const { data: required } = await supabase
    .from('document_requirement')
    .select('doc_type, level, document_type!inner(label, uploaded_by_party)')
    .eq('industry', site.industry).eq('level', 'required');

  const locked = me?.role !== 'super_admin';
  const industryLabel = INDUSTRIES.find(i => i.code === site.industry)?.label ?? site.industry;
  const entityLabel = ENTITY_TYPES.find(([v]) => v === company.entity)?.[1] ?? '—';

  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div>
      <div className="text-[10.5px] font-bold uppercase tracking-[.07em]"
           style={{ color: 'var(--faint)' }}>{k}</div>
      <div className="text-[13.5px] font-medium" style={{ color: 'var(--head)' }}>{v || '—'}</div>
    </div>
  );

  return (
    <>
      <Link href="/vendors" className="text-[13px] font-semibold"
            style={{ color: 'var(--faint)' }}>← All vendors</Link>

      <div className="flex justify-between items-start gap-4 flex-wrap mt-2 mb-5">
        <div>
          <h1 className="text-[26px] font-bold">{String(company.legal_name)}</h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--faint)' }}>
            {site.site_code} · {industryLabel} · {site.city}, {site.state}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <span className="chip c-n">{ROLE_LABEL[me!.role]}</span>
          {locked
            ? <span className="chip c-a">LOCKED — REQUEST CHANGES</span>
            : <span className="chip c-g">YOU CAN EDIT DIRECTLY</span>}
        </div>
      </div>

      {locked && (
        <div className="note a mb-5">
          <b>This record is locked.</b> Saved vendor data cannot be edited directly.
          Request a change and a Super Admin decides. Verifying documents does not need approval.
        </div>
      )}

      {siblings && siblings.length > 1 && (
        <div className="note mb-5">
          <b>{String(company.company_code)} has {siblings.length} sites.</b> Company details —
          bank, MSME status, the NDA — are shared. Address and certificates are per site.
          <div className="flex gap-2 mt-3 flex-wrap">
            {siblings.map(s => (
              <Link key={s.id} href={`/vendors/${s.id}`}
                    className={`chip ${s.id === id ? 'c-g' : 'c-n'}`}>
                {s.site_code} · {s.city}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card p-6">
          <h2 className="text-[15px] font-bold mb-4">Company · {String(company.company_code)}</h2>
          <div className="grid grid-cols-2 gap-4">
            <Row k="Legal name" v={String(company.legal_name)} />
            <Row k="Trade name" v={company.trade_name as string} />
            <Row k="PAN" v={String(company.pan)} />
            <Row k="Entity type" v={entityLabel} />
            <Row k="MSME" v={company.is_msme ? `Yes · ${company.msme_category}` : 'No'} />
            <Row k="Udyam number" v={company.udyam_number as string} />
            <Row k="Authorised signatory" v={company.authorised_signatory as string} />
            <Row k="NDA" v={(company.nda_status as string) ?? 'Not sent'} />
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-[15px] font-bold mb-4">Site · {site.site_code}</h2>
          <div className="grid grid-cols-2 gap-4">
            <Row k="GSTIN" v={site.gstin} />
            <Row k="Industry" v={industryLabel} />
            <Row k="Site name" v={site.site_name} />
            <Row k="Address" v={site.address_line1} />
            <Row k="City" v={site.city} />
            <Row k="State" v={site.state} />
            <Row k="Pincode" v={site.pincode} />
            <Row k="Registered address" v={site.is_registered_address ? 'Yes' : 'No'} />
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-[15px] font-bold mb-4">Contacts</h2>
          {site.contacts?.length ? (
            <div className="space-y-3">
              {site.contacts
                .sort((a: { rank: number }, b: { rank: number }) => a.rank - b.rank)
                .map((c: { id: string; rank: number; name: string; designation: string;
                           mobile: string; email: string }) => (
                <div key={c.id} className="pb-3 border-b last:border-0"
                     style={{ borderColor: 'var(--line)' }}>
                  <div className="text-[10.5px] font-bold uppercase tracking-[.07em]"
                       style={{ color: 'var(--p600)' }}>
                    {['Primary', 'Secondary', 'Other'][c.rank - 1]} contact
                  </div>
                  <div className="text-[13.5px] font-semibold" style={{ color: 'var(--head)' }}>
                    {c.name} {c.designation && <span className="font-normal">· {c.designation}</span>}
                  </div>
                  <div className="text-[12.5px]" style={{ color: 'var(--faint)' }}>
                    {[c.mobile, c.email].filter(Boolean).join(' · ') || 'No contact details'}
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-[13.5px]" style={{ color: 'var(--faint)' }}>None recorded yet.</p>}
        </div>

        <div className="card p-6">
          <h2 className="text-[15px] font-bold mb-1">Documents</h2>
          <p className="text-[13px] mb-4" style={{ color: 'var(--faint)' }}>
            {docs?.length ?? 0} attached · {required?.length ?? 0} required for a {industryLabel.toLowerCase()} vendor
          </p>
          {required?.length ? (
            <div className="space-y-2">
              {required.map(r => {
                const t = r.document_type as unknown as { label: string };
                const have = docs?.find(d => d.doc_type === r.doc_type);
                return (
                  <div key={r.doc_type} className="flex justify-between items-center gap-3">
                    <span className="text-[13.5px]" style={{ color: 'var(--head)' }}>{t.label}</span>
                    <span className={`chip ${have ? (have.verified_at ? 'c-g' : 'c-a') : 'c-r'}`}>
                      {have ? (have.verified_at ? 'VERIFIED' : 'ATTACHED') : 'MISSING'}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-[13.5px]" style={{ color: 'var(--faint)' }}>No required documents configured.</p>}
          <div className="hint mt-4">Upload, verification and the evaluation come next.</div>
        </div>
      </div>
    </>
  );
}
