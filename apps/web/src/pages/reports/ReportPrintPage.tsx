import { useEffect, useState, type CSSProperties } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { FileDown, Printer, Sheet } from 'lucide-react';
import type { ReportAnnex, ReportDoc, ReportTable } from '@sft/shared';
import { Alert, Button, Spinner, cx } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fileImages } from '../../lib/pdfPages';
import { downloadCsv, downloadPdf, formatCell, isLandscape, isNumeric } from '../../lib/report';

const PAGE_SIZE = { A4: 'A4', LETTER: 'letter', LEGAL: 'legal' } as const;

/**
 * A report on its own page (opened in a new tab), laid out for paper: Print uses the AY's
 * paper size, and the same document downloads as PDF or CSV.
 */
export function ReportPrintPage() {
  const { kind } = useParams();
  const [params] = useSearchParams();
  const { ay } = useAuth();
  const report = useQuery({ queryKey: ['report', ay?.id, kind, params.toString()], queryFn: () => api<ReportDoc>(`/reports/${kind}?${params}`) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const doc = report.data;

  useEffect(() => {
    if (doc) document.title = `${doc.title}${doc.subtitle ? ` – ${doc.subtitle}` : ''}`;
  }, [doc]);

  if (report.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Preparing the report" />
      </div>
    );
  }
  if (report.error || !doc) {
    return (
      <div className="p-6">
        <Alert>{describeError(report.error)}</Alert>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-100 print:bg-white">
      <style>{`@page { size: ${PAGE_SIZE[doc.paperSize]} ${isLandscape(doc) ? 'landscape' : 'portrait'}; margin: 12mm; }`}</style>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-slate-900 px-4 py-2 text-white">
        <p className="truncate text-sm font-medium">{doc.title}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden /> Print
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await downloadPdf(doc);
              } catch (err) {
                setError(`The PDF could not be made: ${describeError(err)}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            <FileDown className="size-4" aria-hidden /> PDF
          </Button>
          <Button size="sm" variant="secondary" onClick={() => downloadCsv(doc)}>
            <Sheet className="size-4" aria-hidden /> CSV
          </Button>
        </div>
      </div>
      {error && (
        <div className="no-print mx-auto max-w-5xl px-4 pt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <ReportView doc={doc} />
    </div>
  );
}

export function ReportView({ doc }: { doc: ReportDoc }) {
  const h = doc.header;
  return (
    <article className="mx-auto my-4 max-w-5xl bg-white p-6 text-slate-900 shadow-sm sm:p-10 print:m-0 print:max-w-none print:p-0 print:shadow-none">
      <header className="flex items-center gap-4 border-b border-slate-300 pb-4">
        {h.logoUrl && <img src={h.logoUrl} alt="" className="size-14 object-contain" />}
        <div className="min-w-0">
          <p className="text-lg font-bold">{h.orgName}</p>
          {(h.collegeName || h.schoolName) && <p className="text-sm text-slate-600">{[h.collegeName, h.schoolName].filter(Boolean).join(' · ')}</p>}
          <p className="text-sm text-slate-600">Academic year {h.academicYear}</p>
        </div>
      </header>
      {h.headerText && <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{h.headerText}</p>}

      <h1 className="mt-5 text-xl font-bold">{doc.title}</h1>
      {doc.subtitle && <p className="text-sm font-medium text-slate-700">{doc.subtitle}</p>}
      {doc.filters.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">
          {doc.filters.map((f) => (
            <span key={f.label} className="mr-4 inline-block">
              {f.label}: <span className="font-medium text-slate-700">{f.value}</span>
            </span>
          ))}
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-slate-200 p-3 text-sm sm:grid-cols-4 print:break-inside-avoid">
        {doc.summary.map((s) => (
          <div key={s.label}>
            <dt className="text-xs text-slate-500">{s.label}</dt>
            <dd className="font-semibold tabular-nums">{formatCell(s.value, s.type, doc.timezone)}</dd>
          </div>
        ))}
      </dl>

      {doc.tables.map((t) => (
        <ReportTableView key={t.title} table={t} timeZone={doc.timezone} />
      ))}

      {(doc.notes.length > 0 || doc.truncatedAt) && (
        <ul className="mt-4 space-y-0.5 text-xs text-slate-500">
          {doc.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
          {doc.truncatedAt && <li>Only the first {doc.truncatedAt.toLocaleString()} rows are listed; the totals cover everything.</li>}
        </ul>
      )}

      <section
        className="mt-12 grid gap-8 sm:[grid-template-columns:var(--sig-cols)] print:[grid-template-columns:var(--sig-cols)] print:break-inside-avoid"
        style={{ '--sig-cols': `repeat(${doc.signatories.length}, minmax(0, 1fr))` } as CSSProperties}
      >
        {doc.signatories.map((s) => (
          <div key={s.label} className="text-sm">
            <p className="text-slate-600">{s.label}</p>
            <div className="mt-10 border-b border-slate-400" />
            <p className="mt-1 font-semibold">{s.name || ' '}</p>
            <p className="text-slate-600">{s.title || ' '}</p>
          </div>
        ))}
      </section>

      <p className="mt-8 text-[11px] text-slate-400">
        Generated {formatCell(doc.generatedAt, 'datetime', doc.timezone)} by {doc.generatedBy}
      </p>

      {doc.annex && doc.annex.groups.length > 0 && <AnnexView annex={doc.annex} />}
    </article>
  );
}

/** The supporting documents, after everything else: every photo and PDF page on its own page, labelled. */
function AnnexView({ annex }: { annex: ReportAnnex }) {
  const pages = useQuery({
    queryKey: ['report-annex', annex.groups.flatMap((g) => g.files.map((f) => f.url)).join(',')],
    staleTime: Infinity,
    queryFn: async () =>
      Promise.all(annex.groups.map(async (g) => ({ group: g, images: (await Promise.all(g.files.map(fileImages))).flat() }))),
  });
  return (
    <section className="mt-10 border-t-2 border-slate-300 pt-6 print:mt-0 print:border-0 print:pt-0">
      <h2 className="text-lg font-bold print:hidden">{annex.title}</h2>
      {pages.isLoading && (
        <div className="py-10 text-center">
          <Spinner label="Loading the receipts" />
        </div>
      )}
      {pages.error && <Alert className="mt-3">{describeError(pages.error)}</Alert>}
      {pages.data?.map(({ group, images }) =>
        images.map((img, i) => (
          <figure key={`${group.ref}-${i}`} className="mt-6 break-before-page break-inside-avoid print:mt-0 print:flex print:h-[calc(100vh-1px)] print:flex-col">
            <figcaption className="mb-2 text-sm">
              <span className="font-bold">
                {annex.title} · {group.ref}
              </span>{' '}
              <span className="text-slate-600">{group.caption}</span>
              {images.length > 1 && (
                <span className="text-slate-500">
                  {' '}
                  ({i + 1} of {images.length})
                </span>
              )}
            </figcaption>
            <img src={img.src} alt={`${group.ref} ${group.caption}`} className="mx-auto max-h-[80vh] max-w-full border border-slate-200 object-contain print:min-h-0 print:flex-1 print:border-0" />
          </figure>
        )),
      )}
    </section>
  );
}

function ReportTableView({ table: t, timeZone }: { table: ReportTable; timeZone: string }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold">{t.title}</h2>
      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-slate-100 print:bg-slate-100">
            <tr>
              {t.columns.map((c) => (
                <th key={c.key} scope="col" className={cx('border border-slate-300 px-2 py-1.5 font-semibold', isNumeric(c.type) ? 'text-right' : 'text-left')}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.length === 0 ? (
              <tr>
                <td colSpan={t.columns.length} className="border border-slate-300 px-2 py-3 text-center text-slate-500">
                  {t.emptyText ?? 'Nothing to show.'}
                </td>
              </tr>
            ) : (
              t.rows.map((r, i) => (
                <tr key={i} className="print:break-inside-avoid">
                  {t.columns.map((c) => (
                    <td key={c.key} className={cx('border border-slate-300 px-2 py-1 align-top', isNumeric(c.type) && 'text-right tabular-nums whitespace-nowrap')}>
                      {formatCell(r[c.key] ?? null, c.type, timeZone)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {t.totals && (
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                {t.columns.map((c) => (
                  <td key={c.key} className={cx('border border-slate-300 px-2 py-1.5', isNumeric(c.type) && 'text-right tabular-nums whitespace-nowrap')}>
                    {formatCell(t.totals![c.key] ?? null, c.type, timeZone)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
