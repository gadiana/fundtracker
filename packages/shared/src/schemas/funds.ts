import { z } from 'zod';
import { MAX_CENTAVOS } from '../money';

const centavos = z
  .number({ error: 'Enter an amount' })
  .int('Use whole centavos')
  .min(0, 'Cannot be negative')
  .max(MAX_CENTAVOS, 'Too large');

const fundFields = {
  name: z.string().trim().min(1, 'Required').max(120, 'At most 120 characters'),
  amountPerStudent: centavos,
  isMandatory: z.boolean(),
  isConfidential: z.boolean(),
  yearLevels: z
    .array(z.number().int().min(1).max(10))
    .min(1, 'Choose at least one year level')
    .transform((levels) => [...new Set(levels)].sort((a, b) => a - b)),
  allPrograms: z.boolean(),
  programIds: z.array(z.string().uuid()).default([]),
  notes: z
    .string()
    .trim()
    .max(1000)
    .nullish()
    .transform((v) => (v ? v : null)),
};

const programsChosen = (v: { allPrograms?: boolean; programIds?: string[] }) => v.allPrograms !== false || (v.programIds?.length ?? 0) > 0;

export const fundCreateSchema = z
  .object(fundFields)
  .refine(programsChosen, { message: 'Choose at least one program, or apply it to all programs', path: ['programIds'] });
export type FundCreateInput = z.input<typeof fundCreateSchema>;

export const fundUpdateSchema = z
  .object(fundFields)
  .partial()
  .strict()
  .refine(programsChosen, { message: 'Choose at least one program, or apply it to all programs', path: ['programIds'] });

export const fundReorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1) });

/** Manual ledger correction by the adviser: signed centavos with a reason. */
export const ledgerAdjustmentSchema = z.object({
  amount: z
    .number()
    .int()
    .refine((v) => v !== 0, 'Enter a non-zero amount')
    .refine((v) => Math.abs(v) <= MAX_CENTAVOS, 'Too large'),
  reason: z.string().trim().min(5, 'Explain the adjustment (at least 5 characters)').max(300),
});

export const applicableCountSchema = z.object({
  yearLevels: z.array(z.number().int().min(1).max(10)).min(1),
  allPrograms: z.boolean(),
  programIds: z.array(z.string().uuid()).default([]),
});
