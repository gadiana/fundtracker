import { Router } from 'express';
import {
  approveMemberSchema,
  changeDesignationSchema,
  deactivateMemberSchema,
  formatPersonName,
  memberStatusFilter,
  rejectMemberSchema,
} from '@sft/shared';
import { prisma } from '../../db';
import { writeAudit } from '../../lib/audit';
import { sendEvent } from '../../lib/events';
import { badRequest, conflict, forbidden, notFound, uuidParam } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { ayContext, ctxOf, requireAdviser, requireOpenAy } from '../../middleware/ay';
import { ensureSeat, membershipSnapshot, serializeMember } from './service';

/** Account management for the selected AY. Adviser only. */
export const membersRouter = Router();
membersRouter.use(requireAuth, ayContext, requireAdviser);

const include = { user: true, designation: true } as const;

membersRouter.get('/', async (req, res) => {
  const { db, actor } = ctxOf(req);
  const status = req.query.status ? memberStatusFilter.parse(req.query.status) : undefined;
  const members = await db.userAyRole.findMany({
    where: status ? { status } : {},
    include,
    orderBy: [{ requestedAt: 'desc' }],
  });
  res.json({ items: members.map((m) => serializeMember(m, actor.id ?? undefined)) });
});

membersRouter.get('/summary', async (req, res) => {
  const { db } = ctxOf(req);
  const groups = await db.userAyRole.groupBy({ by: ['status'], _count: { _all: true } });
  const counts = { pending: 0, active: 0, rejected: 0, deactivated: 0 };
  for (const g of groups) counts[g.status] = g._count._all;
  res.json(counts);
});

async function loadMember(req: Parameters<typeof ctxOf>[0], id: string) {
  const member = await ctxOf(req).db.userAyRole.findUnique({ where: { id }, include });
  if (!member) throw notFound('Account not found in this academic year.');
  return member;
}

async function loadDesignation(req: Parameters<typeof ctxOf>[0], designationId: string) {
  const designation = await ctxOf(req).db.designation.findUnique({ where: { id: designationId } });
  if (!designation || !designation.isActive) throw badRequest('INVALID_DESIGNATION', 'Choose a valid position.');
  return designation;
}

membersRouter.post('/:id/approve', requireOpenAy, async (req, res) => {
  const { designationId } = approveMemberSchema.parse(req.body);
  const { db, ay, actor } = ctxOf(req);
  const member = await loadMember(req, uuidParam(req.params.id));
  if (member.status !== 'pending') throw conflict('NOT_PENDING', 'Only pending accounts can be approved.');
  const designation = await loadDesignation(req, designationId);

  const updated = await db.$transaction(async (tx) => {
    await ensureSeat(tx, designation);
    const updated = await tx.userAyRole.update({
      where: { id: member.id },
      data: {
        status: 'active',
        role: 'member',
        designationId: designation.id,
        decidedAt: new Date(),
        decidedById: actor.id,
        decidedByName: actor.name,
        decisionNote: null,
      },
      include,
    });
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'approve',
      entityType: 'user_ay_role',
      entityId: member.id,
      before: membershipSnapshot(member),
      after: membershipSnapshot(updated),
      req,
    });
    return updated;
  });

  await sendEvent('membership.approved', {
    ayId: ay.id,
    to: [{ userId: member.userId, email: member.user.email, name: formatPersonName(member.user) }],
    vars: { position: designation.name },
    linkPath: '/',
    entityType: 'user_ay_role',
    entityId: member.id,
    requestedBy: actor,
  });
  res.json(serializeMember(updated, actor.id ?? undefined));
});

membersRouter.post('/:id/reject', requireOpenAy, async (req, res) => {
  const { comment } = rejectMemberSchema.parse(req.body);
  const { db, ay, actor } = ctxOf(req);
  const member = await loadMember(req, uuidParam(req.params.id));
  if (member.status !== 'pending') throw conflict('NOT_PENDING', 'Only pending accounts can be rejected.');

  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.userAyRole.update({
      where: { id: member.id },
      data: {
        status: 'rejected',
        decidedAt: new Date(),
        decidedById: actor.id,
        decidedByName: actor.name,
        decisionNote: comment ?? null,
      },
      include,
    });
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'reject',
      entityType: 'user_ay_role',
      entityId: member.id,
      before: membershipSnapshot(member),
      after: membershipSnapshot(updated),
      req,
    });
    return updated;
  });

  await sendEvent('membership.rejected', {
    ayId: ay.id,
    to: [{ userId: member.userId, email: member.user.email, name: formatPersonName(member.user) }],
    vars: { comment },
    entityType: 'user_ay_role',
    entityId: member.id,
    requestedBy: actor,
  });
  res.json(serializeMember(updated, actor.id ?? undefined));
});

membersRouter.patch('/:id', requireOpenAy, async (req, res) => {
  const { designationId } = changeDesignationSchema.parse(req.body);
  const { db, ay, actor } = ctxOf(req);
  const member = await loadMember(req, uuidParam(req.params.id));
  if (member.status !== 'active' || member.role !== 'member') {
    throw conflict('NOT_ACTIVE_MEMBER', 'Only active members can change position.');
  }
  const designation = await loadDesignation(req, designationId);

  const updated = await db.$transaction(async (tx) => {
    await ensureSeat(tx, designation, member.id);
    const updated = await tx.userAyRole.update({ where: { id: member.id }, data: { designationId: designation.id }, include });
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'update',
      entityType: 'user_ay_role',
      entityId: member.id,
      before: membershipSnapshot(member),
      after: membershipSnapshot(updated),
      req,
    });
    return updated;
  });
  res.json(serializeMember(updated, actor.id ?? undefined));
});

membersRouter.post('/:id/deactivate', requireOpenAy, async (req, res) => {
  const { reason } = deactivateMemberSchema.parse(req.body);
  const { db, ay, actor } = ctxOf(req);
  const member = await loadMember(req, uuidParam(req.params.id));
  if (member.userId === actor.id) throw forbidden('You cannot deactivate your own account.', 'SELF_ACTION');
  if (member.role === 'adviser') throw forbidden('The adviser account cannot be deactivated here.', 'ADVISER_PROTECTED');
  if (member.status !== 'active') throw conflict('NOT_ACTIVE', 'Only active accounts can be deactivated.');

  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.userAyRole.update({
      where: { id: member.id },
      data: {
        status: 'deactivated',
        deactivatedAt: new Date(),
        deactivatedById: actor.id,
        deactivatedByName: actor.name,
        decisionNote: reason ?? null,
      },
      include,
    });
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'deactivate',
      entityType: 'user_ay_role',
      entityId: member.id,
      before: membershipSnapshot(member),
      after: membershipSnapshot(updated),
      req,
    });
    return updated;
  });
  res.json(serializeMember(updated, actor.id ?? undefined));
});

membersRouter.post('/:id/reactivate', requireOpenAy, async (req, res) => {
  const { db, ay, actor } = ctxOf(req);
  const member = await loadMember(req, uuidParam(req.params.id));
  if (member.status !== 'deactivated') throw conflict('NOT_DEACTIVATED', 'Only deactivated accounts can be reactivated.');
  if (member.role === 'member' && !member.designation?.isActive) {
    throw conflict('INVALID_DESIGNATION', 'Their position no longer exists. Assign a new position after reactivating.');
  }

  const updated = await db.$transaction(async (tx) => {
    if (member.role === 'member' && member.designation) await ensureSeat(tx, member.designation, member.id);
    const updated = await tx.userAyRole.update({
      where: { id: member.id },
      data: { status: 'active', deactivatedAt: null, deactivatedById: null, deactivatedByName: null, decisionNote: null },
      include,
    });
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'reactivate',
      entityType: 'user_ay_role',
      entityId: member.id,
      before: membershipSnapshot(member),
      after: membershipSnapshot(updated),
      req,
    });
    return updated;
  });
  res.json(serializeMember(updated, actor.id ?? undefined));
});

/**
 * Permanently removes an account. Only allowed for accounts that were never approved in
 * any academic year, so they can't have any transactions. Everyone else is deactivated.
 */
membersRouter.delete('/:id', requireOpenAy, async (req, res) => {
  const { ay, actor } = ctxOf(req);
  const member = await loadMember(req, uuidParam(req.params.id));
  if (member.userId === actor.id) throw forbidden('You cannot remove your own account.', 'SELF_ACTION');

  const everApproved = await prisma.userAyRole.count({
    where: { userId: member.userId, status: { in: ['active', 'deactivated'] } },
  });
  if (everApproved > 0) {
    throw conflict('HAS_HISTORY', 'This account has been active before, so it can only be deactivated.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.userAyRole.deleteMany({ where: { userId: member.userId } });
    await tx.user.delete({ where: { id: member.userId } });
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'delete',
      entityType: 'user',
      entityId: member.userId,
      before: { name: formatPersonName(member.user), email: member.user.email, membership: membershipSnapshot(member) },
      req,
    });
  });
  res.status(204).end();
});

