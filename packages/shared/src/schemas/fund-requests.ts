import { z } from 'zod';
import { MAX_CENTAVOS } from '../money';

const centavos = z.number().int('Use whole centavos').positive('Must be greater than zero').max(MAX_CENTAVOS);
const attachmentIds = z.array(z.string().uuid()).max(10, 'Attach at most 10 files').default([]);
const optionalNote = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : undefined));

export const FUND_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'receipt_submitted', 'revision_requested', 'cleared', 'canceled'] as const;
export type FundRequestStatus = (typeof FUND_REQUEST_STATUSES)[number];

export const FUND_REQUEST_STATUS_LABELS: Record<FundRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  receipt_submitted: 'Receipt Submitted',
  revision_requested: 'Revision Requested',
  cleared: 'Cleared',
  canceled: 'Canceled',
};

export const fundRequestCreateSchema = z.object({
  fundId: z.string().uuid('Choose a fund'),
  amount: centavos,
  purpose: z.string().trim().min(3, 'Describe what the money is for').max(500),
  /** when the money will be used */
  useAt: z.coerce.date({ error: 'Choose the date of use' }),
  attachmentIds,
});
export type FundRequestCreateInput = z.input<typeof fundRequestCreateSchema>;

export const rejectSchema = z.object({ comment: optionalNote(500) });
export const cancelRequestSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500) });

export const liquidationCreateSchema = z.object({
  /** the amount actually spent, e.g. 250060 for ₱2,500.60 */
  fundUsed: centavos,
  remarks: optionalNote(500),
  attachmentIds,
});
export type LiquidationCreateInput = z.input<typeof liquidationCreateSchema>;

export const liquidationApproveSchema = z.object({
  /** required when the amount used is more than the approved amount */
  acceptOverAmount: z.boolean().optional(),
});

export const revisionSchema = z.object({ message: optionalNote(500) });
