import { Router } from 'express';
import { z } from 'zod';
import {
  allocateByPriority,
  allocationProblems,
  emailReceiptSchema,
  formatPersonName,
  paymentCreateSchema,
  paymentVoidSchema,
  resolveChannels,
  totalBalance,
} from '@sft/shared';
import { prisma } from '../../db';
import { writeAudit } from '../../lib/audit';
import { badRequest, conflict, notFound, uuidParam } from '../../lib/http';
import { emailReceipt } from './email';
import { requireAuth } from '../../middleware/auth';
import { ayContext, ctxOf, requireAdviser, requireOpenAy, requirePermission } from '../../middleware/ay';
import { chargeBalances, ensureQrToken, nextTransactionNo, receiptFor, verifyUrl } from './service';

/** Recording payments, receipts and voids. Collectors and the adviser; only the adviser voids. */
export const paymentsRouter = Router();
paymentsRouter.use(requireAuth, ayContext, requirePermission('collect'));

/** How the Collection page must split payments in this AY. */
paymentsRouter.get('/options', async (req, res) => {
  const settings = await prisma.aySetting.findUnique({ where: { academicYearId: ctxOf(req).ay.id } });
  res.json({
    allocationMode: settings?.allocationMode ?? 'hybrid',
    allowPartialPayments: settings?.allowPartialPayments ?? true,
    timezone: settings?.timezone ?? 'Asia/Manila',
  });
});

// ───────────────────────────── record a payment ─────────────────────────────

paymentsRouter.post('/', requireOpenAy, async (req, res) => {
  const body = paymentCreateSchema.parse(req.body);
  const { ay, actor } = ctxOf(req);

  // a retried submission returns the payment that was already recorded
  const replay = await prisma.payment.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
  if (replay) {
    if (replay.academicYearId !== ay.id || replay.studentId !== body.studentId) {
      throw conflict('IDEMPOTENCY_MISMATCH', 'This form was already used for another payment. Reload and try again.');
    }
    res.json({ receipt: await receiptFor(replay.id, ay.id), replayed: true });
    return;
  }

  const settings = await prisma.aySetting.findUnique({ where: { academicYearId: ay.id } });
  if (!settings) throw conflict('NEEDS_SETUP', 'Set up this academic year first.');
  const now = new Date();

  const payment = await prisma.$transaction(async (tx) => {
    // one payment per student at a time: balances below can't change under us
    await tx.$queryRaw`SELECT id FROM students WHERE id = ${body.studentId}::uuid AND academic_year_id = ${ay.id}::uuid FOR UPDATE`;
    const student = await tx.student.findFirst({
      where: { id: body.studentId, academicYearId: ay.id },
      include: { program: true, section: true },
    });
    if (!student) throw notFound('Student not found in this academic year.');
    if (student.status !== 'active') throw conflict('NOT_ACTIVE', 'Only active students can pay.');
    if (student.needsProfileConfirmation) {
      throw conflict('NEEDS_CONFIRMATION', 'Confirm this student’s course, year and section before recording a payment.');
    }

    const charges = await chargeBalances(tx, student.id);
    const allowPartial = settings.allowPartialPayments;
    const usePriority = settings.allocationMode === 'priority_only' || (settings.allocationMode === 'hybrid' && !body.allocations?.length);
    const allocations = usePriority ? allocateByPriority(charges, body.amount, allowPartial) : (body.allocations ?? []);
    const problems = allocationProblems(charges, body.amount, allocations, allowPartial);
    if (problems.length) throw badRequest('INVALID_ALLOCATION', problems[0]!, { problems });

    const split = new Map(allocations.map((a) => [a.chargeId, a.amount]));
    const balanceBefore = totalBalance(charges);
    const clearedAfter = charges.every((c) => !c.isMandatory || c.balance - (split.get(c.chargeId) ?? 0) === 0);
    const transactionNo = await nextTransactionNo(tx, ay.id, settings.timezone, now);
    const qr = await ensureQrToken(tx, ay.id, student.id);

    const payment = await tx.payment.create({
      data: {
        academicYearId: ay.id,
        transactionNo,
        idempotencyKey: body.idempotencyKey,
        studentId: student.id,
        amount: BigInt(body.amount),
        balanceBefore: BigInt(balanceBefore),
        balanceAfter: BigInt(balanceBefore - body.amount),
        clearedAfter,
        studentNumberSnapshot: student.studentNumber,
        studentNameSnapshot: formatPersonName(student),
        programSnapshot: student.program.code,
        yearLevelSnapshot: student.yearLevel,
        sectionSnapshot: student.section?.name ?? null,
        processedById: actor.id!,
        processedByName: actor.name,
        processedByDesignation: actor.designation ?? null,
        receivedAt: now,
        qrTokenId: qr.id,
        qrUrl: verifyUrl(qr.token),
        notes: body.notes,
      },
    });

    for (const c of charges) {
      const amount = split.get(c.chargeId);
      if (!amount) continue;
      const allocation = await tx.paymentAllocation.create({
        data: {
          academicYearId: ay.id,
          paymentId: payment.id,
          chargeId: c.chargeId,
          amount: BigInt(amount),
          fundNameSnapshot: c.fundName,
          chargeBalanceAfter: BigInt(c.balance - amount),
        },
      });
      await tx.fundLedger.create({
        data: {
          academicYearId: ay.id,
          fundId: c.fundId,
          entryType: 'collection',
          amount: BigInt(amount),
          label: `Payment ${transactionNo} – ${formatPersonName(student)}`,
          paymentId: payment.id,
          allocationId: allocation.id,
          createdById: actor.id,
          createdByName: actor.name,
          createdByDesignation: actor.designation ?? null,
        },
      });
    }

    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'create',
      entityType: 'payment',
      entityId: payment.id,
      after: {
        transactionNo,
        student: formatPersonName(student),
        studentNumber: student.studentNumber,
        amount: body.amount,
        allocations: allocations.map((a) => ({ fund: charges.find((c) => c.chargeId === a.chargeId)!.fundName, amount: a.amount })),
        balanceAfter: balanceBefore - body.amount,
        clearedAfter,
      },
      req,
    });
    return payment;
  });

  const receipt = await receiptFor(payment.id, ay.id);
  // emailed automatically only when the AY turned that on and the student has an email
  const [payer, aySettings] = await Promise.all([
    prisma.student.findUniqueOrThrow({ where: { id: payment.studentId } }),
    prisma.aySetting.findUnique({ where: { academicYearId: ay.id } }),
  ]);
  const emailedTo = payer.email && resolveChannels(aySettings?.notificationEvents, 'payment.receipt').email ? payer.email : null;
  if (emailedTo) await emailReceipt(receipt, ay.id, emailedTo, actor, { automatic: true });
  res.status(201).json({ receipt, replayed: false, emailedTo });
});

// ───────────────────────────── read ─────────────────────────────

const listQuery = z.object({
  studentId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

paymentsRouter.get('/', async (req, res) => {
  const { db } = ctxOf(req);
  const q = listQuery.parse(req.query);
  const where = q.studentId ? { studentId: q.studentId } : {};
  const [total, rows] = await Promise.all([
    db.payment.count({ where }),
    db.payment.findMany({ where, orderBy: { receivedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  res.json({
    total,
    items: rows.map((p) => ({
      id: p.id,
      transactionNo: p.transactionNo,
      receivedAt: p.receivedAt,
      amount: Number(p.amount),
      balanceAfter: Number(p.balanceAfter),
      status: p.status,
      studentName: p.studentNameSnapshot,
      processedByName: p.processedByName,
    })),
  });
});

paymentsRouter.get('/:id', async (req, res) => {
  res.json(await receiptFor(uuidParam(req.params.id), ctxOf(req).ay.id));
});

// ───────────────────────────── void ─────────────────────────────

/**
 * Payments are never edited or deleted. Voiding keeps the payment (marked voided, with a reason)
 * and adds a reversing "void" ledger entry for each fund it went to.
 */
paymentsRouter.post('/:id/void', requireAdviser, requireOpenAy, async (req, res) => {
  const { reason } = paymentVoidSchema.parse(req.body);
  const { ay, actor } = ctxOf(req);
  const id = uuidParam(req.params.id);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${id}::uuid AND academic_year_id = ${ay.id}::uuid FOR UPDATE`;
    const payment = await tx.payment.findFirst({ where: { id, academicYearId: ay.id } });
    if (!payment) throw notFound('Payment not found.');
    if (payment.status === 'voided') throw conflict('ALREADY_VOIDED', `Payment ${payment.transactionNo} is already voided.`);

    const entries = await tx.fundLedger.findMany({ where: { paymentId: payment.id, entryType: 'collection' }, include: { fund: true } });
    for (const e of entries) {
      const [b] = await tx.$queryRaw<{ balance: bigint }[]>`SELECT balance FROM v_fund_balances WHERE fund_id = ${e.fundId}::uuid`;
      if ((b?.balance ?? 0n) - e.amount < 0n) {
        throw conflict('FUND_WOULD_GO_NEGATIVE', `Voiding would take ${e.fund.name} below zero: that money has already been used.`);
      }
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'voided',
        voidedAt: new Date(),
        voidedById: actor.id,
        voidedByName: actor.name,
        voidedByDesignation: actor.designation ?? null,
        voidReason: reason,
      },
    });
    for (const e of entries) {
      await tx.fundLedger.create({
        data: {
          academicYearId: ay.id,
          fundId: e.fundId,
          entryType: 'void',
          amount: -e.amount,
          label: `Void of payment ${payment.transactionNo}: ${reason}`,
          paymentId: payment.id,
          reversesEntryId: e.id,
          createdById: actor.id,
          createdByName: actor.name,
          createdByDesignation: actor.designation ?? null,
        },
      });
    }
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'void',
      entityType: 'payment',
      entityId: payment.id,
      before: { status: 'posted', transactionNo: payment.transactionNo, amount: Number(payment.amount) },
      after: { status: 'voided', reason, reversedEntries: entries.length },
      req,
    });
  });
  res.json(await receiptFor(id, ay.id));
});

// ───────────────────────────── email ─────────────────────────────

paymentsRouter.post('/:id/email', async (req, res) => {
  const { to } = emailReceiptSchema.parse(req.body);
  const { ay, actor } = ctxOf(req);
  const receipt = await receiptFor(uuidParam(req.params.id), ay.id);
  const student = await prisma.student.findUniqueOrThrow({ where: { id: receipt.student.id } });
  const recipient = to ?? student.email;
  if (!recipient) throw badRequest('NO_EMAIL', 'This student has no email address. Enter one to send the receipt to.');

  const sent = await emailReceipt(receipt, ay.id, recipient, actor);
  if (!sent) {
    const failed = await prisma.emailOutbox.findFirst({ where: { entityId: receipt.id, templateKey: 'payment.receipt' }, orderBy: { createdAt: 'desc' } });
    throw conflict('EMAIL_FAILED', `The receipt could not be emailed to ${recipient}. ${failed?.lastError ?? 'Check the mail server settings and try again.'}`);
  }
  await writeAudit(prisma, {
    ayId: ay.id,
    actor,
    action: 'create',
    entityType: 'receipt_email',
    entityId: receipt.id,
    after: { transactionNo: receipt.transactionNo, to: recipient },
    req,
  });
  res.json({ ok: true, to: recipient });
});
