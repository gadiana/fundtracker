import { Router, type Request } from 'express';
import {
  approverSchema,
  designationPatchSchema,
  designationSchema,
  formatPersonName,
  programPatchSchema,
  programSchema,
  reorderSchema,
  sectionPatchSchema,
  sectionSchema,
} from '@sft/shared';
import { writeAudit } from '../../lib/audit';
import { badRequest, conflict, notFound, uuidParam } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { ayContext, ctxOf, requireAdviser, requireMember, requireOpenAy } from '../../middleware/ay';

const memberGate = [requireAuth, ayContext, requireMember];
const adviserWrite = [requireAdviser, requireOpenAy];

async function audit(req: Request, action: 'create' | 'update' | 'delete', entityType: string, entityId: string, before?: unknown, after?: unknown) {
  const { db, ay, actor } = ctxOf(req);
  await writeAudit(db, { ayId: ay.id, actor, action, entityType, entityId, before, after, req });
}

// ───────────────────────────── Programs ─────────────────────────────

export const programsRouter = Router();
programsRouter.use(...memberGate);

programsRouter.get('/', async (req, res) => {
  const items = await ctxOf(req).db.program.findMany({ orderBy: { code: 'asc' } });
  res.json({ items });
});

programsRouter.post('/', ...adviserWrite, async (req, res) => {
  const body = programSchema.parse(req.body);
  const { db, ay } = ctxOf(req);
  if (await db.program.findFirst({ where: { code: body.code } })) throw conflict('DUPLICATE', `Program ${body.code} already exists.`);
  const program = await db.program.create({ data: { ...body, academicYearId: ay.id } });
  await audit(req, 'create', 'program', program.id, undefined, program);
  res.status(201).json(program);
});

programsRouter.patch('/:id', ...adviserWrite, async (req, res) => {
  const body = programPatchSchema.parse(req.body);
  const { db } = ctxOf(req);
  const before = await db.program.findUnique({ where: { id: uuidParam(req.params.id) } });
  if (!before) throw notFound('Program not found.');
  if (body.code && body.code !== before.code && (await db.program.findFirst({ where: { code: body.code } }))) {
    throw conflict('DUPLICATE', `Program ${body.code} already exists.`);
  }
  const program = await db.program.update({ where: { id: before.id }, data: body });
  await audit(req, 'update', 'program', program.id, before, program);
  res.json(program);
});

/** Deletes a program nobody uses yet; once used, it can only be deactivated. */
programsRouter.delete('/:id', ...adviserWrite, async (req, res) => {
  const { db } = ctxOf(req);
  const program = await db.program.findUnique({ where: { id: uuidParam(req.params.id) } });
  if (!program) throw notFound('Program not found.');
  const [students, funds] = await Promise.all([
    db.student.count({ where: { programId: program.id } }),
    db.fundProgram.count({ where: { programId: program.id } }),
  ]);
  if (students || funds) throw conflict('IN_USE', `${program.code} is already used by students or funds. Deactivate it instead.`);
  await db.program.delete({ where: { id: program.id } });
  await audit(req, 'delete', 'program', program.id, program);
  res.status(204).end();
});

// ───────────────────────────── Sections ─────────────────────────────

export const sectionsRouter = Router();
sectionsRouter.use(...memberGate);

sectionsRouter.get('/', async (req, res) => {
  const items = await ctxOf(req).db.section.findMany({ orderBy: { name: 'asc' } });
  res.json({ items });
});

sectionsRouter.post('/', ...adviserWrite, async (req, res) => {
  const body = sectionSchema.parse(req.body);
  const { db, ay } = ctxOf(req);
  if (await db.section.findFirst({ where: { name: body.name } })) throw conflict('DUPLICATE', `Section ${body.name} already exists.`);
  const section = await db.section.create({ data: { ...body, academicYearId: ay.id } });
  await audit(req, 'create', 'section', section.id, undefined, section);
  res.status(201).json(section);
});

sectionsRouter.patch('/:id', ...adviserWrite, async (req, res) => {
  const body = sectionPatchSchema.parse(req.body);
  const { db } = ctxOf(req);
  const before = await db.section.findUnique({ where: { id: uuidParam(req.params.id) } });
  if (!before) throw notFound('Section not found.');
  if (body.name && body.name !== before.name && (await db.section.findFirst({ where: { name: body.name } }))) {
    throw conflict('DUPLICATE', `Section ${body.name} already exists.`);
  }
  const section = await db.section.update({ where: { id: before.id }, data: body });
  await audit(req, 'update', 'section', section.id, before, section);
  res.json(section);
});

sectionsRouter.delete('/:id', ...adviserWrite, async (req, res) => {
  const { db } = ctxOf(req);
  const section = await db.section.findUnique({ where: { id: uuidParam(req.params.id) } });
  if (!section) throw notFound('Section not found.');
  if (await db.student.count({ where: { sectionId: section.id } })) {
    throw conflict('IN_USE', `Section ${section.name} already has students. Deactivate it instead.`);
  }
  await db.section.delete({ where: { id: section.id } });
  await audit(req, 'delete', 'section', section.id, section);
  res.status(204).end();
});

// ─────────────────────── Positions (designations) ───────────────────────

export const designationsRouter = Router();
designationsRouter.use(...memberGate);

designationsRouter.get('/', async (req, res) => {
  const { db } = ctxOf(req);
  const [items, counts] = await Promise.all([
    db.designation.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    db.userAyRole.groupBy({ by: ['designationId'], where: { status: 'active' }, _count: { _all: true } }),
  ]);
  const holders = new Map(counts.map((c) => [c.designationId, c._count._all]));
  res.json({ items: items.map((d) => ({ ...d, activeMembers: holders.get(d.id) ?? 0 })) });
});

designationsRouter.post('/', ...adviserWrite, async (req, res) => {
  const body = designationSchema.parse(req.body);
  const { db, ay } = ctxOf(req);
  if (await db.designation.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' } } })) {
    throw conflict('DUPLICATE', `A position named "${body.name}" already exists.`);
  }
  const last = await db.designation.aggregate({ _max: { sortOrder: true } });
  const designation = await db.designation.create({ data: { ...body, academicYearId: ay.id, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
  await audit(req, 'create', 'designation', designation.id, undefined, designation);
  res.status(201).json({ ...designation, activeMembers: 0 });
});

designationsRouter.patch('/:id', ...adviserWrite, async (req, res) => {
  const body = designationPatchSchema.parse(req.body);
  const { db } = ctxOf(req);
  const before = await db.designation.findUnique({ where: { id: uuidParam(req.params.id) } });
  if (!before) throw notFound('Position not found.');
  if (
    body.name &&
    body.name.toLowerCase() !== before.name.toLowerCase() &&
    (await db.designation.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' } } }))
  ) {
    throw conflict('DUPLICATE', `A position named "${body.name}" already exists.`);
  }
  const holders = await db.userAyRole.count({ where: { designationId: before.id, status: 'active' } });
  if (body.isActive === false && holders > 0) {
    throw conflict('IN_USE', `${holders} active member(s) hold "${before.name}". Give them another position first.`);
  }
  const designation = await db.designation.update({ where: { id: before.id }, data: body });
  await audit(req, 'update', 'designation', designation.id, before, designation);
  res.json({ ...designation, activeMembers: holders });
});

designationsRouter.post('/reorder', ...adviserWrite, async (req, res) => {
  const { ids } = reorderSchema.parse(req.body);
  const { db } = ctxOf(req);
  const existing = await db.designation.findMany({ select: { id: true } });
  if (existing.length !== ids.length || !existing.every((d) => ids.includes(d.id))) {
    throw badRequest('BAD_ORDER', 'Send every position exactly once.');
  }
  await db.$transaction(ids.map((id, sortOrder) => db.designation.update({ where: { id }, data: { sortOrder } })));
  await audit(req, 'update', 'designation_order', ctxOf(req).ay.id, undefined, { ids });
  res.json({ ok: true });
});

/** Deletes a position nobody ever held; otherwise deactivate it. */
designationsRouter.delete('/:id', ...adviserWrite, async (req, res) => {
  const { db } = ctxOf(req);
  const designation = await db.designation.findUnique({ where: { id: uuidParam(req.params.id) } });
  if (!designation) throw notFound('Position not found.');
  if (await db.userAyRole.count({ where: { designationId: designation.id } })) {
    throw conflict('IN_USE', `"${designation.name}" has been assigned before. Deactivate it instead.`);
  }
  await db.designation.delete({ where: { id: designation.id } });
  await audit(req, 'delete', 'designation', designation.id, designation);
  res.status(204).end();
});

// ───────────────────────────── Approvers ─────────────────────────────

/** Extra approvers for fund requests and liquidation receipts. The adviser is always one. */
export const approversRouter = Router();
approversRouter.use(requireAuth, ayContext, requireAdviser);

approversRouter.get('/', async (req, res) => {
  const { db } = ctxOf(req);
  const [approvers, members] = await Promise.all([
    db.ayApprover.findMany({ include: { membership: { include: { user: true, designation: true } } } }),
    db.userAyRole.findMany({ where: { status: 'active', role: 'member' }, include: { user: true, designation: true } }),
  ]);
  const byUser = new Map(approvers.map((a) => [a.userId, a]));
  res.json({
    items: approvers.map((a) => ({
      userId: a.userId,
      name: formatPersonName(a.membership.user),
      position: a.membership.designation?.name ?? null,
      active: a.membership.status === 'active',
      approvesFundRequests: a.approvesFundRequests,
      approvesLiquidations: a.approvesLiquidations,
      addedByName: a.addedByName,
      addedAt: a.addedAt,
    })),
    candidates: members
      .filter((m) => !byUser.has(m.userId))
      .map((m) => ({ userId: m.userId, name: formatPersonName(m.user), position: m.designation?.name ?? null })),
  });
});

approversRouter.put('/:userId', requireOpenAy, async (req, res) => {
  const flags = approverSchema.parse(req.body);
  const { db, ay, actor } = ctxOf(req);
  const userId = uuidParam(req.params.userId);
  const membership = await db.userAyRole.findFirst({ where: { userId } });
  if (!membership || membership.status !== 'active' || membership.role !== 'member') {
    throw badRequest('NOT_A_MEMBER', 'Approvers must be active members of this academic year.');
  }
  const before = await db.ayApprover.findFirst({ where: { userId } });
  const approver = before
    ? await db.ayApprover.update({
        where: { academicYearId_userId: { academicYearId: membership.academicYearId, userId } },
        data: flags,
      })
    : await db.ayApprover.create({ data: { academicYearId: ay.id, userId, ...flags, addedById: actor.id, addedByName: actor.name } });
  await audit(req, before ? 'update' : 'create', 'approver', userId, before ?? undefined, approver);
  res.json(approver);
});

approversRouter.delete('/:userId', requireOpenAy, async (req, res) => {
  const { db, ay } = ctxOf(req);
  const userId = uuidParam(req.params.userId);
  const before = await db.ayApprover.findFirst({ where: { userId } });
  if (!before) throw notFound('Not an approver.');
  await db.ayApprover.delete({ where: { academicYearId_userId: { academicYearId: ay.id, userId } } });
  await audit(req, 'delete', 'approver', userId, before);
  res.status(204).end();
});
