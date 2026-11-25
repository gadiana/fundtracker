import { centavosPlain, formatReportCell, reportCsv, type ReportCell, type ReportCellType, type ReportDoc, type ReportHeader } from '@sft/shared';
import { asJpeg, fileImages } from './pdfPages';

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

/** A logo as JPEG data (any image type, transparency on white), or null if it can't be read. */
async function logoImage(url: string) {
  try {
    return await asJpeg(url);
  } catch {
    return null;
  }
}

type Pdf = InstanceType<(typeof import('jspdf'))['jsPDF']>;

/**
 * The letterhead, as on the printed page: logos at each side (the first closest to the text),
 * the header lines between them. Returns the y below it.
 */
async function drawHeader(pdf: Pdf, h: ReportHeader, M: number, y: number) {
  const W = pdf.internal.pageSize.getWidth();
  const side = Math.max(h.logosLeft.length, h.logosRight.length);
  if (!side && !h.lines.length) return y;
  const size = h.logoSize;
  const gap = 6;
  const sideW = side ? side * size + (side - 1) * gap + 12 : 0;
  const textLeft = M + sideW;
  const textRight = W - M - sideW;

  // the text block, measured first so it can sit in the middle of the logos
  const blocks = h.lines.map((l) => {
    pdf.setFont('helvetica', l.bold ? 'bold' : 'normal').setFontSize(l.size);
    const lines: string[] = pdf.splitTextToSize(l.text, textRight - textLeft);
    return { l, lines, height: lines.length * l.size * 1.2 };
  });
  const textH = blocks.reduce((s, b) => s + b.height, 0);
  const headerH = Math.max(side ? size : 0, textH);

  const place = async (url: string, x: number) => {
    const img = await logoImage(url);
    if (!img) return;
    const scale = Math.min(size / img.width, size / img.height);
    const w = img.width * scale;
    const ih = img.height * scale;
    pdf.addImage(img.data, 'JPEG', x + (size - w) / 2, y + (headerH - ih) / 2, w, ih, undefined, 'FAST');
  };
  for (const [i, url] of h.logosLeft.entries()) await place(url, textLeft - 12 - (i + 1) * size - i * gap);
  for (const [i, url] of h.logosRight.entries()) await place(url, textRight + 12 + i * (size + gap));

  let ty = y + (headerH - textH) / 2;
  pdf.setTextColor(0);
  for (const { l, lines } of blocks) {
    pdf.setFont('helvetica', l.bold ? 'bold' : 'normal').setFontSize(l.size);
    for (const line of lines) {
      ty += l.size;
      const x = l.align === 'center' ? (textLeft + textRight) / 2 : l.align === 'right' ? textRight : textLeft;
      pdf.text(line, x, ty, { align: l.align });
      ty += l.size * 0.2;
    }
  }
  const bottom = y + headerH + 8;
  pdf.setDrawColor(180).line(M, bottom, W - M, bottom);
  return bottom + 12;
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

  y = await drawHeader(pdf, doc.header, M, y);
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

  // signatures, at most three a row, each row on a new page when there's no room left
  const H = pdf.internal.pageSize.getHeight();
  const perRow = Math.min(3, Math.max(1, doc.signatories.length));
  const colW = (W - 2 * M) / perRow;
  pdf.setTextColor(0).setDrawColor(0);
  for (let row = 0; row * perRow < doc.signatories.length; row++) {
    if (y + 24 + 60 > H - 30) {
      pdf.addPage();
      y = M;
    }
    y += 24;
    doc.signatories.slice(row * perRow, (row + 1) * perRow).forEach((s, i) => {
      const sx = M + i * colW;
      pdf.setFont('helvetica', 'normal').setFontSize(9).text(s.label, sx, y);
      pdf.line(sx, y + 34, sx + colW - 30, y + 34);
      pdf.setFont('helvetica', 'bold').text(s.name || ' ', sx, y + 46);
      pdf.setFont('helvetica', 'normal').text(s.title || ' ', sx, y + 57);
    });
    y += 60;
  }

  // supporting documents last: each photo or PDF page on its own page, fitted and labelled
  for (const group of doc.annex?.groups ?? []) {
    const images = (await Promise.all(group.files.map(fileImages))).flat();
    for (const [i, img] of images.entries()) {
      pdf.addPage();
      const label = `${doc.annex!.title} · ${group.ref}`;
      pdf.setFont('helvetica', 'bold').setFontSize(11).setTextColor(0).text(label, M, M + 6);
      const caption = `${group.caption}${images.length > 1 ? ` (${i + 1} of ${images.length})` : ''}`;
      pdf.setFont('helvetica', 'normal').setFontSize(9).setTextColor(70);
      const lines = pdf.splitTextToSize(caption, W - 2 * M);
      pdf.text(lines, M, M + 20);
      pdf.setTextColor(0);
      const top = M + 28 + lines.length * 10;
      try {
        const jpeg = await asJpeg(img.src);
        const scale = Math.min((W - 2 * M) / jpeg.width, (H - top - 40) / jpeg.height);
        const w = jpeg.width * scale;
        const h = jpeg.height * scale;
        pdf.addImage(jpeg.data, 'JPEG', M + (W - 2 * M - w) / 2, top, w, h, undefined, 'FAST');
      } catch {
        pdf.text('This file could not be added. Open it from the fund request.', M, top + 12);
      }
    }
  }

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
