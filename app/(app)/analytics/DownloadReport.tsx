'use client';
import { useState } from 'react';
import type { AnalyticsFilters } from '@/lib/analyticsFilters';
import { filtersToJsonb, SOURCE_LABEL } from '@/lib/analyticsFilters';
import type { AnalyticsSummary, Taxonomy, TrendResponse } from '@/lib/analyticsTypes';
import { pctLabel } from '@/lib/analyticsTypes';

const nf = new Intl.NumberFormat('en-IN');
const TEAL: [number, number, number] = [4, 82, 78];
const GREEN: [number, number, number] = [5, 160, 112];
const GREY: [number, number, number] = [77, 79, 103];

/** "Download PDF" at the top of Analytics: builds a report from the same
 *  summary the page already rendered (plus the monthly trend), so the PDF
 *  always matches what is on screen for the current filters. jsPDF is only
 *  loaded when the button is clicked. */
export default function DownloadReport({ summary, filters, taxonomy, asOf }: {
  summary: AnalyticsSummary; filters: AnalyticsFilters; taxonomy: Taxonomy; asOf: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function download() {
    setBusy(true); setErr('');
    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);

      // Monthly trend for the same filters; the report still downloads without it.
      let trend: TrendResponse | null = null;
      try {
        const params = new URLSearchParams(filtersToJsonb(filters));
        params.set('granularity', 'monthly'); params.set('metric', 'onboarded'); params.set('includeImports', '0');
        const r = await fetch(`/api/analytics/trend?${params.toString()}`);
        const d = await r.json();
        if (!d.error) trend = d as TrendResponse;
      } catch { /* trend is optional */ }

      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const W = doc.internal.pageSize.getWidth(), M = 40;
      let y = 48;
      const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
      const heading = (text: string) => {
        if (y > 740) { doc.addPage(); y = 48; }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...TEAL);
        doc.text(text, M, y); y += 8;
      };
      const table = (head: string[], body: (string | number)[][], right: number[] = []) => {
        autoTable(doc, {
          startY: y, head: [head], body: body.map(r => r.map(String)), margin: { left: M, right: M },
          styles: { fontSize: 9, cellPadding: 4, textColor: [26, 28, 60] },
          headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [245, 247, 246] },
          columnStyles: Object.fromEntries(right.map(i => [i, { halign: 'right' }])),
        });
        y = lastY() + 22;
      };

      // Header
      doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...TEAL);
      doc.text('Vendor analytics report', M, y); y += 18;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GREY);
      doc.text(`GreenFind by Fitsol  |  Data as of ${asOf} IST`, M, y); y += 14;
      const vLabel = (id?: string) => taxonomy.verticals.find(v => v.id === id)?.label ?? id;
      const fl = [
        filters.vertical && `Vertical: ${vLabel(filters.vertical)}`,
        filters.category && `Category: ${taxonomy.verticals.flatMap(v => v.categories).find(c => c.id === filters.category)?.label ?? filters.category}`,
        filters.state && `State: ${filters.state}`, filters.region && `Region: ${filters.region}`,
        filters.source && `Source: ${filters.source.split(',').map(s => SOURCE_LABEL[s] ?? s).join(', ')}`,
        filters.window && `Window: ${filters.window}`,
      ].filter(Boolean) as string[];
      const fLines = doc.splitTextToSize(`Filters: ${fl.length ? fl.join('; ') : 'none (all vendors)'}`, W - 2 * M);
      doc.text(fLines, M, y); y += fLines.length * 12 + 14;

      const k = summary.kpi;
      heading('Key numbers');
      table(['Total vendors', 'Onboarded', 'Unverified', 'Verified', `Added this month`], [[
        nf.format(k.total), `${nf.format(k.onboarded)} (${pctLabel(k.onboarded, k.total)})`,
        `${nf.format(k.unverified)} (${pctLabel(k.unverified, k.total)})`, `${nf.format(k.verified)} (${pctLabel(k.verified, k.total)})`,
        nf.format(k.added_this_month),
      ]]);

      heading('By vertical');
      table(['Vertical', 'Vendors', 'Share of total', 'Verified'],
        summary.by_vertical.map(v => [v.label, nf.format(v.count), pctLabel(v.count, k.total), nf.format(v.verified)]), [1, 2, 3]);

      if (filters.vertical && summary.by_category.length) {
        const vt = summary.by_vertical.find(v => v.id === filters.vertical)?.count ?? 0;
        heading(`Service categories in ${vLabel(filters.vertical)}`);
        const rows: string[][] = [];
        summary.by_category.forEach(c => {
          rows.push([c.label + (c.is_active ? '' : ' (inactive)'), nf.format(c.count), pctLabel(c.count, vt), nf.format(c.verified)]);
          (summary.by_subcategory[c.id] ?? []).forEach(s => rows.push([`    ${s.label}`, nf.format(s.count), pctLabel(s.count, vt), nf.format(s.verified)]));
        });
        table(['Category', 'Vendors', `Share of ${vLabel(filters.vertical)}`, 'Verified'], rows, [1, 2, 3]);
      }

      heading('By region');
      table(['Region', 'Vendors', 'Share'], [...(summary.by_region ?? [])].sort((a, b) => b.count - a.count)
        .map(r => [r.label, nf.format(r.count), pctLabel(r.count, k.total)]), [1, 2]);

      heading('By state');
      table(['State', 'Vendors', 'Share'], [...summary.by_state].sort((a, b) => b.count - a.count)
        .map(r => [r.state ?? 'Unknown', nf.format(r.count), pctLabel(r.count, k.total)]), [1, 2]);

      heading('By source');
      table(['Source', 'Vendors', 'Share'], summary.by_source.map(r => [SOURCE_LABEL[r.source] ?? r.source, nf.format(r.count), pctLabel(r.count, k.total)]), [1, 2]);

      if (trend && trend.buckets.length) {
        heading('Vendors added by month (imports excluded)');
        table(['Month', 'Added'], trend.buckets.map(b => [b.bucket, nf.format(b.count)]), [1]);
      }

      const n = doc.getNumberOfPages();
      for (let i = 1; i <= n; i++) {
        doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY);
        doc.text(`GreenFind vendor analytics  |  Fitsol, internal use only  |  Page ${i} of ${n}`, M, doc.internal.pageSize.getHeight() - 24);
      }
      const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      doc.save(`greenfind-vendor-analytics-${stamp}.pdf`);
    } catch (e) {
      setErr('Could not build the PDF. Try again.');
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {err && <span className="text-[12px]" style={{ color: 'var(--danger, #EF4444)' }}>{err}</span>}
      <button type="button" onClick={download} disabled={busy} className="btn btn-p">
        {busy ? 'Preparing PDF…' : 'Download PDF'}
      </button>
    </span>
  );
}
