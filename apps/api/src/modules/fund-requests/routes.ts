import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  cancelRequestSchema,
  formatCentavos,
  FUND_REQUEST_STATUS_LABELS,
  FUND_REQUEST_STATUSES,
  fundRequestCreateSchema,
  liquidationApproveSchema,
  liquidationCreateSchema,
  rejectSchema,
  revisionSchema,
} from '@sft/shared';
import { prisma } from '../../db';
import { writeAudit } from '../../lib/audit';
import { visibleFundsWhere } from '../../lib/confidential';
import { badRequest, conflict, forbidden, notFound, uuidParam } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { ayContext, ctxOf, requireMember, requireOpenAy } from '../../middleware/ay';
import { localDate, nextCounter } from '../payments/service';
import {
  approversFor,
  canViewRequest,
  FINISHED_STATUSES,
  isIn,
  requestInclude,
  serializeRequest,
  tellPeople,
  tellRequestor,
  type Approver,
  type RequestWithAll,
} from './service';

type Tx = Prisma.TransactionClient;

/** Fund requests and liquidation receipts of the selected AY. */
export const fundRequestsRouter = Router();
fundRequestsRouter.use(requireAuth, ayContext, requireMember);

async function available(tx: Tx | typeof prisma, fundId: string) {
  const [b] = await tx.$queryRaw<{ balance: bigint; committed: bigint; available: bigint }[]>`
    SELECT balance, committed, available FROM v_fund_balances WHERE fund_id = ${fundId}::uuid`;
  return { balance: Number(b?.balance ?? 0n), committed: Number(b?.committed ?? 0n), available: Number(b?.available ?? 0n) };
}

async function loadRequest(req: Request): Promise<RequestWithAll> {
  const { db, ay, perms } = ctxOf(req);
  const request = await db.fundRequest.findUnique({ where: { id: uuidParam(req.params.id) }, include: requestInclude });
  if (!request || !(await canViewRequest(ay.id, { userId: req.user!.id, perms }, request))) throw notFound('Request not found.');
  return request;
}

/** Re-reads the request inside a transaction with a row lock, so two approvers can't act at once. */
async function lockRequest(tx: Tx, academicYearId: string, id: string) {
  await tx.$queryRaw`SELECT id FROM fund_requests WHERE id = ${id}::uuid AND academic_year_id = ${academicYearId}::uuid FOR UPDATE`;
  return tx.fundRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });
}

/** Files must be this user's own fresh uploads in this AY, not attached to anything yet. */
async function claimFiles(tx: Tx, academicYearId: string, userId: string, ids: string[]) {
  if (!ids.length) return [];
  const unique = [...new Set(ids)];
  const files = await tx.storedFile.findMany({ where: { id: { in: unique }, academicYearId } });
  if (files.length !== unique.length || files.some((f) => f.uploadedById !== userId)) {
    throw badRequest('BAD_ATTACHMENT', 'One of the attachments is missing. Upload it again.');
  }
  if (await tx.attachment.count({ where: { fileId: { in: unique } } })) {
    throw badRequest('ALREADY_ATTACHED', 'One of the attachments already belongs to another request.');
  }
  return unique;
}

const approverProgress = (approvers: Approver[], decisions: { approverId: string; decision: string }[], requestorId: string) =>
  approvers.map((a) => ({
    name: a.name,
    designation: a.designation,
    decision: decisions.find((d) => d.approverId === a.userId)?.decision ?? null,
    isRequestor: a.userId === requestorId,
  }));

// ───────────────────────────── form options & lists ─────────────────────────────

fundRequestsRouter.get('/options', async (req, res) => {
  const { db, ay, perms, actor } = ctxOf(req);
  const [funds, settings] = await Promise.all([
    db.fund.findMany({ where: { isActive: true, ...visibleFundsWhere(perms) }, orderBy: { priority: 'asc' } }),
    prisma.aySetting.findUnique({ where: { academicYearId: ay.id } }),
  ]);
  res.json({
    canFile: perms.includes('file_requests'),
    requestor: { name: actor.name, designation: actor.designation },
    funds: await Promise.all(funds.map(async (f) => ({ id: f.id, name: f.name, isConfidential: f.isConfidential, ...(await available(prisma, f.id)) }))),
    requireRequestAttachment: settings?.requireRequestAttachment ?? true,
    requireLiquidationAttachment: settings?.requireLiquidationAttachment ?? true,
    uploadAllowedMime: settings?.uploadAllowedMime ?? [],
    uploadMaxBytes: settings?.uploadMaxBytes ?? 10 * 1024 * 1024,
  });
});

const listQuery = z.object({
  scope: z.enum(['mine', 'inbox', 'all', 'archived']).default('mine'),
  status: z.enum(FUND_REQUEST_STATUSES).optional(),
});

/** For each request: is it waiting for this user's decision (on the request or its latest receipt)? */
async function waitingFor(academicYearId: string, userId: string, rows: RequestWithAll[]) {
  const cache = new Map<string, Approver[]>();
  const approvers = async (kind: 'request' | 'liquidation', r: RequestWithAll) => {
    const key = `${kind}:${r.fund.isConfidential}:${r.requestorId}`;
    if (!cache.has(key)) cache.set(key, await approversFor(prisma, academicYearId, kind, r.fund, r.requestorId));
    return cache.get(key)!;
  };
  const waiting = new Set<string>();
  for (const r of rows) {
    const latest = r.liquidations.at(-1);
    if (r.status === 'pending' && isIn(await approvers('request', r), userId) && !r.decisions.some((d) => d.approverId === userId)) waiting.add(r.id);
    if (
      r.status === 'receipt_submitted' &&
      latest?.status === 'submitted' &&
      isIn(await approvers('liquidation', r), userId) &&
      !latest.decisions.some((d) => d.approverId === userId)
    ) {
      waiting.add(r.id);
    }
  }
  return waiting;
}

const awaitingDecision: Prisma.FundRequestWhereInput = { status: { in: ['pending', 'receipt_submitted'] } };

/** The number on the "To approve" tab and in the menu. */
fundRequestsRouter.get('/counts', async (req, res) => {
  const { db, ay, perms } = ctxOf(req);
  const rows = await db.fundRequest.findMany({ where: { fund: visibleFundsWhere(perms), ...awaitingDecision }, include: requestInclude });
  res.json({ toApprove: (await waitingFor(ay.id, req.user!.id, rows)).size });
});

fundRequestsRouter.get('/', async (req, res) => {
  const { db, ay, perms } = ctxOf(req);
  const userId = req.user!.id;
  const q = listQuery.parse(req.query);
  if (q.scope === 'all' && !perms.includes('manage')) throw forbidden();

  const where: Prisma.FundRequestWhereInput = {
    fund: visibleFundsWhere(perms),
    ...(q.status ? { status: q.status } : {}),
    // archived requests only appear in the Archived list: the adviser sees all of them, others their own
    archivedAt: q.scope === 'archived' ? { not: null } : null,
    ...(q.scope === 'mine' || (q.scope === 'archived' && !perms.includes('manage')) ? { requestorId: userId } : {}),
    ...(q.scope === 'inbox' ? awaitingDecision : {}),
  };
  const rows = await db.fundRequest.findMany({
    where,
    include: requestInclude,
    orderBy: q.scope === 'archived' ? { archivedAt: 'desc' } : { submittedAt: 'desc' },
    take: 200,
  });

  const waiting = await waitingFor(ay.id, userId, rows);
  const items = [];
  for (const r of rows) {
    const latest = r.liquidations.at(-1);
    const needsMyAction = waiting.has(r.id);
    if (q.scope === 'inbox' && !needsMyAction) continue;
    items.push({
      id: r.id,
      requestNo: r.requestNo,
      status: r.status,
      statusLabel: FUND_REQUEST_STATUS_LABELS[r.status],
      fundName: r.fundNameSnapshot,
      isConfidential: r.fund.isConfidential,
      amount: Number(r.amountRequested),
      purpose: r.purpose,
      useAt: r.useAt,
      requestorName: r.requestorName,
      requestorDesignation: r.requestorDesignation,
      submittedAt: r.submittedAt,
      approvedAt: r.approvedAt,
      fundUsed: latest ? Number(latest.fundUsed) : null,
      receiptSubmittedAt: latest?.submittedAt ?? null,
      receiptApprovedAt: latest?.approvedAt ?? null,
      archivedAt: r.archivedAt,
      needsMyAction,
    });
  }
  res.json({ items });
});

// ───────────────────────────── submit a request ─────────────────────────────

fundRequestsRouter.post('/', requireOpenAy, async (req, res) => {
  const body = fundRequestCreateSchema.parse(req.body);
  const { db, ay, perms, actor } = ctxOf(req);
  if (!perms.includes('file_requests')) throw forbidden('Your position cannot file fund requests.');
  const fund = await db.fund.findFirst({ where: { id: body.fundId, isActive: true, ...visibleFundsWhere(perms) } });
  if (!fund) throw notFound('Fund not found.');
  const settings = await prisma.aySetting.findUniqueOrThrow({ where: { academicYearId: ay.id } });
  // compared as calendar dates in the AY's time zone, so "today" is always allowed
  if (localDate(settings.timezone, body.useAt) < localDate(settings.timezone)) {
    throw badRequest('DATE_IN_PAST', 'The date of use can’t be before today.');
  }
  if (settings.requireRequestAttachment && body.attachmentIds.length === 0) {
    throw badRequest('ATTACHMENT_REQUIRED', 'Attach a photo or PDF of the approved request document.');
  }
  const { available: free } = await available(prisma, fund.id);
  if (body.amount > free) {
    throw badRequest('INSUFFICIENT_AVAILABLE', `${fund.name} only has ${formatCentavos(free)} free to request (its balance minus what approved requests have reserved).`);
  }

  const request = await prisma.$transaction(async (tx) => {
    const fileIds = await claimFiles(tx, ay.id, req.user!.id, body.attachmentIds);
    const counter = await nextCounter(tx, ay.id, 'fund_request');
    const request = await tx.fundRequest.create({
      data: {
        academicYearId: ay.id,
        requestNo: `FR-${String(counter).padStart(4, '0')}`,
        fundId: fund.id,
        fundNameSnapshot: fund.name,
        requestorId: req.user!.id,
        requestorName: actor.name,
        requestorDesignation: actor.designation ?? '',
        amountRequested: BigInt(body.amount),
        purpose: body.purpose,
        useAt: body.useAt,
        approvalRule: settings.requestApprovalRule,
      },
    });
    if (fileIds.length) {
      await tx.attachment.createMany({ data: fileIds.map((fileId, sortOrder) => ({ academicYearId: ay.id, fileId, fundRequestId: request.id, sortOrder })) });
    }
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'create',
      entityType: 'fund_request',
      entityId: request.id,
      after: { requestNo: request.requestNo, fund: fund.name, amount: body.amount, purpose: body.purpose, useAt: body.useAt, attachments: fileIds.length },
      req,
    });
    return request;
  });

  const approvers = await approversFor(prisma, ay.id, 'request', fund, req.user!.id);
  await tellPeople(
    ay.id,
    approvers.filter((a) => a.userId !== req.user!.id),
    'fund_request.submitted',
    request,
  );
  res.status(201).json(serializeRequest(await prisma.fundRequest.findUniqueOrThrow({ where: { id: request.id }, include: requestInclude })));
});

// ───────────────────────────── detail ─────────────────────────────

fundRequestsRouter.get('/:id', async (req, res) => {
  const { ay, perms } = ctxOf(req);
  const userId = req.user!.id;
  const r = await loadRequest(req);
  const open = ay.status === 'open';
  const [requestApprovers, liquidationApprovers, fundBalance] = await Promise.all([
    approversFor(prisma, ay.id, 'request', r.fund, r.requestorId),
    approversFor(prisma, ay.id, 'liquidation', r.fund, r.requestorId),
    available(prisma, r.fundId),
  ]);
  const latest = r.liquidations.at(-1);
  res.json({
    request: serializeRequest(r),
    fund: fundBalance,
    approvals: {
      request: approverProgress(requestApprovers, r.decisions, r.requestorId),
      liquidation: latest ? approverProgress(liquidationApprovers, latest.decisions, r.requestorId) : [],
    },
    viewer: {
      isRequestor: r.requestorId === userId,
      canDecide: open && r.status === 'pending' && isIn(requestApprovers, userId) && !r.decisions.some((d) => d.approverId === userId),
      canCancel: open && perms.includes('manage') && (r.status === 'approved' || r.status === 'revision_requested'),
      canSubmitReceipt: open && r.requestorId === userId && (r.status === 'approved' || r.status === 'revision_requested'),
      canReviewReceipt:
        open &&
        r.status === 'receipt_submitted' &&
        latest?.status === 'submitted' &&
        isIn(liquidationApprovers, userId) &&
        !latest.decisions.some((d) => d.approverId === userId),
      noApprovers: requestApprovers.length === 0,
      canArchive: open && !r.archivedAt && isFinished(r.status) && (r.requestorId === userId || perms.includes('manage')),
      canUnarchive: open && Boolean(r.archivedAt) && (r.requestorId === userId || perms.includes('manage')),
    },
  });
});

const isFinished = (status: string) => (FINISHED_STATUSES as readonly string[]).includes(status);

/**
 * Archiving hides a finished request from the lists (it stays in "Archived" and in every
 * report). The requestor or the adviser can archive it, or bring it back.
 */
for (const [path, archive] of [
  ['archive', true],
  ['unarchive', false],
] as const) {
  fundRequestsRouter.post(`/:id/${path}`, requireOpenAy, async (req, res) => {
    const { ay, actor, perms } = ctxOf(req);
    const { id } = await loadRequest(req);
    await prisma.$transaction(async (tx) => {
      const r = await lockRequest(tx, ay.id, id);
      if (r.requestorId !== actor.id && !perms.includes('manage')) throw forbidden('Only the requestor or the adviser can archive a request.');
      if (archive && !isFinished(r.status)) {
        throw conflict('NOT_FINISHED', `Only cleared, rejected or canceled requests can be archived. ${r.requestNo} is ${FUND_REQUEST_STATUS_LABELS[r.status].toLowerCase()}.`);
      }
      if (archive === Boolean(r.archivedAt)) throw conflict(archive ? 'ALREADY_ARCHIVED' : 'NOT_ARCHIVED', `${r.requestNo} is ${archive ? 'already' : 'not'} archived.`);
      await tx.fundRequest.update({
        where: { id: r.id },
        data: archive ? { archivedAt: new Date(), archivedById: actor.id, archivedByName: actor.name } : { archivedAt: null, archivedById: null, archivedByName: null },
      });
      await writeAudit(tx, {
        ayId: ay.id,
        actor,
        action: archive ? 'archive' : 'unarchive',
        entityType: 'fund_request',
        entityId: r.id,
        before: { archived: !archive },
        after: { archived: archive, requestNo: r.requestNo, status: r.status },
        req,
      });
    });
    res.json({ ok: true });
  });
}

// ───────────────────────────── approve / reject / cancel the request ─────────────────────────────

fundRequestsRouter.post('/:id/approve', requireOpenAy, async (req, res) => {
  const { ay, actor } = ctxOf(req);
  const { id } = await loadRequest(req);

  const result = await prisma.$transaction(async (tx) => {
    const r = await lockRequest(tx, ay.id, id);
    if (r.status !== 'pending') throw conflict('NOT_PENDING', `${r.requestNo} is ${FUND_REQUEST_STATUS_LABELS[r.status].toLowerCase()}, not pending.`);
    const approvers = await approversFor(tx, ay.id, 'request', r.fund, r.requestorId);
    const self = r.requestorId === actor.id;
    if (self && !isIn(approvers, actor.id)) throw forbidden('You cannot approve your own request.');
    if (!isIn(approvers, actor.id)) throw forbidden('You are not an approver for this request.');
    if (r.decisions.some((d) => d.approverId === actor.id)) throw conflict('ALREADY_DECIDED', 'You already decided on this request.');

    await tx.fundRequestDecision.create({
      data: {
        academicYearId: ay.id,
        fundRequestId: r.id,
        approverId: actor.id!,
        approverName: actor.name,
        approverDesignation: actor.designation ?? null,
        decision: 'approved',
      },
    });
    const approved = new Set([...r.decisions.filter((d) => d.decision === 'approved').map((d) => d.approverId), actor.id!]);
    const final = r.approvalRule === 'any_one' || approvers.every((a) => approved.has(a.userId));
    if (final) {
      // approved requests together may never exceed what the fund has
      await tx.$queryRaw`SELECT id FROM funds WHERE id = ${r.fundId}::uuid FOR UPDATE`;
      const { available: free } = await available(tx, r.fundId);
      if (Number(r.amountRequested) > free) {
        throw conflict('INSUFFICIENT_AVAILABLE', `${r.fundNameSnapshot} only has ${formatCentavos(free)} free to request, less than the ${formatCentavos(Number(r.amountRequested))} requested.`);
      }
      await tx.fundRequest.update({
        where: { id: r.id },
        data: { status: 'approved', approvedAt: new Date(), approvedById: actor.id, approvedByName: actor.name, approvedByDesignation: actor.designation ?? null },
      });
    }
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'approve',
      entityType: 'fund_request',
      entityId: r.id,
      before: { status: 'pending' },
      after: {
        status: final ? 'approved' : 'pending',
        decision: 'approved',
        ...(self ? { selfApproved: true } : {}),
        waitingFor: final ? [] : approvers.filter((a) => !approved.has(a.userId)).map((a) => a.name),
      },
      req,
    });
    return { r, final };
  });

  if (result.final) {
    await tellRequestor(ay.id, result.r, actor.id, 'fund_request.approved', { approverName: actor.name });
  }
  res.json({ final: result.final });
});

fundRequestsRouter.post('/:id/reject', requireOpenAy, async (req, res) => {
  const { comment } = rejectSchema.parse(req.body);
  const { ay, actor } = ctxOf(req);
  const { id } = await loadRequest(req);

  const r = await prisma.$transaction(async (tx) => {
    const r = await lockRequest(tx, ay.id, id);
    if (r.status !== 'pending') throw conflict('NOT_PENDING', `${r.requestNo} is not pending.`);
    const approvers = await approversFor(tx, ay.id, 'request', r.fund, r.requestorId);
    if (!isIn(approvers, actor.id)) throw forbidden('You are not an approver for this request.');
    if (r.decisions.some((d) => d.approverId === actor.id)) throw conflict('ALREADY_DECIDED', 'You already decided on this request.');
    await tx.fundRequestDecision.create({
      data: {
        academicYearId: ay.id,
        fundRequestId: r.id,
        approverId: actor.id!,
        approverName: actor.name,
        approverDesignation: actor.designation ?? null,
        decision: 'rejected',
        comment: comment ?? null,
      },
    });
    await tx.fundRequest.update({
      where: { id: r.id },
      data: { status: 'rejected', rejectedAt: new Date(), rejectedById: actor.id, rejectedByName: actor.name, rejectionComment: comment ?? null },
    });
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'reject',
      entityType: 'fund_request',
      entityId: r.id,
      before: { status: 'pending' },
      after: { status: 'rejected', comment: comment ?? null },
      req,
    });
    return r;
  });

  await tellRequestor(ay.id, r, actor.id, 'fund_request.rejected', { approverName: actor.name, comment });
  res.json({ ok: true });
});

/** The adviser can cancel an approved request; its reserved amount becomes available again. */
fundRequestsRouter.post('/:id/cancel', requireOpenAy, async (req, res) => {
  const { reason } = cancelRequestSchema.parse(req.body);
  const { ay, actor, perms } = ctxOf(req);
  if (!perms.includes('manage')) throw forbidden('Only the adviser can cancel a request.');
  const { id } = await loadRequest(req);

  const r = await prisma.$transaction(async (tx) => {
    const r = await lockRequest(tx, ay.id, id);
    if (r.status !== 'approved' && r.status !== 'revision_requested') {
      throw conflict('CANNOT_CANCEL', `Only approved requests can be canceled. ${r.requestNo} is ${FUND_REQUEST_STATUS_LABELS[r.status].toLowerCase()}.`);
    }
    await tx.fundRequest.update({
      where: { id: r.id },
      data: { status: 'canceled', canceledAt: new Date(), canceledById: actor.id, canceledByName: actor.name, cancelReason: reason },
    });
    await writeAudit(tx, { ayId: ay.id, actor, action: 'cancel', entityType: 'fund_request', entityId: r.id, before: { status: r.status }, after: { status: 'canceled', reason }, req });
    return r;
  });
  await tellRequestor(ay.id, r, actor.id, 'fund_request.canceled', { approverName: actor.name, reason });
  res.json({ ok: true });
});

// ───────────────────────────── liquidation receipts ─────────────────────────────

/** After using the money, the requestor submits what was actually spent with the official receipt. */
fundRequestsRouter.post('/:id/liquidations', requireOpenAy, async (req, res) => {
  const body = liquidationCreateSchema.parse(req.body);
  const { ay, actor } = ctxOf(req);
  const { id } = await loadRequest(req);
  const settings = await prisma.aySetting.findUniqueOrThrow({ where: { academicYearId: ay.id } });
  if (settings.requireLiquidationAttachment && body.attachmentIds.length === 0) {
    throw badRequest('ATTACHMENT_REQUIRED', 'Attach a photo or PDF of the official receipt.');
  }

  const r = await prisma.$transaction(async (tx) => {
    const r = await lockRequest(tx, ay.id, id);
    if (r.requestorId !== actor.id) throw forbidden('Only the person who filed the request can submit its receipt.');
    if (r.status !== 'approved' && r.status !== 'revision_requested') {
      throw conflict('NOT_APPROVED', `A receipt can only be submitted for an approved request. ${r.requestNo} is ${FUND_REQUEST_STATUS_LABELS[r.status].toLowerCase()}.`);
    }
    const fileIds = await claimFiles(tx, ay.id, actor.id!, body.attachmentIds);
    const liquidation = await tx.liquidationReceipt.create({
      data: {
        academicYearId: ay.id,
        fundRequestId: r.id,
        version: (r.liquidations.at(-1)?.version ?? 0) + 1,
        approvedAmount: r.amountRequested,
        fundUsed: BigInt(body.fundUsed),
        remarks: body.remarks ?? null,
        approvalRule: settings.liquidationApprovalRule,
        submittedById: actor.id!,
        submittedByName: actor.name,
        submittedByDesignation: actor.designation ?? '',
      },
    });
    if (fileIds.length) {
      await tx.attachment.createMany({
        data: fileIds.map((fileId, sortOrder) => ({ academicYearId: ay.id, fileId, liquidationReceiptId: liquidation.id, sortOrder })),
      });
    }
    await tx.fundRequest.update({ where: { id: r.id }, data: { status: 'receipt_submitted' } });
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'create',
      entityType: 'liquidation_receipt',
      entityId: liquidation.id,
      after: { requestNo: r.requestNo, version: liquidation.version, fundUsed: body.fundUsed, approvedAmount: Number(r.amountRequested), attachments: fileIds.length },
      req,
    });
    return r;
  });

  const over = body.fundUsed > Number(r.amountRequested);
  const reviewers = await approversFor(prisma, ay.id, 'liquidation', r.fund, r.requestorId);
  await tellPeople(
    ay.id,
    reviewers.filter((a) => a.userId !== actor.id),
    'liquidation.submitted',
    r,
    {
      fundUsed: formatCentavos(body.fundUsed),
      approvedAmount: formatCentavos(Number(r.amountRequested)),
      overApproved: over ? `That is ${formatCentavos(body.fundUsed - Number(r.amountRequested))} MORE than approved.` : '',
    },
  );
  res.status(201).json({ ok: true });
});

async function latestSubmitted(tx: Tx, academicYearId: string, requestId: string, liquidationId: string) {
  const r = await lockRequest(tx, academicYearId, requestId);
  const latest = r.liquidations.at(-1);
  if (!latest || latest.id !== liquidationId || latest.status !== 'submitted' || r.status !== 'receipt_submitted') {
    throw conflict('NOT_SUBMITTED', 'This receipt is not waiting for review.');
  }
  return { r, latest };
}

/** Approving the receipt is the ONLY step that takes money out of the fund: the amount actually used. */
fundRequestsRouter.post('/:id/liquidations/:lid/approve', requireOpenAy, async (req, res) => {
  const { acceptOverAmount } = liquidationApproveSchema.parse(req.body);
  const { ay, actor } = ctxOf(req);
  const { id } = await loadRequest(req);
  const lid = uuidParam(req.params.lid);

  const result = await prisma.$transaction(async (tx) => {
    const { r, latest } = await latestSubmitted(tx, ay.id, id, lid);
    const approvers = await approversFor(tx, ay.id, 'liquidation', r.fund, r.requestorId);
    if (!isIn(approvers, actor.id)) throw forbidden('You are not an approver for this receipt.');
    if (latest.decisions.some((d) => d.approverId === actor.id)) throw conflict('ALREADY_DECIDED', 'You already decided on this receipt.');
    const over = latest.fundUsed > latest.approvedAmount;
    if (over && !acceptOverAmount) {
      throw badRequest(
        'OVER_APPROVED',
        `${formatCentavos(Number(latest.fundUsed))} was used, more than the ${formatCentavos(Number(latest.approvedAmount))} approved. Tick “accept the higher amount” to approve it anyway.`,
      );
    }

    await tx.liquidationDecision.create({
      data: {
        academicYearId: ay.id,
        liquidationReceiptId: latest.id,
        approverId: actor.id!,
        approverName: actor.name,
        approverDesignation: actor.designation ?? null,
        decision: 'approved',
        comment: over ? 'Accepted the amount above the approved request' : null,
      },
    });
    const approved = new Set([...latest.decisions.filter((d) => d.decision === 'approved').map((d) => d.approverId), actor.id!]);
    const final = latest.approvalRule === 'any_one' || approvers.every((a) => approved.has(a.userId));

    if (final) {
      await tx.$queryRaw`SELECT id FROM funds WHERE id = ${r.fundId}::uuid FOR UPDATE`;
      const { available: free } = await available(tx, r.fundId);
      // this request's own reservation is released by clearing it
      if (free + Number(r.amountRequested) - Number(latest.fundUsed) < 0) {
        throw conflict('INSUFFICIENT_AVAILABLE', `${r.fundNameSnapshot} doesn’t have enough available to cover ${formatCentavos(Number(latest.fundUsed))}.`);
      }
      await tx.liquidationReceipt.update({
        where: { id: latest.id },
        data: {
          status: 'approved',
          approvedAt: new Date(),
          approvedById: actor.id,
          approvedByName: actor.name,
          approvedByDesignation: actor.designation ?? null,
          ...(over ? { overApprovedAccepted: true, overAcceptedById: actor.id, overAcceptedByName: actor.name } : {}),
        },
      });
      await tx.fundLedger.create({
        data: {
          academicYearId: ay.id,
          fundId: r.fundId,
          entryType: 'usage',
          amount: -latest.fundUsed,
          label: `Fund use ${r.requestNo}: ${r.purpose}`,
          liquidationReceiptId: latest.id,
          createdById: actor.id,
          createdByName: actor.name,
          createdByDesignation: actor.designation ?? null,
        },
      });
      await tx.fundRequest.update({ where: { id: r.id }, data: { status: 'cleared', clearedAt: new Date() } });
    }
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'approve',
      entityType: 'liquidation_receipt',
      entityId: latest.id,
      before: { status: 'submitted' },
      after: {
        status: final ? 'approved' : 'submitted',
        requestNo: r.requestNo,
        fundUsed: Number(latest.fundUsed),
        overAccepted: over,
        ...(r.requestorId === actor.id ? { selfApproved: true } : {}),
        ledgerUsage: final ? -Number(latest.fundUsed) : 0,
      },
      req,
    });
    return { r, latest, final };
  });

  if (result.final) {
    await tellRequestor(ay.id, result.r, actor.id, 'liquidation.approved', {
      approverName: actor.name,
      fundUsed: formatCentavos(Number(result.latest.fundUsed)),
    });
  }
  res.json({ final: result.final });
});

fundRequestsRouter.post('/:id/liquidations/:lid/revision', requireOpenAy, async (req, res) => {
  const { message } = revisionSchema.parse(req.body);
  const { ay, actor } = ctxOf(req);
  const { id } = await loadRequest(req);
  const lid = uuidParam(req.params.lid);

  const r = await prisma.$transaction(async (tx) => {
    const { r, latest } = await latestSubmitted(tx, ay.id, id, lid);
    const approvers = await approversFor(tx, ay.id, 'liquidation', r.fund, r.requestorId);
    if (!isIn(approvers, actor.id)) throw forbidden('You are not an approver for this receipt.');
    await tx.liquidationDecision.create({
      data: {
        academicYearId: ay.id,
        liquidationReceiptId: latest.id,
        approverId: actor.id!,
        approverName: actor.name,
        approverDesignation: actor.designation ?? null,
        decision: 'revision_requested',
        comment: message ?? null,
      },
    });
    await tx.liquidationReceipt.update({
      where: { id: latest.id },
      data: { status: 'revision_requested', revisionMessage: message ?? null, revisionRequestedAt: new Date(), revisionRequestedById: actor.id, revisionRequestedByName: actor.name },
    });
    await tx.fundRequest.update({ where: { id: r.id }, data: { status: 'revision_requested' } });
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'reject',
      entityType: 'liquidation_receipt',
      entityId: latest.id,
      before: { status: 'submitted' },
      after: { status: 'revision_requested', message: message ?? null },
      req,
    });
    return r;
  });

  await tellRequestor(ay.id, r, actor.id, 'liquidation.revision_requested', { approverName: actor.name, message });
  res.json({ ok: true });
});
