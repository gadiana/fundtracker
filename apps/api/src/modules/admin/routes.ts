import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { brandingPatchSchema, formatPersonName, LOGO_MIME_TYPES, passwordIssues } from '@sft/shared';
import { prisma } from '../../db';
import { writeAudit, type Actor } from '../../lib/audit';
import { hashPassword } from '../../lib/crypto';
import { badRequest, conflict, notFound, uuidParam } from '../../lib/http';
import { describeDevice, OFFLINE_AFTER_MS, visitEnd } from '../../lib/presence';
import { getSecurity } from '../../lib/settings';
import { receiveFile, saveUpload } from '../../lib/uploads';
import { requireAuth, requireSuperadmin } from '../../middleware/auth';
import { changedFields, serializeSettings, type LogoKind } from '../settings/service';

/**
 * The superadmin's pages: advisers, the organization's branding, sign-in activity and the full
 * audit log. Oversight only: collecting, fund requests and approvals stay with each AY's staff.
 */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireSuperadmin);

const superActor = (req: Request): Actor => ({ id: req.user!.id, name: formatPersonName(req.user!), role: 'superadmin', designation: 'Superadmin' });

async function loadAy(id: string) {
  const ay = await prisma.academicYear.findUnique({ where: { id: uuidParam(id) } });
  if (!ay) throw notFound('Academic year not found.');
  return ay;
}

adminRouter.get('/ays', async (_req, res) => {
  const ays = await prisma.academicYear.findMany({ orderBy: { startYear: 'desc' }, include: { settings: { select: { academicYearId: true } } } });
  res.json({ items: ays.map((a) => ({ id: a.id, label: a.label, status: a.status, isCurrent: a.isCurrent, hasSettings: Boolean(a.settings) })) });
});

// ───────────────────────────── advisers ─────────────────────────────

const name = (max: number) => z.string().trim().min(1, 'Required').max(max);
const newAdviserSchema = z.object({
  firstName: name(100),
  middleName: z.string().trim().max(100).optional().transform((v) => v || null),
  lastName: name(100),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  /** starting password, changed by the adviser at first sign-in (ignored for an existing account) */
  password: z.string().max(200).optional(),
  academicYearId: z.string().uuid('Choose an academic year'),
});

const serializeAdviser = (m: Prisma.UserAyRoleGetPayload<{ include: { user: true; academicYear: true } }>) => ({
  membershipId: m.id,
  userId: m.userId,
  name: formatPersonName(m.user),
  email: m.user.email,
  academicYear: { id: m.academicYearId, label: m.academicYear.label },
  status: m.status,
  mustChangePassword: m.user.mustChangePassword,
  addedAt: m.decidedAt ?? m.requestedAt,
  addedByName: m.decidedByName,
  lastLoginAt: m.user.lastLoginAt,
});

adminRouter.get('/advisers', async (_req, res) => {
  const rows = await prisma.userAyRole.findMany({
    where: { role: 'adviser' },
    include: { user: true, academicYear: true },
    orderBy: [{ academicYear: { startYear: 'desc' } }, { decidedAt: 'asc' }],
  });
  res.json({ items: rows.map(serializeAdviser) });
});

/**
 * Makes someone an adviser of an academic year. A new account gets the starting password and
 * must change it at first sign-in; an existing account keeps its own password.
 */
adminRouter.post('/advisers', async (req, res) => {
  const body = newAdviserSchema.parse(req.body);
  const ay = await loadAy(body.academicYearId);
  const actor = superActor(req);
  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing?.isSuperadmin) throw conflict('IS_SUPERADMIN', 'That is the superadmin account.');
  if (!existing) {
    if (!body.password) throw badRequest('PASSWORD_REQUIRED', 'Give the new adviser a starting password.');
    const issues = passwordIssues(body.password, (await getSecurity()).passwordPolicy);
    if (issues.length) throw badRequest('WEAK_PASSWORD', 'The starting password does not meet the requirements.', { issues });
  }
  const passwordHash = existing ? null : await hashPassword(body.password!);

  const membership = await prisma.$transaction(async (tx) => {
    const user =
      existing ??
      (await tx.user.create({
        data: {
          email: body.email,
          passwordHash: passwordHash!,
          firstName: body.firstName,
          middleName: body.middleName,
          lastName: body.lastName,
          emailVerifiedAt: new Date(),
          mustChangePassword: true,
        },
      }));
    const fields = {
      role: 'adviser' as const,
      designationId: null,
      status: 'active' as const,
      decidedAt: new Date(),
      decidedById: actor.id,
      decidedByName: actor.name,
      decisionNote: 'Added by the superadmin',
    };
    const current = await tx.userAyRole.findUnique({ where: { academicYearId_userId: { academicYearId: ay.id, userId: user.id } } });
    if (current?.role === 'adviser' && current.status === 'active') throw conflict('ALREADY_ADVISER', `${formatPersonName(user)} is already an adviser of AY ${ay.label}.`);
    const membership = current
      ? await tx.userAyRole.update({ where: { id: current.id }, data: fields, include: { user: true, academicYear: true } })
      : await tx.userAyRole.create({ data: { academicYearId: ay.id, userId: user.id, ...fields }, include: { user: true, academicYear: true } });
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'create',
      entityType: 'user_ay_role',
      entityId: membership.id,
      before: current ? { role: current.role, status: current.status } : undefined,
      after: { role: 'adviser', status: 'active', name: formatPersonName(user), email: user.email, newAccount: !existing },
      req,
    });
    return membership;
  });
  res.status(201).json({ ...serializeAdviser(membership), newAccount: !existing });
});

for (const [path, status, action] of [
  ['deactivate', 'deactivated', 'deactivate'],
  ['reactivate', 'active', 'reactivate'],
] as const) {
  adminRouter.post(`/advisers/:id/${path}`, async (req, res) => {
    const m = await prisma.userAyRole.findUnique({ where: { id: uuidParam(req.params.id) }, include: { user: true, academicYear: true } });
    if (!m || m.role !== 'adviser') throw notFound('Adviser not found.');
    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.userAyRole.update({
        where: { id: m.id },
        data:
          status === 'deactivated'
            ? { status, deactivatedAt: new Date(), deactivatedById: req.user!.id, deactivatedByName: formatPersonName(req.user!) }
            : { status, deactivatedAt: null, deactivatedById: null, deactivatedByName: null },
        include: { user: true, academicYear: true },
      });
      await writeAudit(tx, { ayId: m.academicYearId, actor: superActor(req), action, entityType: 'user_ay_role', entityId: m.id, before: { status: m.status }, after: { status }, req });
      return updated;
    });
    res.json(serializeAdviser(updated));
  });
}

// ───────────────────────────── branding ─────────────────────────────

async function loadSettings(ayId: string) {
  const settings = await prisma.aySetting.findUnique({ where: { academicYearId: uuidParam(ayId) } });
  if (!settings) throw conflict('NEEDS_SETUP', 'This academic year has not been set up yet.');
  return settings;
}

adminRouter.get('/branding/:ayId', async (req, res) => {
  res.json(serializeSettings(await loadSettings(req.params.ayId!)));
});

adminRouter.patch('/branding/:ayId', async (req, res) => {
  const patch = brandingPatchSchema.parse(req.body);
  const before = await loadSettings(req.params.ayId!);
  const actor = superActor(req);
  const diff = changedFields(before as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  if (!diff.changed.length) {
    res.json(serializeSettings(before));
    return;
  }
  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.aySetting.update({ where: { academicYearId: before.academicYearId }, data: { ...patch, updatedById: actor.id, updatedByName: actor.name } });
    await writeAudit(tx, { ayId: before.academicYearId, actor, action: 'settings_change', entityType: 'settings', entityId: before.academicYearId, before: diff.before, after: diff.after, req });
    return updated;
  });
  res.json(serializeSettings(updated));
});

const LOGO_FIELD = { org: 'logoFileId', receipt: 'receiptLogoFileId' } as const;
function logoKindOf(req: Request): LogoKind {
  const kind = req.query.kind;
  if (kind === 'org' || kind === 'receipt') return kind;
  throw badRequest('BAD_KIND', 'kind must be "org" or "receipt".');
}

adminRouter.post('/branding/:ayId/logo', async (req, res) => {
  const kind = logoKindOf(req);
  const before = await loadSettings(req.params.ayId!);
  const actor = superActor(req);
  const file = await receiveFile(req, res, before.uploadMaxBytes);
  const updated = await prisma.$transaction(async (tx) => {
    const stored = await saveUpload(tx, { academicYearId: before.academicYearId, file, allowedMimes: LOGO_MIME_TYPES, actor });
    const updated = await tx.aySetting.update({
      where: { academicYearId: before.academicYearId },
      data: { [LOGO_FIELD[kind]]: stored.id, updatedById: actor.id, updatedByName: actor.name },
    });
    await writeAudit(tx, {
      ayId: before.academicYearId,
      actor,
      action: 'settings_change',
      entityType: 'settings',
      entityId: before.academicYearId,
      before: { [LOGO_FIELD[kind]]: before[LOGO_FIELD[kind]] },
      after: { [LOGO_FIELD[kind]]: stored.id, fileName: stored.originalName },
      req,
    });
    return updated;
  });
  res.json(serializeSettings(updated));
});

adminRouter.delete('/branding/:ayId/logo', async (req, res) => {
  const kind = logoKindOf(req);
  const before = await loadSettings(req.params.ayId!);
  const field = LOGO_FIELD[kind];
  if (!before[field]) {
    res.json(serializeSettings(before));
    return;
  }
  const actor = superActor(req);
  // the file itself is kept (old receipts may show it); only the setting is cleared
  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.aySetting.update({ where: { academicYearId: before.academicYearId }, data: { [field]: null, updatedById: actor.id, updatedByName: actor.name } });
    await writeAudit(tx, { ayId: before.academicYearId, actor, action: 'settings_change', entityType: 'settings', entityId: before.academicYearId, before: { [field]: before[field] }, after: { [field]: null }, req });
    return updated;
  });
  res.json(serializeSettings(updated));
});

// ───────────────────────────── sign-in activity ─────────────────────────────

const activityQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  userId: z.string().uuid().optional(),
});

/** Each person's role, for labels: superadmin, adviser, or their position in the current AY. */
async function rolesOf(userIds: string[]) {
  const current = await prisma.academicYear.findFirst({ where: { isCurrent: true } });
  const [users, memberships] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } } }),
    prisma.userAyRole.findMany({ where: { userId: { in: userIds }, status: 'active' }, include: { designation: true } }),
  ]);
  return new Map(
    users.map((u) => {
      if (u.isSuperadmin) return [u.id, 'Superadmin'];
      const mine = memberships.filter((m) => m.userId === u.id);
      const here = mine.find((m) => m.academicYearId === current?.id) ?? mine[0];
      return [u.id, mine.some((m) => m.role === 'adviser') ? 'Adviser' : (here?.designation?.name ?? 'No access yet')];
    }),
  );
}

/**
 * Who is online now, every visit in the period (device, from, to, how long), and each person's
 * total time in the system over the period. Default period: the last 7 days.
 */
adminRouter.get('/activity', async (req, res) => {
  const q = activityQuery.parse(req.query);
  const now = new Date();
  const to = q.to ?? now;
  const from = q.from ?? new Date(to.getTime() - 7 * 86_400_000);
  const visits = await prisma.userVisit.findMany({
    where: { startedAt: { lte: to }, lastSeenAt: { gte: from }, ...(q.userId ? { userId: q.userId } : {}) },
    include: { user: true, session: true },
    orderBy: { startedAt: 'desc' },
    take: 2000,
  });
  const roles = await rolesOf([...new Set(visits.map((v) => v.userId))]);

  const rows = visits.map((v) => {
    const end = visitEnd(v, now.getTime());
    const stop = end ?? now;
    // only the part of the visit inside the period counts toward the totals
    const counted = Math.max(0, Math.min(stop.getTime(), to.getTime()) - Math.max(v.startedAt.getTime(), from.getTime()));
    return {
      id: v.id,
      userId: v.userId,
      name: formatPersonName(v.user),
      email: v.user.email,
      role: roles.get(v.userId) ?? '',
      device: describeDevice(v.session.userAgent),
      ipAddress: v.session.ipAddress,
      startedAt: v.startedAt,
      endedAt: end,
      lastSeenAt: v.lastSeenAt,
      online: !end,
      minutes: Math.round((stop.getTime() - v.startedAt.getTime()) / 60_000),
      countedMs: counted,
    };
  });

  const totals = new Map<string, { userId: string; name: string; email: string; role: string; ms: number; visits: number; lastSeenAt: Date; online: boolean }>();
  for (const r of rows) {
    const t = totals.get(r.userId) ?? { userId: r.userId, name: r.name, email: r.email, role: r.role, ms: 0, visits: 0, lastSeenAt: r.lastSeenAt, online: false };
    t.ms += r.countedMs;
    t.visits += 1;
    if (r.lastSeenAt > t.lastSeenAt) t.lastSeenAt = r.lastSeenAt;
    t.online ||= r.online;
    totals.set(r.userId, t);
  }

  res.json({
    from,
    to,
    offlineAfterMinutes: OFFLINE_AFTER_MS / 60_000,
    online: rows.filter((r) => r.online).map(({ countedMs: _c, ...r }) => r),
    visits: rows.map(({ countedMs: _c, ...r }) => r),
    people: [...totals.values()]
      .sort((a, b) => b.ms - a.ms)
      .map(({ ms, ...t }) => ({ ...t, hours: Math.round((ms / 3_600_000) * 100) / 100 })),
  });
});

// ───────────────────────────── full audit log ─────────────────────────────

const auditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  ayId: z.string().uuid().optional(),
  action: z.string().max(40).optional(),
  entityType: z.string().max(60).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

adminRouter.get('/audit', async (req, res) => {
  const query = auditQuery.parse(req.query);
  const where: Prisma.AuditLogWhereInput = {
    ...(query.ayId ? { academicYearId: query.ayId } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.q ? { actorName: { contains: query.q, mode: 'insensitive' } } : {}),
    ...(query.from || query.to ? { createdAt: { gte: query.from, lte: query.to } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { academicYear: true } }),
  ]);
  res.json({
    total,
    page: query.page,
    pageSize: query.pageSize,
    items: rows.map((r) => ({
      id: r.id.toString(),
      createdAt: r.createdAt,
      academicYear: r.academicYear?.label ?? null,
      actorName: r.actorName,
      actorRole: r.actorRole,
      actorDesignation: r.actorDesignation,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.beforeData,
      after: r.afterData,
      ipAddress: r.ipAddress,
      device: r.userAgent ? describeDevice(r.userAgent) : null,
    })),
  });
});

adminRouter.get('/audit/filters', async (_req, res) => {
  const [actions, entityTypes] = await Promise.all([
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true } }),
    prisma.auditLog.findMany({ distinct: ['entityType'], select: { entityType: true } }),
  ]);
  res.json({ actions: actions.map((a) => a.action).sort(), entityTypes: entityTypes.map((e) => e.entityType).sort() });
});
