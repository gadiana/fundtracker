import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { applicableCountSchema, fundCreateSchema, fundReorderSchema, fundUpdateSchema, ledgerAdjustmentSchema } from '@sft/shared';
import { prisma } from '../../db';
import { writeAudit } from '../../lib/audit';
import { canSeeConfidential, visibleFundsWhere } from '../../lib/confidential';
import { badRequest, conflict, notFound, uuidParam } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { ayContext, ctxOf, requireAdviser, requireMember, requireOpenAy } from '../../middleware/ay';
import { countApplicableStudents, syncCharges } from './charges';
import { fundHasCollections, fundInclude, fundSnapshot, fundStats, serializeFund } from './service';

/** Funds of the selected AY. Every active member can read the funds they may see; only the adviser changes them. */
export const fundsRouter = Router();
fundsRouter.use(requireAuth, ayContext, requireMember);
const adviserWrite = [requireAdviser, requireOpenAy];

async function loadFund(req: Request) {
  const { db, perms } = ctxOf(req);
  const fund = await db.fund.findFirst({ where: { id: uuidParam(req.params.id), ...visibleFundsWhere(perms) }, include: fundInclude });
  // a confidential fund looks exactly like a missing one to people who may not see it
  if (!fund) throw notFound('Fund not found.');
  return fund;
}

/** Year levels within the AY's setting; programs active in this AY. */
async function validateTargets(academicYearId: string, body: { yearLevels?: number[]; allPrograms?: boolean; programIds?: string[] }) {
  if (body.yearLevels) {
    const settings = await prisma.aySetting.findUnique({ where: { academicYearId } });
    const max = settings?.yearLevelCount ?? 4;
    if (body.yearLevels.some((y) => y > max)) throw badRequest('INVALID_YEAR_LEVEL', `Year levels must be from 1 to ${max}.`);
  }
  if (body.allPrograms === false && body.programIds?.length) {
    const found = await prisma.program.count({ where: { academicYearId, id: { in: body.programIds }, isActive: true } });
    if (found !== new Set(body.programIds).size) throw badRequest('INVALID_PROGRAM', 'Choose active programs of this academic year.');
  }
}

async function assertNameFree(academicYearId: string, name: string, exceptId?: string) {
  const clash = await prisma.fund.findFirst({
    where: { academicYearId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (clash) throw conflict('DUPLICATE', `A fund named "${clash.name}" already exists in this academic year.`);
}

// ───────────────────────────── read ─────────────────────────────

fundsRouter.get('/', async (req, res) => {
  const { db, ay, perms } = ctxOf(req);
  const [funds, stats, locked] = await Promise.all([
    db.fund.findMany({ where: visibleFundsWhere(perms), include: fundInclude, orderBy: { priority: 'asc' } }),
    fundStats(prisma, ay.id),
    prisma.paymentAllocation.findMany({ where: { academicYearId: ay.id }, distinct: ['chargeId'], select: { charge: { select: { fundId: true } } } }),
  ]);
  const lockedFunds = new Set(locked.map((l) => l.charge.fundId));
  res.json({
    items: funds.map((f) => serializeFund(f, stats.get(f.id), lockedFunds.has(f.id))),
    canManage: perms.includes('manage'),
    canSeeConfidential: canSeeConfidential(perms),
  });
});

fundsRouter.get('/applicable-count', requireAdviser, async (req, res) => {
  const q = applicableCountSchema.parse({
    yearLevels: String(req.query.yearLevels ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number),
    allPrograms: req.query.allPrograms !== 'false',
    programIds: String(req.query.programIds ?? '')
      .split(',')
      .filter(Boolean),
  });
  res.json({ count: await countApplicableStudents(prisma, ctxOf(req).ay.id, q) });
});

fundsRouter.get('/:id', async (req, res) => {
  const { ay } = ctxOf(req);
  const fund = await loadFund(req);
  const [stats, locked] = await Promise.all([fundStats(prisma, ay.id), fundHasCollections(prisma, fund.id)]);
  res.json(serializeFund(fund, stats.get(fund.id), locked));
});

/** Every ledger entry of the fund, oldest first, with the running balance. */
fundsRouter.get('/:id/ledger', async (req, res) => {
  const fund = await loadFund(req);
  const entries = await prisma.fundLedger.findMany({
    where: { fundId: fund.id },
    include: { payment: { select: { transactionNo: true, studentNameSnapshot: true } }, reversesEntry: { select: { label: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  let running = 0;
  res.json({
    items: entries.map((e) => {
      running += Number(e.amount);
      return {
        id: e.id,
        entryType: e.entryType,
        amount: Number(e.amount),
        balanceAfter: running,
        label: e.label,
        transactionNo: e.payment?.transactionNo ?? null,
        studentName: e.payment?.studentNameSnapshot ?? null,
        reverses: e.reversesEntry?.label ?? null,
        createdByName: e.createdByName,
        createdByDesignation: e.createdByDesignation,
        createdAt: e.createdAt,
      };
    }),
    balance: running,
  });
});

// ───────────────────────────── create ─────────────────────────────

fundsRouter.post('/', ...adviserWrite, async (req, res) => {
  const body = fundCreateSchema.parse(req.body);
  const { ay, actor } = ctxOf(req);
  await validateTargets(ay.id, body);
  await assertNameFree(ay.id, body.name);

  const result = await prisma.$transaction(async (tx) => {
    const last = await tx.fund.aggregate({ where: { academicYearId: ay.id }, _max: { priority: true } });
    const fund = await tx.fund.create({
      data: {
        academicYearId: ay.id,
        name: body.name,
        notes: body.notes,
        amountPerStudent: BigInt(body.amountPerStudent),
        isConfidential: body.isConfidential,
        isMandatory: body.isMandatory,
        allPrograms: body.allPrograms,
        priority: (last._max.priority ?? 0) + 1,
        createdById: actor.id,
        createdByName: actor.name,
      },
    });
    await tx.fundYearLevel.createMany({ data: body.yearLevels.map((yearLevel) => ({ academicYearId: ay.id, fundId: fund.id, yearLevel })) });
    if (!body.allPrograms) {
      await tx.fundProgram.createMany({ data: body.programIds.map((programId) => ({ academicYearId: ay.id, fundId: fund.id, programId })) });
    }
    const charges = await syncCharges(tx, ay.id, { fundIds: [fund.id] }, actor);
    const full = await tx.fund.findUniqueOrThrow({ where: { id: fund.id }, include: fundInclude });
    await writeAudit(tx, { ayId: ay.id, actor, action: 'create', entityType: 'fund', entityId: fund.id, after: { ...fundSnapshot(full), charges }, req });
    return { full, charges };
  });
  const stats = await fundStats(prisma, ay.id);
  res.status(201).json({ fund: serializeFund(result.full, stats.get(result.full.id)), charges: result.charges });
});

// ───────────────────────────── edit ─────────────────────────────

fundsRouter.patch('/:id', ...adviserWrite, async (req, res) => {
  const body = fundUpdateSchema.parse(req.body);
  const { ay, actor } = ctxOf(req);
  const before = await loadFund(req);
  await validateTargets(ay.id, { yearLevels: body.yearLevels, allPrograms: body.allPrograms ?? before.allPrograms, programIds: body.programIds });
  if (body.name) await assertNameFree(ay.id, body.name, before.id);

  const amountChanges = body.amountPerStudent !== undefined && BigInt(body.amountPerStudent) !== before.amountPerStudent;
  if (amountChanges && (await fundHasCollections(prisma, before.id))) {
    throw conflict('AMOUNT_LOCKED', `The amount of ${before.name} can no longer change: collection has started.`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const data: Prisma.FundUncheckedUpdateInput = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.isConfidential !== undefined ? { isConfidential: body.isConfidential } : {}),
      ...(body.isMandatory !== undefined ? { isMandatory: body.isMandatory } : {}),
      ...(body.allPrograms !== undefined ? { allPrograms: body.allPrograms } : {}),
      ...(amountChanges ? { amountPerStudent: BigInt(body.amountPerStudent!) } : {}),
    };
    await tx.fund.update({ where: { id: before.id }, data });
    if (amountChanges) {
      await tx.studentCharge.updateMany({ where: { fundId: before.id, status: 'active' }, data: { amountDue: BigInt(body.amountPerStudent!) } });
    }
    if (body.yearLevels) {
      await tx.fundYearLevel.deleteMany({ where: { fundId: before.id } });
      await tx.fundYearLevel.createMany({ data: body.yearLevels.map((yearLevel) => ({ academicYearId: ay.id, fundId: before.id, yearLevel })) });
    }
    const allPrograms = body.allPrograms ?? before.allPrograms;
    if (body.programIds !== undefined || body.allPrograms !== undefined) {
      await tx.fundProgram.deleteMany({ where: { fundId: before.id } });
      const ids = allPrograms ? [] : (body.programIds ?? before.programs.map((p) => p.programId));
      if (ids.length) await tx.fundProgram.createMany({ data: ids.map((programId) => ({ academicYearId: ay.id, fundId: before.id, programId })) });
    }
    const charges = await syncCharges(tx, ay.id, { fundIds: [before.id] }, actor, `Fund ${before.name} no longer applies`);
    const full = await tx.fund.findUniqueOrThrow({ where: { id: before.id }, include: fundInclude });
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'update',
      entityType: 'fund',
      entityId: before.id,
      before: fundSnapshot(before),
      after: { ...fundSnapshot(full), charges },
      req,
    });
    return { full, charges };
  });
  const [stats, locked] = await Promise.all([fundStats(prisma, ay.id), fundHasCollections(prisma, before.id)]);
  res.json({ fund: serializeFund(result.full, stats.get(before.id), locked), charges: result.charges });
});

/** Priority order: payments fill funds in this order (hybrid / priority-only allocation). */
fundsRouter.post('/reorder', ...adviserWrite, async (req, res) => {
  const { ids } = fundReorderSchema.parse(req.body);
  const { ay, actor } = ctxOf(req);
  const funds = await prisma.fund.findMany({ where: { academicYearId: ay.id }, orderBy: { priority: 'asc' } });
  if (funds.length !== ids.length || !funds.every((f) => ids.includes(f.id))) {
    throw badRequest('BAD_ORDER', 'Send every fund of this academic year exactly once.');
  }
  await prisma.$transaction(async (tx) => {
    // two passes so the unique (academic year, priority) index never sees a clash mid-way
    for (const [i, id] of ids.entries()) await tx.fund.update({ where: { id }, data: { priority: -(i + 1) } });
    for (const [i, id] of ids.entries()) await tx.fund.update({ where: { id }, data: { priority: i + 1 } });
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'update',
      entityType: 'fund_priority',
      entityId: ay.id,
      before: { order: funds.map((f) => f.name) },
      after: { order: ids.map((id) => funds.find((f) => f.id === id)!.name) },
      req,
    });
  });
  res.json({ ok: true });
});

// ───────────────────────────── deactivate / reactivate ─────────────────────────────

fundsRouter.post('/:id/deactivate', ...adviserWrite, async (req, res) => {
  const { ay, actor } = ctxOf(req);
  const fund = await loadFund(req);
  if (!fund.isActive) throw conflict('ALREADY_INACTIVE', `${fund.name} is already deactivated.`);
  const paid = await prisma.paymentAllocation.count({ where: { charge: { fundId: fund.id }, payment: { status: 'posted' } } });
  if (paid) throw conflict('HAS_PAYMENTS', `${fund.name} already has payments, so it can't be deactivated. Its records must stay.`);

  const charges = await prisma.$transaction(async (tx) => {
    await tx.fund.update({ where: { id: fund.id }, data: { isActive: false } });
    const charges = await syncCharges(tx, ay.id, { fundIds: [fund.id] }, actor, `Fund ${fund.name} was deactivated`);
    await writeAudit(tx, { ayId: ay.id, actor, action: 'deactivate', entityType: 'fund', entityId: fund.id, after: { charges }, req });
    return charges;
  });
  res.json({ ok: true, charges });
});

fundsRouter.post('/:id/reactivate', ...adviserWrite, async (req, res) => {
  const { ay, actor } = ctxOf(req);
  const fund = await loadFund(req);
  if (fund.isActive) throw conflict('ALREADY_ACTIVE', `${fund.name} is already active.`);
  const charges = await prisma.$transaction(async (tx) => {
    await tx.fund.update({ where: { id: fund.id }, data: { isActive: true } });
    const charges = await syncCharges(tx, ay.id, { fundIds: [fund.id] }, actor);
    await writeAudit(tx, { ayId: ay.id, actor, action: 'reactivate', entityType: 'fund', entityId: fund.id, after: { charges }, req });
    return charges;
  });
  res.json({ ok: true, charges });
});

// ───────────────────────────── ledger adjustments ─────────────────────────────

/** A manual correction, recorded as an "adjustment" ledger entry. It can't take the fund below what's available. */
fundsRouter.post('/:id/adjustments', ...adviserWrite, async (req, res) => {
  const { amount, reason } = ledgerAdjustmentSchema.parse(req.body);
  const { ay, actor } = ctxOf(req);
  const fund = await loadFund(req);

  const entry = await prisma.$transaction(async (tx) => {
    // serialize adjustments on this fund
    await tx.$queryRaw`SELECT id FROM funds WHERE id = ${fund.id}::uuid FOR UPDATE`;
    const [b] = await tx.$queryRaw<{ available: bigint }[]>`SELECT available FROM v_fund_balances WHERE fund_id = ${fund.id}::uuid`;
    if (amount < 0 && (b?.available ?? 0n) + BigInt(amount) < 0n) {
      throw badRequest('INSUFFICIENT_BALANCE', 'This adjustment would take the fund below its available balance.');
    }
    const entry = await tx.fundLedger.create({
      data: {
        academicYearId: ay.id,
        fundId: fund.id,
        entryType: 'adjustment',
        amount: BigInt(amount),
        label: reason,
        createdById: actor.id,
        createdByName: actor.name,
        createdByDesignation: actor.designation ?? null,
      },
    });
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'create',
      entityType: 'fund_adjustment',
      entityId: entry.id,
      after: { fund: fund.name, amount, reason },
      req,
    });
    return entry;
  });
  res.status(201).json({ id: entry.id });
});
