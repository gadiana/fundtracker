import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Bold, Copy, ImagePlus, Maximize2, Plus, Trash2, X } from 'lucide-react';
import {
  LOGO_MIME_TYPES,
  REPORT_KINDS,
  REPORT_TITLES,
  fillHeaderText,
  type HeaderAlignment,
  type ReportDoc,
  type ReportFormat,
  type ReportKind,
  type ReportLogo,
} from '@sft/shared';
import { Alert, Button, Checkbox, Field, Input, Select, cx } from '../../components/ui';
import { describeError, uploadFile } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Settings } from '../../lib/types';
import { ReportView } from '../reports/ReportPrintPage';
import { SettingsCard } from './form';

const KEYS = ['reportFormats'] as const;
const MAX_LOGOS = 4;
const MAX_LINES = 10;
const MAX_SIGNATORIES = 8;
const ORDINALS = ['1st', '2nd', '3rd', '4th'];
const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32];

/** Settings → Reports: each report's paper, letterhead and signatories, with a preview. */
export function ReportsSection({ settings }: { settings: Settings }) {
  return (
    <SettingsCard
      title="Report formats"
      description="How each printed report looks. Pick a report, change its paper, header and signatories, and check the preview before saving."
      settings={settings}
      keys={KEYS}
    >
      {({ values, set, readOnly }) => (
        <FormatEditor formats={values.reportFormats} onChange={(f) => set('reportFormats', f)} readOnly={readOnly} settings={settings} />
      )}
    </SettingsCard>
  );
}

const move = <T,>(list: T[], i: number, to: number) => {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(i, 1);
  next.splice(to, 0, item!);
  return next;
};

function FormatEditor({
  formats,
  onChange,
  readOnly,
  settings,
}: {
  formats: Record<ReportKind, ReportFormat>;
  onChange: (formats: Record<ReportKind, ReportFormat>) => void;
  readOnly: boolean;
  settings: Settings;
}) {
  const { ay } = useAuth();
  const [kind, setKind] = useState<ReportKind>('collections');
  // logos uploaded but not saved yet are shown from the file picked
  const [localLogos, setLocalLogos] = useState<Record<string, string>>({});
  const [large, setLarge] = useState(false);
  const f = formats[kind];
  const update = (patch: Partial<ReportFormat>) => onChange({ ...formats, [kind]: { ...f, ...patch } });
  const logoSrc = (l: ReportLogo) =>
    l === 'org' ? settings.logoUrl : (localLogos[l] ?? `/api/public/ays/${settings.academicYearId}/report-logo/${l}`);

  const copyToAll = () =>
    onChange(
      Object.fromEntries(
        REPORT_KINDS.map((k) => [
          k,
          // signatories differ per report, so they stay
          { ...formats[k], paperSize: f.paperSize, logosLeft: f.logosLeft, logosRight: f.logosRight, logoSize: f.logoSize, headerLines: f.headerLines },
        ]),
      ) as Record<ReportKind, ReportFormat>,
    );

  const doc = sampleDoc(kind, f, settings, ay?.label ?? '', logoSrc);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Report" htmlFor="format-kind" className="min-w-56 flex-1">
          <Select id="format-kind" value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>
            {REPORT_KINDS.map((k) => (
              <option key={k} value={k}>
                {REPORT_TITLES[k]}
              </option>
            ))}
          </Select>
        </Field>
        {!readOnly && (
          <Button variant="secondary" onClick={copyToAll} title="Signatories stay as each report has them">
            <Copy className="size-4" aria-hidden /> Use this paper and header for every report
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <Field label="Paper size" htmlFor="format-paper">
            <Select id="format-paper" value={f.paperSize} disabled={readOnly} onChange={(e) => update({ paperSize: e.target.value as ReportFormat['paperSize'] })}>
              <option value="A4">A4 (210 × 297 mm)</option>
              <option value="LETTER">Letter (8.5 × 11 in)</option>
              <option value="LEGAL">Legal (8.5 × 14 in)</option>
            </Select>
          </Field>

          <Group title="Logos in the header" hint="The 1st logo on each side is the one next to the header text.">
            <div className="grid gap-4 sm:grid-cols-2">
              {(['logosLeft', 'logosRight'] as const).map((side) => (
                <LogoList
                  key={side}
                  title={side === 'logosLeft' ? 'Left of the text' : 'Right of the text'}
                  logos={f[side]}
                  src={logoSrc}
                  readOnly={readOnly}
                  orgLogo={Boolean(settings.logoUrl)}
                  onChange={(logos) => update({ [side]: logos })}
                  onUploaded={(id, url) => setLocalLogos((m) => ({ ...m, [id]: url }))}
                />
              ))}
            </div>
            <Field label={`Logo size: ${f.logoSize} pt`} htmlFor="format-logo-size">
              <input
                id="format-logo-size"
                type="range"
                min={24}
                max={120}
                step={4}
                value={f.logoSize}
                disabled={readOnly}
                onChange={(e) => update({ logoSize: Number(e.target.value) })}
                className="w-full accent-brand-600"
              />
            </Field>
          </Group>

          <Group title="Header text" hint={<>One or more lines between the logos. Write {'{year}'} for the academic year.</>}>
            <ol className="space-y-3">
              {f.headerLines.map((line, i) => {
                const setLine = (patch: Partial<typeof line>) => update({ headerLines: f.headerLines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
                return (
                  <li key={i} className="space-y-2 rounded-lg border border-slate-200 p-3">
                    <Input
                      aria-label={`Header line ${i + 1}`}
                      value={line.text}
                      disabled={readOnly}
                      placeholder="e.g. Republic of the Philippines"
                      maxLength={200}
                      onChange={(e) => setLine({ text: e.target.value })}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <IconToggle label="Bold" active={line.bold} disabled={readOnly} onClick={() => setLine({ bold: !line.bold })}>
                        <Bold className="size-4" aria-hidden />
                      </IconToggle>
                      <select
                        aria-label={`Text size of line ${i + 1}`}
                        value={line.size}
                        disabled={readOnly}
                        onChange={(e) => setLine({ size: Number(e.target.value) })}
                        className="h-8 rounded-lg border border-slate-300 bg-surface px-2 text-sm"
                      >
                        {FONT_SIZES.map((s) => (
                          <option key={s} value={s}>
                            {s} pt
                          </option>
                        ))}
                      </select>
                      <div className="flex rounded-lg border border-slate-300 p-0.5" role="group" aria-label={`Alignment of line ${i + 1}`}>
                        {ALIGNMENTS.map(({ value, label, Icon }) => (
                          <IconToggle key={value} label={label} active={line.align === value} disabled={readOnly} onClick={() => setLine({ align: value })} bare>
                            <Icon className="size-4" aria-hidden />
                          </IconToggle>
                        ))}
                      </div>
                      <RowActions
                        what={`header line ${i + 1}`}
                        readOnly={readOnly}
                        onUp={i > 0 ? () => update({ headerLines: move(f.headerLines, i, i - 1) }) : undefined}
                        onDown={i < f.headerLines.length - 1 ? () => update({ headerLines: move(f.headerLines, i, i + 1) }) : undefined}
                        onRemove={() => update({ headerLines: f.headerLines.filter((_, j) => j !== i) })}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
            {f.headerLines.length === 0 && <p className="text-sm text-slate-500">No header text.</p>}
            {!readOnly && f.headerLines.length < MAX_LINES && (
              <Button variant="secondary" size="sm" onClick={() => update({ headerLines: [...f.headerLines, { text: '', bold: false, size: 11, align: 'center' }] })}>
                <Plus className="size-4" aria-hidden /> Add header line
              </Button>
            )}
          </Group>

          <Group
            title="Signatories"
            hint={
              <>
                Leave the name blank to print the name of whoever generates the report. Only checked signatories are printed.
                {kind === 'liquidation' && ' The liquidation report also lists who prepared and approved it, and who received any money.'}
              </>
            }
          >
            <ol className="space-y-3">
              {f.signatories.map((s, i) => {
                const setSig = (patch: Partial<typeof s>) => update({ signatories: f.signatories.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <li key={i} className={cx('space-y-2 rounded-lg border p-3', s.show ? 'border-slate-200' : 'border-dashed border-slate-300 bg-slate-50')}>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Field label="Signs as" htmlFor={`sig-label-${i}`}>
                        <Input id={`sig-label-${i}`} value={s.label} disabled={readOnly} placeholder="Noted by" maxLength={60} onChange={(e) => setSig({ label: e.target.value })} />
                      </Field>
                      <Field label="Name" htmlFor={`sig-name-${i}`}>
                        <Input id={`sig-name-${i}`} value={s.name} disabled={readOnly} placeholder="Whoever prints it" maxLength={150} onChange={(e) => setSig({ name: e.target.value })} />
                      </Field>
                      <Field label="Position" htmlFor={`sig-position-${i}`}>
                        <Input id={`sig-position-${i}`} value={s.position} disabled={readOnly} placeholder="Adviser" maxLength={150} onChange={(e) => setSig({ position: e.target.value })} />
                      </Field>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Checkbox checked={s.show} disabled={readOnly} onChange={(show) => setSig({ show })} label="Show on the report" />
                      <RowActions
                        what={`signatory ${i + 1}`}
                        readOnly={readOnly}
                        onUp={i > 0 ? () => update({ signatories: move(f.signatories, i, i - 1) }) : undefined}
                        onDown={i < f.signatories.length - 1 ? () => update({ signatories: move(f.signatories, i, i + 1) }) : undefined}
                        onRemove={() => update({ signatories: f.signatories.filter((_, j) => j !== i) })}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
            {f.signatories.length === 0 && <p className="text-sm text-slate-500">No signatories{kind === 'liquidation' ? ' besides the ones above' : ''}.</p>}
            {!readOnly && f.signatories.length < MAX_SIGNATORIES && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => update({ signatories: [...f.signatories, { label: '', name: '', position: '', show: true }] })}
              >
                <Plus className="size-4" aria-hidden /> Add signatory
              </Button>
            )}
          </Group>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">Preview</p>
            <Button variant="ghost" size="sm" onClick={() => setLarge(true)}>
              <Maximize2 className="size-4" aria-hidden /> Larger
            </Button>
          </div>
          <PaperPreview doc={doc} />
          <p className="mt-2 text-xs text-slate-500">Sample numbers; the real report has its own.</p>
        </div>
      </div>

      {large && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Report preview" onClick={() => setLarge(false)}>
          <div className="mx-auto max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => setLarge(false)}>
                <X className="size-4" aria-hidden /> Close
              </Button>
            </div>
            <PaperPreview doc={doc} />
          </div>
        </div>
      )}
    </div>
  );
}

const ALIGNMENTS: { value: HeaderAlignment; label: string; Icon: typeof AlignLeft }[] = [
  { value: 'left', label: 'Align left', Icon: AlignLeft },
  { value: 'center', label: 'Center', Icon: AlignCenter },
  { value: 'right', label: 'Align right', Icon: AlignRight },
];

function Group({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function IconToggle({ label, active, disabled, onClick, bare, children }: { label: string; active: boolean; disabled: boolean; onClick: () => void; bare?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'grid size-8 place-items-center rounded-md text-slate-600 disabled:cursor-not-allowed disabled:opacity-60',
        !bare && 'border border-slate-300',
        active ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-100',
        bare && 'size-7',
      )}
    >
      {children}
    </button>
  );
}

function RowActions({ what, readOnly, onUp, onDown, onRemove }: { what: string; readOnly: boolean; onUp?: () => void; onDown?: () => void; onRemove: () => void }) {
  if (readOnly) return null;
  const btn = 'grid size-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div className="ml-auto flex items-center gap-0.5">
      <button type="button" className={btn} disabled={!onUp} onClick={onUp} title="Move up" aria-label={`Move ${what} up`}>
        <ArrowUp className="size-4" aria-hidden />
      </button>
      <button type="button" className={btn} disabled={!onDown} onClick={onDown} title="Move down" aria-label={`Move ${what} down`}>
        <ArrowDown className="size-4" aria-hidden />
      </button>
      <button type="button" className={cx(btn, 'hover:text-red-600')} onClick={onRemove} title="Remove" aria-label={`Remove ${what}`}>
        <Trash2 className="size-4" aria-hidden />
      </button>
    </div>
  );
}

function LogoList({
  title,
  logos,
  src,
  readOnly,
  orgLogo,
  onChange,
  onUploaded,
}: {
  title: string;
  logos: ReportLogo[];
  src: (l: ReportLogo) => string | null;
  readOnly: boolean;
  orgLogo: boolean;
  onChange: (logos: ReportLogo[]) => void;
  onUploaded: (id: string, url: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const full = logos.length >= MAX_LOGOS;

  async function upload(file: File | undefined) {
    if (!file) return;
    setError('');
    if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
      setError('Use a PNG, JPEG or WebP image.');
      return;
    }
    setBusy(true);
    try {
      const uploaded = await uploadFile<{ id: string }>('/uploads', file);
      onUploaded(uploaded.id, URL.createObjectURL(file));
      onChange([...logos, uploaded.id]);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {logos.length === 0 ? (
        <p className="text-sm text-slate-500">No logo.</p>
      ) : (
        <ol className="space-y-1.5">
          {logos.map((l, i) => (
            <li key={`${l}-${i}`} className="flex items-center gap-2">
              <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded border border-slate-200 bg-white">
                {src(l) ? <img src={src(l)!} alt="" className="size-full object-contain" /> : null}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                {ORDINALS[i]}
                <span className="block truncate text-xs text-slate-500">{l === 'org' ? 'Organization' : 'Image'}</span>
              </span>
              <RowActions
                what={`${ORDINALS[i]} logo`}
                readOnly={readOnly}
                onUp={i > 0 ? () => onChange(move(logos, i, i - 1)) : undefined}
                onDown={i < logos.length - 1 ? () => onChange(move(logos, i, i + 1)) : undefined}
                onRemove={() => onChange(logos.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ol>
      )}
      {error && <Alert>{error}</Alert>}
      {!readOnly && !full && (
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept={LOGO_MIME_TYPES.join(',')} className="sr-only" tabIndex={-1} onChange={(e) => upload(e.target.files?.[0])} />
          <Button variant="secondary" size="sm" loading={busy} onClick={() => input.current?.click()}>
            <ImagePlus className="size-4" aria-hidden /> Upload logo
          </Button>
          {orgLogo && !logos.includes('org') && (
            <Button variant="ghost" size="sm" onClick={() => onChange([...logos, 'org'])}>
              <Plus className="size-4" aria-hidden /> Organization logo
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Paper sizes in millimetres, as the browser prints them. */
const PAPER_MM = { A4: [210, 297], LETTER: [215.9, 279.4], LEGAL: [215.9, 355.6] } as const;
const PX_PER_MM = 96 / 25.4;

/** The report as a sheet of its paper size, scaled down to fit. */
function PaperPreview({ doc }: { doc: ReportDoc }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current!;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [mmW, mmH] = PAPER_MM[doc.paperSize];
  const pageW = mmW * PX_PER_MM;
  const pageH = mmH * PX_PER_MM;
  const scale = width ? width / pageW : 0;
  return (
    <div ref={box} className="force-light w-full">
      <div className="overflow-hidden rounded-sm bg-white shadow-md ring-1 ring-slate-300" style={{ height: pageH * scale }}>
        <div style={{ width: pageW, height: pageH, transform: `scale(${scale})`, transformOrigin: 'top left' }} aria-hidden>
          <ReportView doc={doc} preview />
        </div>
      </div>
    </div>
  );
}

/** A made-up report in the format being edited. */
function sampleDoc(kind: ReportKind, f: ReportFormat, settings: Settings, academicYear: string, logoSrc: (l: ReportLogo) => string | null): ReportDoc {
  const logos = (list: ReportLogo[]) => list.map(logoSrc).filter((u): u is string => Boolean(u));
  return {
    kind,
    title: REPORT_TITLES[kind],
    filters: [{ label: 'Period', value: 'Sample' }],
    summary: [
      { label: 'Total', value: 1_250_000, type: 'money' },
      { label: 'Transactions', value: 42, type: 'number' },
    ],
    tables: [
      {
        title: 'Sample table',
        columns: [
          { key: 'item', label: 'Item' },
          { key: 'amount', label: 'Amount', type: 'money' },
        ],
        rows: [
          { item: 'First row', amount: 500_000 },
          { item: 'Second row', amount: 750_000 },
        ],
        totals: { item: 'Total', amount: 1_250_000 },
      },
    ],
    notes: [],
    header: {
      orgName: settings.orgName,
      academicYear,
      logosLeft: logos(f.logosLeft),
      logosRight: logos(f.logosRight),
      logoSize: f.logoSize,
      lines: f.headerLines.filter((l) => l.text).map((l) => ({ ...l, text: fillHeaderText(l.text, academicYear) })),
    },
    signatories: [
      ...(kind === 'liquidation'
        ? [
            { label: 'Prepared by', name: 'Who submitted it', title: 'Position' },
            { label: 'Approved by', name: 'Who approved it', title: 'Position' },
          ]
        : []),
      ...f.signatories.filter((s) => s.show).map((s) => ({ label: s.label, name: s.name || 'Whoever prints it', title: s.position })),
    ],
    paperSize: f.paperSize,
    timezone: settings.timezone,
    generatedAt: new Date().toISOString(),
    generatedBy: 'Preview',
  };
}
