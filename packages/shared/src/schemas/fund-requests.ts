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

export const FUND_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'receipt_submitted', 'revision_requested', 'settlement_due', 'cleared', 'canceled'] as const;
export type FundRequestStatus = (typeof FUND_REQUEST_STATUSES)[number];

export const FUND_REQUEST_STATUS_LABELS: Record<FundRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  receipt_submitted: 'Receipt Submitted',
  revision_requested: 'Revision Requested',
  settlement_due: 'Settlement Due',
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

export const liquidationItemSchema = z.object({
  description: z.string().trim().min(1, 'Describe the item').max(200),
  quantity: z.number().int('Use a whole number').min(1, 'At least 1').max(100_000),
  /** price of one, in centavos */
  unitCost: centavos,
});

/**
 * One expense: what it was for, where it's from, its items and its photos or PDF. Most come with an
 * official receipt; some (gas, fares, ...) don't (`hasReceipt: false`), and then need no receipt
 * number or photo.
 */
export const liquidationEntrySchema = z.object({
  usedFor: z.string().trim().min(2, 'Say what this receipt was for').max(200),
  hasReceipt: z.boolean().default(true),
  payee: optionalNote(150),
  receiptNo: optionalNote(60),
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the receipt date'),
  items: z.array(liquidationItemSchema).min(1, 'Add at least one item').max(100, 'At most 100 items per receipt'),
  attachmentIds,
});

/** A receipt's total: the sum of quantity × unit cost. */
export const entryTotal = (items: { quantity: number; unitCost: number }[]) => items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);

export const liquidationCreateSchema = z
  .object({
    receipts: z.array(liquidationEntrySchema).min(1, 'Add at least one receipt').max(50, 'At most 50 receipts'),
    remarks: optionalNote(500),
  })
  .superRefine((v, ctx) => {
    v.receipts.forEach((r, i) => {
      if (entryTotal(r.items) > MAX_CENTAVOS) ctx.addIssue({ code: 'custom', path: ['receipts', i, 'items'], message: 'This receipt’s total is too large' });
    });
    if (v.receipts.reduce((s, r) => s + entryTotal(r.items), 0) > MAX_CENTAVOS) {
      ctx.addIssue({ code: 'custom', path: ['receipts'], message: 'The total is too large' });
    }
    const ids = v.receipts.flatMap((r) => r.attachmentIds);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['receipts'], message: 'The same file is attached to two receipts' });
  });
export type LiquidationCreateInput = z.input<typeof liquidationCreateSchema>;
export type LiquidationEntryInput = z.input<typeof liquidationEntrySchema>;

/**
 * When more was used than approved, the approver must say what happens to the excess:
 * - "reimburse": the fund pays all of it, and the requestor is reimbursed the excess
 * - "absorb": the fund pays only the approved amount; the requestor absorbs the excess
 * (`acceptOverAmount: true` is the older spelling of "reimburse")
 */
export const liquidationApproveSchema = z
  .object({
    overAmount: z.enum(['reimburse', 'absorb']).optional(),
    acceptOverAmount: z.boolean().optional(),
  })
  .transform(({ overAmount, acceptOverAmount }) => ({ overAmount: overAmount ?? (acceptOverAmount ? ('reimburse' as const) : undefined) }));

/** The treasurer (or adviser) records that the excess was reimbursed or the change returned. */
export const settlementSchema = z.object({
  note: optionalNote(500),
  /** photo of the signed acknowledgment, optional */
  attachmentId: z.string().uuid().nullish(),
});
export type SettlementInput = z.input<typeof settlementSchema>;

export const revisionSchema = z.object({ message: optionalNote(500) });
