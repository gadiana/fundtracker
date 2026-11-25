import { useState } from 'react';
import { sectionChoices, sectionFits } from './SectionSelect';
import { api, describeError } from '../lib/api';
import { yearLevelLabel } from '../lib/format';
import type { Student, StudentMeta } from '../lib/types';
import { ConfirmDialog } from './ConfirmDialog';
import { Field, Select } from './ui';

/** Staff confirm (or correct) a promoted student's course, year and section; charges are created on confirm. */
export function ConfirmPlacementDialog({
  student,
  meta,
  onClose,
  onConfirmed,
}: {
  student: Student;
  meta: StudentMeta;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [placement, setPlacement] = useState({ programId: student.program.id, yearLevel: student.yearLevel, sectionId: student.section?.id ?? '' });
  /** a section belongs to one program and year level: choose again when either changes */
  const place = (change: Partial<typeof placement>) => {
    const next = { ...placement, ...change };
    if (!sectionFits(meta.sections, next.sectionId, next.programId, next.yearLevel)) next.sectionId = '';
    setPlacement(next);
  };
  const sections = sectionChoices(meta.sections, meta.programs, placement.programId, placement.yearLevel);

  async function confirm() {
    try {
      await api(`/students/${student.id}/confirm-profile`, { method: 'POST', body: { ...placement, sectionId: placement.sectionId || null } });
    } catch (err) {
      throw new Error(describeError(err));
    }
    onConfirmed();
  }

  return (
    <ConfirmDialog
      open
      title={`Confirm ${student.name}'s course, year and section`}
      description="This student was copied from the previous academic year one level up. Check against their current enrollment before collecting. Their charges are created when you confirm."
      confirmLabel="Confirm"
      confirmDisabled={!placement.programId}
      onConfirm={confirm}
      onClose={onClose}
    >
      <div className="grid gap-3">
        <Field label="Program" htmlFor="place-program">
          <Select id="place-program" value={placement.programId} onChange={(e) => place({ programId: e.target.value })}>
            {meta.programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} – {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Year" htmlFor="place-year">
            <Select id="place-year" value={placement.yearLevel} onChange={(e) => place({ yearLevel: Number(e.target.value) })}>
              {Array.from({ length: meta.yearLevelCount }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {yearLevelLabel(n)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Section" htmlFor="place-section">
            <Select id="place-section" value={placement.sectionId} onChange={(e) => setPlacement({ ...placement, sectionId: e.target.value })}>
              <option value="">{sections.length ? 'None' : 'No sections for this year'}</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </ConfirmDialog>
  );
}
