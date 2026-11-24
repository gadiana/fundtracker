import { z } from 'zod';

export const createAySchema = z.object({
  startYear: z.number().int().min(2000, 'Enter a year from 2000').max(2099, 'Enter a year up to 2099'),
});

export const COPY_OPTIONS = ['adviser', 'staff', 'settings', 'funds', 'carryOver', 'promoteStudents'] as const;
export type CopyOption = (typeof COPY_OPTIONS)[number];
export type CopyOptions = Record<CopyOption, boolean>;

export const COPY_OPTION_LABELS: Record<CopyOption, string> = {
  adviser: 'Adviser information',
  staff: 'Staff information (officers and collectors with their positions)',
  settings: 'Settings (organization, structure, positions, approvals, receipts…)',
  funds: 'Funds (definitions only, no payments)',
  carryOver: 'Remaining balance per fund (as a carry-over entry)',
  promoteStudents: 'Promote students (copy them with year level +1)',
};

/** An option only makes sense when the options it builds on are also chosen. */
export const COPY_DEPENDENCIES: Record<CopyOption, CopyOption[]> = {
  adviser: [],
  settings: [],
  staff: ['settings'], // staff keep their positions, which come with the settings
  funds: ['settings'], // funds point at programs and year levels
  carryOver: ['funds'], // a balance needs the fund to land in
  promoteStudents: ['settings'], // students need their program and section
};

export function copyOptionIssues(options: CopyOptions): string[] {
  const issues: string[] = [];
  for (const option of COPY_OPTIONS) {
    if (!options[option]) continue;
    for (const needed of COPY_DEPENDENCIES[option]) {
      if (!options[needed]) issues.push(`"${COPY_OPTION_LABELS[option]}" also needs "${COPY_OPTION_LABELS[needed]}".`);
    }
  }
  return issues;
}

const flag = z.boolean().default(false);
export const copyOptionsSchema = z.object({
  adviser: flag,
  staff: flag,
  settings: flag,
  funds: flag,
  carryOver: flag,
  promoteStudents: flag,
});

export const setupAySchema = z
  .object({
    sourceAyId: z.string().uuid().optional(),
    options: copyOptionsSchema,
  })
  .superRefine((v, ctx) => {
    const anyCopy = COPY_OPTIONS.some((o) => v.options[o]);
    if (anyCopy && !v.sourceAyId) ctx.addIssue({ code: 'custom', path: ['sourceAyId'], message: 'Choose the academic year to copy from' });
    for (const issue of copyOptionIssues(v.options)) ctx.addIssue({ code: 'custom', path: ['options'], message: issue });
  });
export type SetupAyInput = z.input<typeof setupAySchema>;
