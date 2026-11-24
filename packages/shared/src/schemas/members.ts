import { z } from 'zod';

const note = z
  .string()
  .trim()
  .max(500, 'At most 500 characters')
  .optional()
  .transform((v) => (v ? v : undefined));

export const approveMemberSchema = z.object({
  designationId: z.string().uuid('Choose a position'),
});

export const changeDesignationSchema = approveMemberSchema;

export const rejectMemberSchema = z.object({ comment: note });

export const deactivateMemberSchema = z.object({ reason: note });

export const memberStatusFilter = z.enum(['pending', 'active', 'rejected', 'deactivated']);
