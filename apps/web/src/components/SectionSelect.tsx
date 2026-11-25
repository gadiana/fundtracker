import { yearLevelLabel } from '../lib/format';
import type { SectionOption } from '../lib/types';
import { Select } from './ui';

/**
 * The sections that fit a program and year level. Each section belongs to one of each; when
 * either isn't chosen (a filter), every section shows with its program and year ("BSIT 1-A").
 */
export function sectionChoices(sections: SectionOption[], programs: { id: string; code: string }[], programId?: string, yearLevel?: number | string) {
  const year = yearLevel ? Number(yearLevel) : undefined;
  const code = new Map(programs.map((p) => [p.id, p.code]));
  return sections
    .filter((s) => (!programId || s.programId === programId) && (!year || s.yearLevel === year))
    .filter((s) => code.has(s.programId))
    .sort((a, b) => (code.get(a.programId) ?? '').localeCompare(code.get(b.programId) ?? '') || a.yearLevel - b.yearLevel || a.name.localeCompare(b.name))
    .map((s) => ({ id: s.id, label: programId && year ? s.name : `${code.get(s.programId)} ${s.yearLevel}-${s.name}` }));
}

/** Whether a section still fits after the program or year level changed. */
export const sectionFits = (sections: SectionOption[], sectionId: string, programId: string, yearLevel: number | string) =>
  !sectionId || sections.some((s) => s.id === sectionId && s.programId === programId && s.yearLevel === Number(yearLevel));

/** A section filter for lists and reports: narrows to the chosen program and year when given. */
export function SectionFilter({
  sections,
  programs,
  programId,
  yearLevel,
  value,
  onChange,
  className,
}: {
  sections: SectionOption[];
  programs: { id: string; code: string }[];
  programId?: string;
  yearLevel?: string;
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const choices = sectionChoices(sections, programs, programId, yearLevel);
  const narrowed = programId && yearLevel;
  return (
    <Select aria-label="Section" value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{narrowed ? `All sections of ${programs.find((p) => p.id === programId)?.code ?? ''} ${yearLevelLabel(Number(yearLevel))}` : 'All sections'}</option>
      {choices.map((c) => (
        <option key={c.id} value={c.id}>
          {narrowed ? `Section ${c.label}` : c.label}
        </option>
      ))}
    </Select>
  );
}
