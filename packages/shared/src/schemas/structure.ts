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

export const sectionSchema = z.object({
  name: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Required')
    .max(20, 'At most 20 characters')
    .regex(/^[A-Z0-9 -]+$/, 'Letters, numbers, spaces and dashes only'),
});
export const sectionPatchSchema = sectionSchema.partial().extend({ isActive: z.boolean().optional() }).strict();

/** A position (designation). Its flags are what members holding it may do. */
export const designationSchema = z.object({
  name: requiredText(80),
  canFileRequests: z.boolean().default(false),
  canCollect: z.boolean().default(false),
  isConfidentialExempt: z.boolean().default(false),
});
export const designationPatchSchema = z
  .object({
    name: requiredText(80),
    canFileRequests: z.boolean(),
    canCollect: z.boolean(),
    isConfidentialExempt: z.boolean(),
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
