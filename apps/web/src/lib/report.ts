import { centavosPlain, formatReportCell, reportCsv, type ReportCell, type ReportCellType, type ReportDoc } from '@sft/shared';

/** One cell as text (shared with the API tests, which check the CSV). */
export const formatCell = formatReportCell;

export const isNumeric = (type?: ReportCellType) => type === 'money' || type === 'number';

/** Wide tables print sideways. */
export const isLandscape = (doc: ReportDoc) => doc.tables.some((t) => t.columns.length > 7);

const fileStem = (doc: ReportDoc) => `${doc.kind}-${doc.header.academicYear}-${new Date(doc.generatedAt).toISOString().slice(0, 10)}`;

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ───────────────────────────── CSV ─────────────────────────────

export function downloadCsv(doc: ReportDoc) {
  download(new Blob([reportCsv(doc)], { type: 'text/csv;charset=utf-8' }), `${fileStem(doc)}.csv`);
}

// ───────────────────────────── PDF ─────────────────────────────

async function imageData(url: string) {
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * The report as a real PDF (selectable text, repeated table headers, page numbers). The
 * built-in PDF fonts have no peso sign, so amounts are plain numbers under "(PHP)" headings.
 */
export async function downloadPdf(doc: ReportDoc) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const pdf = new jsPDF({ unit: 'pt', format: doc.paperSize.toLowerCase(), orientation: isLandscape(doc) ? 'landscape' : 'portrait' });
  const W = pdf.internal.pageSize.getWidth();
  const M = 36;
  let y = M;

  const logo = doc.header.logoUrl ? await imageData(doc.header.logoUrl) : null;
  if (logo) {
    try {
      pdf.addImage(logo, M, y, 40, 40);
    } catch {
      // an image format jsPDF can't read: leave the logo out
    }
  }
  const x = logo ? M + 50 : M;
  pdf.setFont('helvetica', 'bold').setFontSize(13).text(doc.header.orgName, x, y + 12);
  pdf.setFont('helvetica', 'normal').setFontSize(9);
  const sub = [doc.header.collegeName, doc.header.schoolName].filter(Boolean).join(' · ');
  if (sub) pdf.text(sub, x, y + 25);
  pdf.text(`Academic year ${doc.header.academicYear}`, x, y + 37);
  y += 54;
  if (doc.header.headerText) {
    const lines = pdf.splitTextToSize(doc.header.headerText, W - 2 * M);
    pdf.text(lines, M, y);
    y += lines.length * 11 + 4;
  }
  pdf.setFont('helvetica', 'bold').setFontSize(15).text(doc.title, M, y + 6);
  y += 20;
  if (doc.subtitle) {
    pdf.setFont('helvetica', 'normal').setFontSize(10).text(doc.subtitle, M, y);
    y += 14;
  }
  if (doc.filters.length) {
    pdf.setFontSize(9).setTextColor(90);
    pdf.text(doc.filters.map((f) => `${f.label}: ${f.value}`).join('   ·   '), M, y);
    pdf.setTextColor(0);
    y += 12;
  }

  const money = (v: ReportCell, type?: ReportCellType) => (type === 'money' && typeof v === 'number' ? `PHP ${centavosPlain(v)}` : formatCell(v, type, doc.timezone, { plain: true }));
  autoTable(pdf, {
    startY: y + 4,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { textColor: 90 }, 1: { fontStyle: 'bold' } },
    body: doc.summary.map((s) => [s.label, money(s.value, s.type)]),
    margin: { left: M, right: M },
    tableWidth: Math.min(360, W - 2 * M),
  });
  // @ts-expect-error lastAutoTable is added by jspdf-autotable
  y = pdf.lastAutoTable.finalY + 10;

  for (const t of doc.tables) {
    pdf.setFont('helvetica', 'bold').setFontSize(11).text(t.title, M, y + 10);
    const head = [t.columns.map((c) => (c.type === 'money' ? `${c.label} (PHP)` : c.label))];
    const body = t.rows.length ? t.rows.map((r) => t.columns.map((c) => formatCell(r[c.key] ?? null, c.type, doc.timezone, { plain: true }))) : [[t.emptyText ?? 'Nothing to show.']];
    // column styles don't reach the totals row, so its numbers are right-aligned here
    const foot = t.totals
      ? [t.columns.map((c) => ({ content: formatCell(t.totals![c.key] ?? null, c.type, doc.timezone, { plain: true }), styles: isNumeric(c.type) ? { halign: 'right' as const } : {} }))]
      : undefined;
    autoTable(pdf, {
      startY: y + 16,
      head,
      body,
      foot,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [238, 242, 255], textColor: 20, fontStyle: 'bold' },
      footStyles: { fillColor: [248, 250, 252], textColor: 20, fontStyle: 'bold' },
      columnStyles: Object.fromEntries(t.columns.map((c, i) => [i, isNumeric(c.type) ? { halign: 'right' } : {}])),
      margin: { left: M, right: M, bottom: 40 },
      showFoot: 'lastPage',
    });
    // @ts-expect-error lastAutoTable is added by jspdf-autotable
    y = pdf.lastAutoTable.finalY + 14;
  }

  pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(90);
  for (const note of [...doc.notes, ...(doc.truncatedAt ? [`Only the first ${doc.truncatedAt.toLocaleString()} rows are listed; the totals cover everything.`] : [])]) {
    const lines = pdf.splitTextToSize(note, W - 2 * M);
    pdf.text(lines, M, y);
    y += lines.length * 10 + 2;
  }
  pdf.setTextColor(0);

  // signatures, on a new page when there's no room left
  const H = pdf.internal.pageSize.getHeight();
  if (y + 24 + 60 > H - 30) {
    pdf.addPage();
    y = M;
  }
  y += 24;
  const colW = (W - 2 * M) / doc.signatories.length;
  doc.signatories.forEach((s, i) => {
    const sx = M + i * colW;
    pdf.setFontSize(9).text(s.label, sx, y);
    pdf.line(sx, y + 34, sx + colW - 30, y + 34);
    pdf.setFont('helvetica', 'bold').text(s.name || ' ', sx, y + 46);
    pdf.setFont('helvetica', 'normal').text(s.title || ' ', sx, y + 57);
  });

  const pages = pdf.getNumberOfPages();
  const stamp = `Generated ${formatCell(doc.generatedAt, 'datetime', doc.timezone)} by ${doc.generatedBy}`;
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setFontSize(7).setTextColor(120);
    pdf.text(stamp, M, H - 18);
    pdf.text(`Page ${p} of ${pages}`, W - M, H - 18, { align: 'right' });
  }
  pdf.save(`${fileStem(doc)}.pdf`);
}
