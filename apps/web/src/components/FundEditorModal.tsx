import { useState } from 'react';
import { Lock } from 'lucide-react';
import { api, ApiError, describeError } from '../lib/api';
import { formatMoney, yearLevelLabel } from '../lib/format';
import type { ChargeSync, Fund, StudentMeta } from '../lib/types';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';
import { MoneyInput } from './MoneyInput';
import { Alert, Button, Checkbox, Field, Input, Textarea, Toggle } from './ui';

interface Values {
  name: string;
  amountPerStudent: number | null;
  isMandatory: boolean;
  isConfidential: boolean;
  yearLevels: number[];
  allPrograms: boolean;
  programIds: string[];
  notes: string;
}

const LABELS = { name: 'Name', amountPerStudent: 'Amount', yearLevels: 'Year levels', programIds: 'Programs' };

export function describeSync(s: ChargeSync) {
  const parts = [];
  if (s.added + s.reactivated) parts.push(`${s.added + s.reactivated} charge(s) added`);
  if (s.cancelled) parts.push(`${s.cancelled} unpaid charge(s) removed`);
  if (s.keptWithPayments) parts.push(`${s.keptWithPayments} kept because they already have payments`);
  return parts.length ? parts.join(', ') : 'no charges changed';
}

export function FundEditorModal({
  meta,
  fund,
  onClose,
  onSaved,
}: {
  meta: StudentMeta;
  fund?: Fund;
  onClose: () => void;
  onSaved: (fund: Fund, charges: ChargeSync) => void;
}) {
  const [values, setValues] = useState<Values>(() =>
    fund
      ? {
          name: fund.name,
          amountPerStudent: fund.amountPerStudent,
          isMandatory: fund.isMandatory,
          isConfidential: fund.isConfidential,
          yearLevels: fund.yearLevels,
          allPrograms: fund.allPrograms,
          programIds: fund.programs.map((p) => p.id),
          notes: fund.notes ?? '',
        }
      : {
          name: '',
          amountPerStudent: null,
          isMandatory: true,
          isConfidential: false,
          yearLevels: Array.from({ length: meta.yearLevelCount }, (_, i) => i + 1),
          allPrograms: true,
          programIds: [],
          notes: '',
        },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [applicable, setApplicable] = useState<number | null>(null);
  const set = <K extends keyof Values>(k: K, v: Values[K]) => setValues((prev) => ({ ...prev, [k]: v }));
  const toggleIn = (list: number[] | string[], item: number | string, on: boolean) =>
    (on ? [...list, item] : list.filter((x) => x !== item)) as never;

  const ready =
    values.name.trim() !== '' &&
    values.amountPerStudent !== null &&
    values.yearLevels.length > 0 &&
    (values.allPrograms || values.programIds.length > 0);

  async function openConfirm() {
    setApplicable(null);
    setConfirming(true);
    const q = new URLSearchParams({
      yearLevels: values.yearLevels.join(','),
      allPrograms: String(values.allPrograms),
      programIds: values.programIds.join(','),
    });
    api<{ count: number }>(`/funds/applicable-count?${q}`)
      .then((r) => setApplicable(r.count))
      .catch(() => setApplicable(null));
  }

  async function save() {
    const body = {
      name: values.name,
      amountPerStudent: values.amountPerStudent,
      isMandatory: values.isMandatory,
      isConfidential: values.isConfidential,
      yearLevels: values.yearLevels,
      allPrograms: values.allPrograms,
      programIds: values.allPrograms ? [] : values.programIds,
      notes: values.notes || null,
    };
    if (fund?.amountLocked) delete (body as Partial<typeof body>).amountPerStudent;
    try {
      const res = fund
        ? await api<{ fund: Fund; charges: ChargeSync }>(`/funds/${fund.id}`, { method: 'PATCH', body })
        : await api<{ fund: Fund; charges: ChargeSync }>('/funds', { method: 'POST', body });
      onSaved(res.fund, res.charges);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      throw new Error(describeError(err, LABELS));
    }
  }

  const who = `${values.yearLevels.map(yearLevelLabel).join(', ')} · ${
    values.allPrograms ? 'all programs' : meta.programs.filter((p) => values.programIds.includes(p.id)).map((p) => p.code).join(', ')
  }`;

  return (
    <>
      <Modal
        open
        title={fund ? `Edit ${fund.name}` : 'New fund'}
        subtitle={fund ? undefined : 'Every active student it applies to is charged right away; students added later are charged automatically.'}
        onClose={onClose}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={openConfirm} disabled={!ready}>
              {fund ? 'Save changes' : 'Create fund'}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            <Field label="Fund name" htmlFor="fund-name" error={errors.name}>
              <Input id="fund-name" value={values.name} placeholder="e.g. Student Fee" onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field
              label="Amount per student"
              htmlFor="fund-amount"
              error={errors.amountPerStudent}
              hint={fund?.amountLocked ? undefined : 'Locked once the first payment is recorded.'}
            >
              <MoneyInput id="fund-amount" value={values.amountPerStudent} disabled={fund?.amountLocked} onChange={(v) => set('amountPerStudent', v)} />
            </Field>
          </div>
          {fund?.amountLocked && (
            <Alert tone="info">
              <span className="inline-flex items-center gap-1.5">
                <Lock className="size-3.5" aria-hidden /> Collection has started, so the amount ({formatMoney(fund.amountPerStudent)}) can no longer change.
              </span>
            </Alert>
          )}

          <Toggle
            id="fund-mandatory"
            label="Mandatory"
            description="Students are Cleared only when every mandatory fund is fully paid. Optional funds don't affect clearance."
            checked={values.isMandatory}
            onChange={(v) => set('isMandatory', v)}
          />
          <Toggle
            id="fund-confidential"
            label="Confidential"
            description="Hidden from the public and from staff, except positions allowed to see confidential funds. Students' charges show it as “Restricted fund”."
            checked={values.isConfidential}
            onChange={(v) => set('isConfidential', v)}
          />

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-800">Year levels</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {Array.from({ length: meta.yearLevelCount }, (_, i) => i + 1).map((y) => (
                <Checkbox key={y} checked={values.yearLevels.includes(y)} onChange={(on) => set('yearLevels', toggleIn(values.yearLevels, y, on))} label={yearLevelLabel(y)} />
              ))}
            </div>
            {errors.yearLevels && <p className="mt-1 text-sm text-red-600">{errors.yearLevels}</p>}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium text-slate-800">Programs</legend>
            <Checkbox checked={values.allPrograms} onChange={(v) => set('allPrograms', v)} label="All programs" />
            {!values.allPrograms && (
              <div className="flex flex-wrap gap-x-5 gap-y-2 pl-6">
                {meta.programs.map((p) => (
                  <Checkbox key={p.id} checked={values.programIds.includes(p.id)} onChange={(on) => set('programIds', toggleIn(values.programIds, p.id, on))} label={p.code} />
                ))}
              </div>
            )}
            {errors.programIds && <p className="text-sm text-red-600">{errors.programIds}</p>}
          </fieldset>

          <Field label="Notes" htmlFor="fund-notes" optional>
            <Textarea id="fund-notes" rows={2} value={values.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirming}
        title={fund ? `Save changes to ${fund.name}?` : `Create ${values.name}?`}
        description={
          <div className="space-y-1">
            <p>
              {values.amountPerStudent !== null && formatMoney(values.amountPerStudent)} per student · {values.isMandatory ? 'mandatory' : 'optional'}
              {values.isConfidential ? ' · confidential' : ''}
            </p>
            <p>For {who}.</p>
            <p className="font-medium text-slate-800">
              {applicable === null
                ? 'Counting students…'
                : fund
                  ? `${applicable} active student(s) match. Charges are added or removed to match; charges with payments are never removed.`
                  : `${applicable} active student(s) will be charged now.`}
            </p>
          </div>
        }
        confirmLabel={fund ? 'Save' : 'Create fund'}
        onConfirm={save}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
