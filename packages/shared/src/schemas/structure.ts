import { z } from 'zod';

const requiredText = (max: number) => z.string().trim().min(1, 'Required').max(max, `At most ${max} characters`);

export const programSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Required')
    .max(20, 'At most 20 characters')
    .regex(/^[A-Z0-9-]+$/, 'Letters, numbers and dashes only (e.g. BSIT)'),
  name: requiredText(200),
});
export const programPatchSchema = programSchema.partial().extend({ isActive: z.boolean().optional() }).strict();

const sectionName = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'Required')
  .max(20, 'At most 20 characters')
  .regex(/^[A-Z0-9 -]+$/, 'Letters, numbers, spaces and dashes only');

/** A section of one program's year level (BSIT 1st year → A). */
export const sectionSchema = z.object({
  programId: z.string().uuid('Choose a program'),
  yearLevel: z.number().int().min(1, 'Choose a year level').max(10),
  name: sectionName,
});
/** Only the name and whether it's active can change; its program and year stay. */
export const sectionPatchSchema = z.object({ name: sectionName.optional(), isActive: z.boolean().optional() }).strict();

const maxMembers = z.number().int('Use a whole number').min(1, 'At least 1').max(100, 'At most 100').nullable();

/** A position (designation). Its flags are what members holding it may do. */
export const designationSchema = z.object({
  name: requiredText(80),
  canFileRequests: z.boolean().default(false),
  canCollect: z.boolean().default(false),
  isConfidentialExempt: z.boolean().default(false),
  canViewFunds: z.boolean().default(true),
  /** how many members may hold it at once (1 unless the adviser says otherwise); null = no limit */
  maxMembers: maxMembers.default(1),
});
export const designationPatchSchema = z
  .object({
    name: requiredText(80),
    canFileRequests: z.boolean(),
    canCollect: z.boolean(),
    isConfidentialExempt: z.boolean(),
    canViewFunds: z.boolean(),
    maxMembers,
    isActive: z.boolean(),
  })
  .partial()
  .strict();

export const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1) });

export const approverSchema = z
  .object({
    approvesFundRequests: z.boolean(),
    approvesLiquidations: z.boolean(),
  })
  .refine((v) => v.approvesFundRequests || v.approvesLiquidations, 'Choose at least one thing to approve');
