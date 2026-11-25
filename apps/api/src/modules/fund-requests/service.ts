import type {
  Attachment,
  Fund,
  FundRequest,
  FundRequestDecision,
  LiquidationDecision,
  LiquidationEntry,
  LiquidationItem,
  LiquidationReceipt,
  Prisma,
  StoredFile,
} from '@prisma/client';
import { FUND_REQUEST_STATUS_LABELS, formatCentavos, formatPersonName, type Permission } from '@sft/shared';
import { prisma } from '../../db';
import { sendEvent, type Recipient } from '../../lib/events';

type Db = Prisma.TransactionClient | typeof prisma;
export type ApprovalKind = 'request' | 'liquidation';

export interface Approver {
  userId: string;
  name: string;
  designation: string;
  email: string;
  isAdviser: boolean;
}

/**
 * Who approves fund requests (or liquidation receipts) for a fund: every adviser, plus the extra
 * approvers chosen in Settings. For a confidential fund, only extra approvers whose position may
 * see confidential funds count. Other approvers never approve their own request; the adviser
 * may, and that decision is marked as self-approved.
 */
export async function approversFor(db: Db, academicYearId: string, kind: ApprovalKind, fund: Pick<Fund, 'isConfidential'>, requestorId?: string) {
  const [advisers, extra] = await Promise.all([
    db.userAyRole.findMany({ where: { academicYearId, role: 'adviser', status: 'active' }, include: { user: true }, orderBy: { decidedAt: 'asc' } }),
    db.ayApprover.findMany({
      where: { academicYearId, ...(kind === 'request' ? { approvesFundRequests: true } : { approvesLiquidations: true }) },
      include: { membership: { include: { user: true, designation: true } } },
    }),
  ]);
  const list: Approver[] = [];
  for (const adviser of advisers) {
    list.push({ userId: adviser.userId, name: formatPersonName(adviser.user), designation: 'Adviser', email: adviser.user.email, isAdviser: true });
  }
  for (const a of extra) {
    const m = a.membership;
    if (m.status !== 'active' || m.role !== 'member') continue;
    if (fund.isConfidential && !m.designation?.isConfidentialExempt) continue;
    if (!list.some((x) => x.userId === m.userId)) {
      list.push({ userId: m.userId, name: formatPersonName(m.user), designation: m.designation?.name ?? '', email: m.user.email, isAdviser: false });
    }
  }
  return list.filter((a) => a.isAdviser || a.userId !== requestorId);
}

/** Did the requestor approve their own request or receipt (only the adviser can)? */
export const selfApproved = (requestorId: string, decisions: { approverId: string; decision: string }[]) =>
  decisions.some((d) => d.approverId === requestorId && d.decision === 'approved');

/** Finished requests: nothing more can happen to them, so they may be archived. */
export const FINISHED_STATUSES = ['cleared', 'rejected', 'canceled'] as const;

export const isIn =(list: Approver[], userId: string | null) => Boolean(userId && list.some((a) => a.userId === userId));

/** May this user open the request (and its attachments)? */
export async function canViewRequest(
  academicYearId: string,
  viewer: { userId: string; perms: Permission[] },
  request: FundRequest & { fund: Fund },
) {
  if (request.requestorId === viewer.userId) return true;
  if (request.fund.isConfidential && !viewer.perms.includes('view_confidential')) return false;
  if (viewer.perms.includes('manage')) return true;
  // the treasurer opens it to record the reimbursement or the returned change
  if (viewer.perms.includes('collect') && request.status === 'settlement_due') return true;
  const [forRequest, forLiquidation] = await Promise.all([
    approversFor(prisma, academicYearId, 'request', request.fund),
    approversFor(prisma, academicYearId, 'liquidation', request.fund),
  ]);
  return isIn(forRequest, viewer.userId) || isIn(forLiquidation, viewer.userId);
}

type FileLink = Attachment & { file: StoredFile };
export type EntryWithAll = LiquidationEntry & { items: LiquidationItem[]; attachments: FileLink[] };

export type RequestWithAll = FundRequest & {
  fund: Fund;
  decisions: FundRequestDecision[];
  attachments: FileLink[];
  liquidations: (LiquidationReceipt & { decisions: LiquidationDecision[]; attachments: FileLink[]; entries: EntryWithAll[]; settlementFile: StoredFile | null })[];
};

const files = { include: { file: true }, orderBy: { sortOrder: 'asc' } } as const;

export const requestInclude = {
  fund: true,
  decisions: { orderBy: { decidedAt: 'asc' } },
  attachments: files,
  liquidations: {
    orderBy: { version: 'asc' },
    include: {
      decisions: { orderBy: { decidedAt: 'asc' } },
      attachments: files,
      entries: { orderBy: { sortOrder: 'asc' }, include: { items: { orderBy: { sortOrder: 'asc' } }, attachments: files } },
      settlementFile: true,
    },
  },
} as const satisfies Prisma.FundRequestInclude;

const storedFileView = (f: StoredFile) => ({ id: f.id, name: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, url: `/api/files/${f.id}` });
const fileView = (a: FileLink) => storedFileView(a.file);

/** What is still owed after the receipt was approved, or what was settled. */
export const settlementView = (l: RequestWithAll['liquidations'][number]) =>
  l.settlementKind
    ? {
        kind: l.settlementKind,
        amount: Number(l.settlementAmount),
        settledAt: l.settledAt,
        settledByName: l.settledByName,
        settledByDesignation: l.settledByDesignation,
        note: l.settlementNote,
        file: l.settlementFile ? storedFileView(l.settlementFile) : null,
      }
    : null;

/** R-1, R-2…: how the report and its receipt pages refer to each receipt. */
export const receiptRef = (sortOrder: number) => `R-${sortOrder}`;

export const entryView = (e: EntryWithAll) => ({
  id: e.id,
  ref: receiptRef(e.sortOrder),
  usedFor: e.usedFor,
  hasReceipt: e.hasReceipt,
  payee: e.payee,
  receiptNo: e.receiptNo,
  receiptDate: e.receiptDate.toISOString().slice(0, 10),
  total: Number(e.total),
  items: e.items.map((i) => ({ description: i.description, quantity: i.quantity, unitCost: Number(i.unitCost), amount: Number(i.amount) })),
  attachments: e.attachments.map(fileView),
});

export function serializeRequest(r: RequestWithAll) {
  return {
    id: r.id,
    requestNo: r.requestNo,
    status: r.status,
    statusLabel: FUND_REQUEST_STATUS_LABELS[r.status],
    fund: { id: r.fundId, name: r.fundNameSnapshot, isConfidential: r.fund.isConfidential },
    requestorId: r.requestorId,
    requestorName: r.requestorName,
    requestorDesignation: r.requestorDesignation,
    amount: Number(r.amountRequested),
    purpose: r.purpose,
    useAt: r.useAt,
    approvalRule: r.approvalRule,
    submittedAt: r.submittedAt,
    approvedAt: r.approvedAt,
    approvedByName: r.approvedByName,
    approvedByDesignation: r.approvedByDesignation,
    rejectedAt: r.rejectedAt,
    rejectedByName: r.rejectedByName,
    rejectionComment: r.rejectionComment,
    canceledAt: r.canceledAt,
    canceledByName: r.canceledByName,
    cancelReason: r.cancelReason,
    clearedAt: r.clearedAt,
    archivedAt: r.archivedAt,
    archivedByName: r.archivedByName,
    selfApproved: selfApproved(r.requestorId, r.decisions),
    decisions: r.decisions.map((d) => ({ approverName: d.approverName, approverDesignation: d.approverDesignation, decision: d.decision, comment: d.comment, decidedAt: d.decidedAt })),
    attachments: r.attachments.map(fileView),
    liquidations: r.liquidations.map((l) => ({
      id: l.id,
      version: l.version,
      status: l.status,
      approvedAmount: Number(l.approvedAmount),
      fundUsed: Number(l.fundUsed),
      overApproved: l.fundUsed > l.approvedAmount,
      overApprovedAccepted: l.overApprovedAccepted,
      overAcceptedByName: l.overAcceptedByName,
      remarks: l.remarks,
      submittedAt: l.submittedAt,
      submittedByName: l.submittedByName,
      revisionMessage: l.revisionMessage,
      revisionRequestedAt: l.revisionRequestedAt,
      revisionRequestedByName: l.revisionRequestedByName,
      approvedAt: l.approvedAt,
      approvedByName: l.approvedByName,
      chargedAmount: l.chargedAmount === null ? null : Number(l.chargedAmount),
      settlement: settlementView(l),
      selfApproved: selfApproved(r.requestorId, l.decisions),
      decisions: l.decisions.map((d) => ({ approverName: d.approverName, approverDesignation: d.approverDesignation, decision: d.decision, comment: d.comment, decidedAt: d.decidedAt })),
      receipts: l.entries.map(entryView),
      attachments: l.attachments.map(fileView),
    })),
  };
}

type RequestFacts = Pick<FundRequest, 'id' | 'requestNo' | 'fundNameSnapshot' | 'amountRequested' | 'purpose' | 'requestorName' | 'requestorDesignation'>;

/** The placeholders every request event offers. */
const requestVars = (r: RequestFacts) => ({
  requestNo: r.requestNo,
  fundName: r.fundNameSnapshot,
  amount: formatCentavos(Number(r.amountRequested)),
  purpose: r.purpose,
  requestorName: r.requestorName,
  requestorDesignation: r.requestorDesignation,
});

/** Sends a request event (in-app and/or email, as the AY's settings say) to approvers or the requestor. */
export async function tellPeople(academicYearId: string, people: Recipient[], key: string, r: RequestFacts, vars: Record<string, string | null | undefined> = {}) {
  if (!people.length) return;
  await sendEvent(key, {
    ayId: academicYearId,
    to: people,
    vars: { ...requestVars(r), ...vars },
    linkPath: `/requests/${r.id}`,
    entityType: 'fund_request',
    entityId: r.id,
  });
}

/** Tell the requestor what happened, unless they did it themself (the adviser on their own request). */
export async function tellRequestor(
  academicYearId: string,
  r: RequestFacts & Pick<FundRequest, 'requestorId'>,
  actorId: string | null,
  key: string,
  vars: Record<string, string | null | undefined> = {},
) {
  if (r.requestorId === actorId) return;
  const requestor = await prisma.user.findUniqueOrThrow({ where: { id: r.requestorId } });
  await tellPeople(academicYearId, [{ userId: requestor.id, email: requestor.email, name: formatPersonName(requestor) }], key, r, vars);
}

export const describeRequest =(r: Pick<FundRequest, 'requestNo' | 'fundNameSnapshot' | 'amountRequested'>) =>
  `${r.requestNo}: ${formatCentavos(Number(r.amountRequested))} from ${r.fundNameSnapshot}`;
