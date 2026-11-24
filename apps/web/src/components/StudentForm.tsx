import type { ChangeEvent } from 'react';
import { Link } from 'react-router';
import { TriangleAlert } from 'lucide-react';
import { ApiError } from '../lib/api';
import { yearLevelLabel } from '../lib/format';
import type { DuplicateMatch, StudentMeta } from '../lib/types';
import { Badge, Checkbox, Field, Input, Select, Textarea } from './ui';

export interface StudentFormValues {
  studentNumber: string;
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  programId: string;
  yearLevel: number;
  sectionId: string;
  email: string;
  contactNo: string;
}

export const EMPTY_STUDENT: StudentFormValues = {
  studentNumber: '',
  firstName: '',
  middleName: '',
  lastName: '',
  suffix: '',
  programId: '',
  yearLevel: 1,
  sectionId: '',
  email: '',
  contactNo: '',
};

export interface DuplicateState {
  level: 'exact' | 'similar';
  canOverride: boolean;
  matches: DuplicateMatch[];
  message: string;
}

/** Reads a POSSIBLE_DUPLICATE answer from the API, if that's what the error is. */
export function duplicateFromError(err: unknown): DuplicateState | null {
  if (err instanceof ApiError && err.code === 'POSSIBLE_DUPLICATE' && err.details) {
    return { level: err.details.level, canOverride: err.details.canOverride, matches: err.details.matches ?? [], message: err.message };
  }
  return null;
}

export interface DuplicateChoice {
  acknowledgeSimilar: boolean;
  reason: string;
}

/** Shows the likely duplicates and collects the decision the rules require. */
export function DuplicateReview({ state, choice, onChange }: { state: DuplicateState; choice: DuplicateChoice; onChange: (c: DuplicateChoice) => void }) {
  return (
    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="flex gap-2 text-sm font-medium text-amber-900">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {state.message}
      </p>
      <ul className="space-y-1 text-sm">
        {state.matches.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2">
            <Link to={`/students/${m.id}`} target="_blank" className="font-medium text-brand-700 hover:underline">
              {m.name}
            </Link>
            <span className="font-mono text-xs text-slate-600">{m.studentNumber}</span>
            <span className="text-slate-500">
              {m.program} {m.yearLevel}
              {m.section ? `-${m.section}` : ''}
            </span>
            <Badge tone={m.strength === 'exact' ? 'red' : 'amber'}>{m.strength === 'exact' ? 'same name' : 'similar name'}</Badge>
            {m.status !== 'active' && <Badge>{m.status}</Badge>}
          </li>
        ))}
      </ul>
      {state.level === 'similar' && (
        <Checkbox
          checked={choice.acknowledgeSimilar}
          onChange={(v) => onChange({ ...choice, acknowledgeSimilar: v })}
          label="I checked: this is a different person"
        />
      )}
      {state.level === 'exact' && state.canOverride && (
        <Field label="Reason for saving anyway (adviser)" htmlFor="dup-reason" hint="Recorded with the student and in the audit log.">
          <Textarea id="dup-reason" rows={2} value={choice.reason} onChange={(e) => onChange({ ...choice, reason: e.target.value })} />
        </Field>
      )}
      {state.level === 'exact' && !state.canOverride && (
        <p className="text-sm text-amber-900">Only the adviser can save a student whose name exactly matches another student. Ask them to review it.</p>
      )}
    </div>
  );
}

export const duplicateChoiceReady = (state: DuplicateState | null, choice: DuplicateChoice) =>
  !state || (state.level === 'similar' ? choice.acknowledgeSimilar : state.canOverride && choice.reason.trim().length >= 5);

/** The student fields. Duplicate handling is shown by the parent via <DuplicateReview>. */
export function StudentFields({
  values,
  onChange,
  meta,
  errors = {},
  idPrefix = 'st',
}: {
  values: StudentFormValues;
  onChange: (v: StudentFormValues) => void;
  meta: Pick<StudentMeta, 'programs' | 'sections' | 'yearLevelCount'>;
  errors?: Record<string, string>;
  idPrefix?: string;
}) {
  const set = (key: keyof StudentFormValues) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...values, [key]: key === 'yearLevel' ? Number(e.target.value) : e.target.value });
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Student number" htmlFor={id('number')} error={errors.studentNumber} className="sm:col-span-2">
        <Input id={id('number')} autoComplete="off" value={values.studentNumber} onChange={set('studentNumber')} placeholder="e.g. 2026-01234" />
      </Field>
      <Field label="First name" htmlFor={id('first')} error={errors.firstName}>
        <Input id={id('first')} value={values.firstName} onChange={set('firstName')} />
      </Field>
      <Field label="Middle name" htmlFor={id('middle')} optional error={errors.middleName}>
        <Input id={id('middle')} value={values.middleName} onChange={set('middleName')} />
      </Field>
      <Field label="Last name" htmlFor={id('last')} error={errors.lastName}>
        <Input id={id('last')} value={values.lastName} onChange={set('lastName')} />
      </Field>
      <Field label="Suffix" htmlFor={id('suffix')} optional error={errors.suffix}>
        <Input id={id('suffix')} value={values.suffix} onChange={set('suffix')} placeholder="Jr., III" />
      </Field>
      <Field label="Program" htmlFor={id('program')} error={errors.programId}>
        <Select id={id('program')} value={values.programId} onChange={set('programId')}>
          <option value="">Choose…</option>
          {meta.programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} – {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Year" htmlFor={id('year')} error={errors.yearLevel}>
          <Select id={id('year')} value={values.yearLevel} onChange={set('yearLevel')}>
            {Array.from({ length: meta.yearLevelCount }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {yearLevelLabel(n)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Section" htmlFor={id('section')} optional error={errors.sectionId}>
          <Select id={id('section')} value={values.sectionId} onChange={set('sectionId')}>
            <option value="">None</option>
            {meta.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Email" htmlFor={id('email')} optional error={errors.email} hint="Used to email receipts.">
        <Input id={id('email')} type="email" value={values.email} onChange={set('email')} />
      </Field>
      <Field label="Contact number" htmlFor={id('contact')} optional error={errors.contactNo}>
        <Input id={id('contact')} type="tel" value={values.contactNo} onChange={set('contactNo')} />
      </Field>
    </div>
  );
}

/** Body for the API: empty optional fields are left out, section "" becomes null. */
export function studentPayload(v: StudentFormValues) {
  return {
    studentNumber: v.studentNumber,
    firstName: v.firstName,
    middleName: v.middleName || undefined,
    lastName: v.lastName,
    suffix: v.suffix || undefined,
    programId: v.programId,
    yearLevel: v.yearLevel,
    sectionId: v.sectionId || null,
    email: v.email || undefined,
    contactNo: v.contactNo || undefined,
  };
}

export const studentFormReady = (v: StudentFormValues) => Boolean(v.studentNumber.trim() && v.firstName.trim() && v.lastName.trim() && v.programId);

