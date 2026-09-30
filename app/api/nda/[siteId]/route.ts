import { NextResponse } from 'next/server';
import { createClient, getMe } from '@/lib/supabase/server';

/** Generates the Fitsol NDA with this vendor's details filled in.
 *  Served as an HTML file — Word opens it, and printing gives a clean PDF.
 *  Nothing is stored; it is built fresh each time from the current record. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const me = await getMe();
  if (!me) return new NextResponse('Not signed in', { status: 401 });

  const { siteId } = await params;
  const supabase = await createClient();

  const { data: site } = await supabase
    .from('vendor_site')
    .select('site_code, gstin, address_line1, city, state, pincode, company_id')
    .eq('id', siteId).single();
  if (!site) return new NextResponse('Vendor not found', { status: 404 });

  const { data: company } = await supabase
    .from('company').select('legal_name, authorised_signatory').eq('id', site.company_id).single();

  const esc = (v: unknown) =>
    String(v ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

  const blank = '<span class="fill">&nbsp;</span>';
  const name = company?.legal_name ? esc(company.legal_name) : blank;
  const addr = [site.address_line1, site.city, site.state, site.pincode]
    .filter(Boolean).join(', ');
  const signatory = company?.authorised_signatory ? esc(company.authorised_signatory) : '&nbsp;';
  const today = new Date();

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>NDA — ${esc(company?.legal_name ?? 'Vendor')}</title>
<style>
@page { size: A4; margin: 22mm 20mm }
body { font-family: Cambria, Georgia, "Times New Roman", serif; font-size: 11pt;
       line-height: 1.5; color: #000; max-width: 760px; margin: 0 auto; padding: 24px }
h1 { font-size: 14pt; text-align: center; letter-spacing: .06em; margin: 0 0 22px }
h2 { font-size: 11pt; margin: 20px 0 6px }
p { margin: 0 0 10px; text-align: justify }
ul { margin: 6px 0 10px 20px; padding: 0 } li { margin-bottom: 3px }
.fill { display: inline-block; min-width: 160px; border-bottom: 1px solid #000 }
.sigs { display: flex; gap: 40px; margin-top: 34px; page-break-inside: avoid }
.sig { flex: 1 } .sig b { display: block; margin-bottom: 10px; font-size: 10.5pt }
.sig div { margin-bottom: 12px; border-bottom: 1px solid #000; padding-bottom: 2px; font-size: 10.5pt }
.foot { margin-top: 30px; padding-top: 12px; border-top: 1px solid #999;
        font-size: 9pt; color: #333; text-align: center }
.note { margin-top: 22px; padding: 9px 12px; border: 1px dashed #999; font-size: 8.5pt; color: #444 }
@media print { .note { display: none } }
</style></head><body>

<h1>NON-DISCLOSURE AGREEMENT</h1>

<p>This Non-Disclosure Agreement (&ldquo;Agreement&rdquo;) is entered into as of the ${blank} day of ${blank}, ${today.getFullYear()} (the &ldquo;Effective Date&rdquo;), by and between:</p>

<p><b>Fitsol Supply Chain Solutions Private Limited</b>, a company incorporated under the <b>Companies Act 1956/2013</b> and represented herein by its authorized signatory <b>Mr. Anand Pathak</b>, having its registered office at Plot No-28, 3rd Floor, Institutional Area, Sector-32, Gurugram, Haryana, 122001 (the &ldquo;<b>Disclosing Party</b>&rdquo;, which expression shall, unless repugnant to the context or meaning thereof, be deemed to include its successors and permitted assigns),</p>

<p style="text-align:center">And</p>

<p><b>${name}</b>, a company incorporated under the laws of India, having its registered office at ${addr ? esc(addr) : blank}${site.gstin ? ', GSTIN ' + esc(site.gstin) : ''} (hereinafter referred to as the &ldquo;<b>Receiving Party</b>&rdquo;, which expression shall, unless repugnant to the context or meaning thereof, be deemed to include its successors and permitted assigns),</p>

<p>Each of the Disclosing Party and the Receiving Party shall individually be referred to as a &ldquo;Party&rdquo; and collectively as the &ldquo;Parties&rdquo;.</p>

<h2>1. Purpose</h2>
<p>The Parties acknowledge that in connection with a potential or existing business relationship involving the provision of services by Fitsol, including but not limited to Packaging Solutions, warehouse operations, warehouse management, transportation, freight forwarding, software and hardware services, handling of digital data and documentation, global logistics and supply chain management in domestic and international contexts (the &ldquo;Permitted Purpose&rdquo;), each Party may disclose Confidential Information to the other.</p>

<h2>2. Definition of Confidential Information</h2>
<p>&ldquo;Confidential Information&rdquo; means all non-public information, whether written, oral, electronic, visual or in other tangible or intangible form, disclosed by one Party to the other, including but not limited to:</p>
<ul>
<li>Business, operational, financial or strategic plans</li>
<li>Pricing, contracts and financial arrangements</li>
<li>Customer, supplier or vendor data</li>
<li>Technical drawings, systems, designs or software code</li>
<li>Data, reports, analysis and documentation</li>
<li>Any materials marked or reasonably understood as confidential</li>
<li>Any reproductions, derivatives or summaries of the foregoing</li>
</ul>
<p>Confidential Information shall not include information which: (a) is or becomes public through no breach; (b) is received lawfully from a third party without confidentiality obligations; (c) is independently developed; (d) is disclosed pursuant to legal or regulatory obligations with prior written notice where legally permissible; or (e) constitutes general skills, knowledge or expertise retained in the unaided memory of a Party&rsquo;s personnel.</p>

<h2>3. Confidentiality Obligations</h2>
<p>The Receiving Party shall: (a) maintain Confidential Information in strict confidence; (b) use it solely for the Permitted Purpose; (c) not disclose it to third parties without prior consent, except to authorized representatives bound by confidentiality; (d) apply reasonable safeguards; (e) promptly notify the Disclosing Party of any unauthorized disclosure; and (f) may disclose Confidential Information to subcontractors, carriers, insurers or government authorities as reasonably required in the course of providing services, subject to confidentiality obligations no less protective.</p>

<h2>4. Use of Confidential Information</h2>
<p>The Receiving Party shall not, without prior written consent of the Disclosing Party: (a) use the Confidential Information for any purpose other than the Permitted Purpose; (b) copy, modify, reverse engineer or create derivative works; or (c) use the Confidential Information to compete with the Disclosing Party. Nothing herein restricts the Receiving Party from using ideas, concepts or know-how retained in the unaided memory of its personnel.</p>

<h2>5. Ownership</h2>
<p>Confidential Information remains the sole and exclusive property of the Disclosing Party. No license, right or interest is granted by disclosure.</p>
<p>In case the customer of the Disclosing Party plans to visit and audit the manufacturing facility of the Receiving Party for inspection and quality assurance purposes, the Receiving Party shall not raise any objection and should support the Disclosing Party.</p>

<h2>6. Return or Destruction</h2>
<p>Upon termination or request, the Receiving Party shall return or destroy all Confidential Information and certify the destruction in writing.</p>

<h2>7. No Warranty</h2>
<p>Confidential Information is provided &ldquo;as is&rdquo; without any warranties as to accuracy, completeness or fitness for a particular purpose. The Disclosing Party shall not be liable for reliance by the Receiving Party.</p>

<h2>8. Term and Survival</h2>
<p>This Agreement shall remain in force for <b>three (3) years</b> from the Effective Date. The obligations of confidentiality shall survive termination for a period of three (3) years thereafter.</p>

<h2>9. Equitable Relief</h2>
<p>The Parties acknowledge that breach of this Agreement may cause irreparable harm for which monetary damages are insufficient. The Disclosing Party shall be entitled to injunctive relief and other equitable remedies, provided that such relief shall not restrict the Receiving Party&rsquo;s right to continue providing services to other clients, provided such services do not involve unauthorized disclosure.</p>

<h2>10. Governing Law and Arbitration</h2>
<p>This Agreement shall be governed by the laws of India. Any disputes shall be referred to arbitration under the Arbitration and Conciliation Act, 1996. The seat and venue shall be Delhi, India. Arbitration shall be conducted in English by a sole arbitrator mutually appointed by the Parties. The arbitral award shall be final and binding.</p>

<h2>11. Miscellaneous</h2>
<ul>
<li><b>Entire Agreement:</b> This Agreement supersedes prior understandings.</li>
<li><b>Amendments:</b> Must be in writing signed by both Parties.</li>
<li><b>Severability:</b> Invalid provisions do not affect the remainder.</li>
<li><b>Counterparts:</b> This Agreement may be executed in counterparts.</li>
<li><b>Assignment:</b> Fitsol may assign this Agreement to its affiliates or successors in connection with a merger, acquisition or corporate reorganization, with prior written notice. Other assignments require prior consent.</li>
<li><b>No Agency:</b> Nothing herein creates agency, joint venture or partnership.</li>
</ul>

<p>IN WITNESS WHEREOF, the Parties hereto have executed this Agreement as of the Effective Date.</p>

<div class="sigs">
  <div class="sig"><b>FOR: ${name}</b>
    <div>Name: ${signatory}</div><div>Title:&nbsp;</div><div>Date:&nbsp;</div></div>
  <div class="sig"><b>FOR: FITSOL SUPPLY CHAIN SOLUTIONS PRIVATE LIMITED</b>
    <div>Name: Anand Pathak</div><div>Title: CEO</div><div>Date:&nbsp;</div></div>
</div>

<div class="foot"><b>FITSOL SUPPLY CHAIN SOLUTIONS PVT LTD</b><br>
Reg. Office: Plot No-28, 3rd Floor, Institutional Area, Sector-32, Gurugram, Haryana, 122001<br>
RO: 29 Balaji Nagar, Sankhalpur Road, Becharaji, Mahesana, Gujarat, 384210 &middot; Phone 9311439446<br>
Email: billing@fitsol.green</div>

<div class="note">Generated from the GreenFind vendor master for ${esc(site.site_code)} on ${today.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}. This block does not print.</div>

</body></html>`;

  const filename = 'NDA-' +
    String(company?.legal_name ?? site.site_code).replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') + '.html';

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
