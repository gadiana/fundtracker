import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Copy, Sparkles } from 'lucide-react';
import { COPY_DEPENDENCIES, COPY_OPTION_LABELS, COPY_OPTIONS, type CopyOption, type CopyOptions } from '@sft/shared';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatMoney } from '../lib/format';
import type { AyEntry, Me, SetupPreview, SetupSummary } from '../lib/types';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';
import { Alert, Badge, Button, Checkbox, Field, RadioCards, Select, Spinner } from './ui';

const NONE: CopyOptions = { adviser: false, staff: false, settings: false, funds: false, carryOver: false, promoteStudents: false };
const DEFAULT_OPTIONS: CopyOptions = { adviser: true, staff: true, settings: true, funds: true, carryOver: false, promoteStudents: false };

const OPTION_HELP: Record<CopyOption, string> = {
  adviser: 'The source year’s adviser becomes this year’s adviser.',
  staff: 'Active officers and collectors keep their positions. Pending and deactivated accounts are not copied.',
  settings: 'Organization details, logo, year levels, programs, sections, positions, approvers and every setting.',
  funds: 'Fund names, amounts, year levels and programs. No charges or payments.',
  carryOver: 'Each fund starts with its remaining balance, labelled “Remaining balance from <fund> AY <year>”.',
  promoteStudents: 'Active students are copied one year level up. Staff confirm each one’s course, year and section before their first payment.',
};

/** Who can run the wizard on an AY that hasn't been set up. */
function withDependencies(options: CopyOptions, option: CopyOption, on: boolean): CopyOptions {
  const next = { ...options, [option]: on };
  if (on) {
    for (const dep of COPY_DEPENDENCIES[option]) Object.assign(next, withDependencies(next, dep, true));
  } else {
    for (const other of COPY_OPTIONS) {
      if (next[other] && COPY_DEPENDENCIES[other].includes(option)) Object.assign(next, withDependencies(next, other, false));
    }
  }
  return next;
}

export function CopyWizard({ target, open, onClose }: { target: { id: string; label: string }; open: boolean; onClose: () => void }) {
  const { me, setMe, switchAy } = useAuth();
  const sources = useMemo(
    () =>
      (me?.academicYears ?? []).filter(
        (a) => a.id !== target.id && !a.needsSetup && a.membership?.role === 'adviser' && a.membership.status === 'active',
      ),
    [me, target.id],
  );

  const [mode, setMode] = useState<'copy' | 'fresh'>(sources.length ? 'copy' : 'fresh');
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [options, setOptions] = useState<CopyOptions>(DEFAULT_OPTIONS);
  const [step, setStep] = useState<'choose' | 'preview' | 'done'>('choose');
  const [confirming, setConfirming] = useState(false);
  const [summary, setSummary] = useState<SetupSummary | null>(null);

  const chosen = mode === 'fresh' ? NONE : options;
  const params = new URLSearchParams(mode === 'copy' && sourceId ? { sourceAyId: sourceId } : {});
  for (const o of COPY_OPTIONS) if (chosen[o]) params.set(o, '1');

  const preview = useQuery({
    queryKey: ['setup-preview', target.id, params.toString()],
    queryFn: () => api<SetupPreview>(`/ays/${target.id}/setup-preview?${params}`),
    enabled: open && step === 'preview',
  });

  async function run() {
    const res = await api<{ summary: SetupSummary; me: Me }>(`/ays/${target.id}/setup`, {
      method: 'POST',
      body: { sourceAyId: mode === 'copy' ? sourceId : undefined, options: chosen },
    });
    setMe(res.me);
    setSummary(res.summary);
    setStep('done');
  }

  function finish() {
    switchAy(target.id);
    onClose();
  }

  const canPreview = mode === 'fresh' || (Boolean(sourceId) && COPY_OPTIONS.some((o) => options[o]));
  const sourceLabel = sources.find((s) => s.id === sourceId)?.label;

  let body;
  let footer;
  if (step === 'choose') {
    body = (
      <div className="space-y-5">
        <RadioCards
          name="setup-mode"
          value={mode}
          onChange={setMode}
          options={[
            ...(sources.length
              ? [{ value: 'copy' as const, label: 'Copy from an existing academic year', description: 'Choose exactly what to bring over.', badge: 'Recommended' }]
              : []),
            {
              value: 'fresh' as const,
              label: 'Start fresh',
              description: 'Default settings and positions. You fill in the organization details yourself.',
            },
          ]}
        />
        {mode === 'copy' && (
          <>
            <Field label="Copy from" htmlFor="copy-source" hint="Only academic years where you are the adviser are listed.">
              <Select id="copy-source" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    AY {s.label}
                    {s.status === 'closed' ? ' (closed)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-medium text-slate-700">What to copy</legend>
              {COPY_OPTIONS.map((o) => {
                const needs = COPY_DEPENDENCIES[o];
                return (
                  <Checkbox
                    key={o}
                    checked={options[o]}
                    onChange={(v) => setOptions((prev) => withDependencies(prev, o, v))}
                    label={COPY_OPTION_LABELS[o]}
                    description={
                      <>
                        {OPTION_HELP[o]}
                        {needs.length > 0 && <span className="text-slate-400"> Needs: {needs.map((n) => COPY_OPTION_LABELS[n].split(' (')[0]).join(', ')}.</span>}
                      </>
                    }
                  />
                );
              })}
            </fieldset>
            <p className="text-xs text-slate-500">Payments, receipts and requests are never copied.</p>
          </>
        )}
      </div>
    );
    footer = (
      <>
        <Button variant="secondary" onClick={onClose}>
          Not now
        </Button>
        <Button onClick={() => setStep('preview')} disabled={!canPreview}>
          Preview <ArrowRight className="size-4" aria-hidden />
        </Button>
      </>
    );
  } else if (step === 'preview') {
    body = preview.isLoading ? (
      <div className="py-10 text-center">
        <Spinner />
      </div>
    ) : preview.error ? (
      <Alert>{errorMessage(preview.error)}</Alert>
    ) : preview.data ? (
      <PreviewList preview={preview.data} />
    ) : null;
    footer = (
      <>
        <Button variant="secondary" onClick={() => setStep('choose')}>
          Back
        </Button>
        <Button onClick={() => setConfirming(true)} disabled={!preview.data}>
          Set up AY {target.label}
        </Button>
      </>
    );
  } else {
    body = summary && <SummaryList summary={summary} />;
    footer = <Button onClick={finish}>Go to AY {target.label}</Button>;
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        closable={step !== 'done'}
        title={step === 'done' ? `AY ${target.label} is ready` : `Set up AY ${target.label}`}
        subtitle={step === 'choose' ? 'This academic year has no settings or staff yet.' : step === 'preview' ? 'Review what will be created.' : undefined}
        footer={footer}
      >
        {body}
      </Modal>
      <ConfirmDialog
        open={confirming}
        title={`Set up AY ${target.label}?`}
        description={
          mode === 'copy'
            ? `Everything in the preview is copied from AY ${sourceLabel} in one step. AY ${sourceLabel} itself is not changed. Setup runs only once per academic year.`
            : 'AY ' + target.label + ' starts with default settings and positions. Setup runs only once per academic year.'
        }
        confirmLabel="Set it up"
        onConfirm={run}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}

function PreviewSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 p-3">
      <h3 className="mb-1.5 text-sm font-semibold text-slate-900">{title}</h3>
      <div className="space-y-1 text-sm text-slate-600">{children}</div>
    </section>
  );
}

function PreviewList({ preview }: { preview: SetupPreview }) {
  const nothing = (label: string) => <p className="text-slate-400">No {label} to copy.</p>;
  return (
    <div className="space-y-3">
      {preview.source && (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Copy className="size-4" aria-hidden /> From AY {preview.source.label} → AY {preview.target.label}
        </p>
      )}
      {preview.warnings.map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}
      {preview.defaults && (
        <PreviewSection title="Default settings">
          <p>Default settings and these positions: {preview.defaults.designations.join(', ')}.</p>
        </PreviewSection>
      )}
      {preview.settings && (
        <PreviewSection title="Settings">
          <p>
            {preview.settings.orgName || 'Organization'} settings, {preview.settings.designations} positions, {preview.settings.programs} programs,{' '}
            {preview.settings.sections} sections, {preview.settings.approvers} extra approver(s) (if they are copied too).
          </p>
        </PreviewSection>
      )}
      {preview.adviser && (
        <PreviewSection title="Adviser">
          <p>
            {preview.adviser.name} {preview.adviser.willCopy ? 'becomes the adviser.' : <Badge tone="amber">skipped</Badge>}
          </p>
        </PreviewSection>
      )}
      {preview.staff && (
        <PreviewSection title={`Staff (${preview.staff.people.length})`}>
          {preview.staff.people.length
            ? preview.staff.people.map((p) => (
                <p key={p.name}>
                  {p.name} <span className="text-slate-400">· {p.position ?? 'no position'}</span>
                </p>
              ))
            : nothing('staff')}
        </PreviewSection>
      )}
      {preview.funds && (
        <PreviewSection title={`Funds (${preview.funds.items.length})`}>
          {preview.funds.items.length
            ? preview.funds.items.map((f) => (
                <p key={f.name} className="flex flex-wrap items-center gap-2">
                  {f.name} <span className="tabular-nums text-slate-500">{formatMoney(f.amountPerStudent)}</span>
                  {!f.isMandatory && <Badge>optional</Badge>}
                  {f.isConfidential && <Badge tone="amber">confidential</Badge>}
                </p>
              ))
            : nothing('funds')}
        </PreviewSection>
      )}
      {preview.carryOver && (
        <PreviewSection title="Carry-over balances">
          {preview.carryOver.items.length ? (
            <>
              {preview.carryOver.items.map((c) => (
                <p key={c.label} className="flex justify-between gap-4">
                  <span>{c.label}</span>
                  <span className="shrink-0 tabular-nums font-medium text-slate-900">{formatMoney(c.amount)}</span>
                </p>
              ))}
              <p className="flex justify-between gap-4 border-t border-slate-100 pt-1 font-medium text-slate-900">
                <span>Total</span>
                <span className="tabular-nums">{formatMoney(preview.carryOver.total)}</span>
              </p>
            </>
          ) : (
            <p className="text-slate-400">No fund has a remaining balance.</p>
          )}
        </PreviewSection>
      )}
      {preview.students && (
        <PreviewSection title="Students">
          <p>
            {preview.students.promotable} student(s) copied one year level up. Each needs a course/year/section check by staff before their first
            payment.
          </p>
        </PreviewSection>
      )}
    </div>
  );
}

function SummaryList({ summary }: { summary: SetupSummary }) {
  const rows = [
    summary.settingsCopied ? 'Settings copied' : 'Default settings created',
    `${summary.designations} positions`,
    summary.programs ? `${summary.programs} programs, ${summary.sections} sections` : null,
    summary.adviserCopied ? 'Adviser copied' : null,
    summary.staff ? `${summary.staff} staff member(s)` : null,
    summary.approvers ? `${summary.approvers} approver(s)` : null,
    summary.funds ? `${summary.funds} fund(s)` : null,
    summary.carryOver.entries ? `${summary.carryOver.entries} carry-over balance(s), ${formatMoney(summary.carryOver.total)} in total` : null,
    summary.students ? `${summary.students} student(s) promoted` : null,
  ].filter(Boolean) as string[];
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r} className="flex items-center gap-2 text-sm text-slate-700">
            <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> {r}
          </li>
        ))}
      </ul>
      {summary.skipped.length > 0 && (
        <Alert tone="warning" title="Skipped">
          <ul className="list-disc pl-4">
            {summary.skipped.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Alert>
      )}
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Sparkles className="size-4" aria-hidden /> Review the settings of the new academic year before you start collecting.
      </p>
    </div>
  );
}
