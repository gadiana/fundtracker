import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { formatPersonName } from '@sft/shared';
import { prisma } from '../../db';
import { describeDevice, OFFLINE_AFTER_MS, visitEnd } from '../../lib/presence';
import { requireAuth } from '../../middleware/auth';
import { ayContext, ctxOf, requireAdviser } from '../../middleware/ay';
import { describeAudit } from './describe';

/**
 * The adviser's logs for the selected AY: the complete audit log (every action as a plain
 * sentence with what changed, the device and IP address) and the sign-in activity of the year's people.
 */
export const auditRouter = Router();
auditRouter.use(requireAuth, ayContext, requireAdviser);

// ───────────────────────────── audit log ─────────────────────────────

const auditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  action: z.string().max(40).optional(),
  entityType: z.string().max(60).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

auditRouter.get('/', async (req, res) => {
  const { ay } = ctxOf(req);
  const query = auditQuery.parse(req.query);
  const where: Prisma.AuditLogWhereInput = {
    academicYearId: ay.id,
    ...(query.action ? { action: query.action } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.q ? { actorName: { contains: query.q, mode: 'insensitive' } } : {}),
    ...(query.from || query.to ? { createdAt: { gte: query.from, lte: query.to } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
  ]);
  const described = await describeAudit(rows);
  res.json({
    total,
    page: query.page,
    pageSize: query.pageSize,
    items: rows.map((r, i) => ({
      id: r.id.toString(),
      createdAt: r.createdAt,
      actorName: r.actorName,
      actorDesignation: r.actorRole === 'adviser' ? 'Adviser' : r.actorDesignation,
      action: r.action,
      entityType: r.entityType,
      summary: described[i]!.summary,
      details: described[i]!.details,
      ipAddress: r.ipAddress,
      device: r.userAgent ? describeDevice(r.userAgent) : null,
    })),
  });
});

/** The actions and record types that appear in this year's log, for the filters. */
auditRouter.get('/filters', async (req, res) => {
  const { ay } = ctxOf(req);
  const where = { academicYearId: ay.id };
  const [actions, entityTypes] = await Promise.all([
    prisma.auditLog.findMany({ where, distinct: ['action'], select: { action: true } }),
    prisma.auditLog.findMany({ where, distinct: ['entityType'], select: { entityType: true } }),
  ]);
  res.json({ actions: actions.map((a) => a.action).sort(), entityTypes: entityTypes.map((e) => e.entityType).sort() });
});

// ───────────────────────────── sign-in activity ─────────────────────────────

const activityQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  userId: z.string().uuid().optional(),
});

/**
 * Who of this year's people is online now, every visit in the period (device, from, to, how
 * long), and each person's total time in the system. Default period: the last 7 days.
 */
auditRouter.get('/activity', async (req, res) => {
  const { ay } = ctxOf(req);
  const q = activityQuery.parse(req.query);
  const now = new Date();
  const to = q.to ?? now;
  const from = q.from ?? new Date(to.getTime() - 7 * 86_400_000);
  const [visits, memberships] = await Promise.all([
    prisma.userVisit.findMany({
      where: {
        startedAt: { lte: to },
        lastSeenAt: { gte: from },
        user: { memberships: { some: { academicYearId: ay.id } } },
        ...(q.userId ? { userId: q.userId } : {}),
      },
      include: { user: true, session: true },
      orderBy: { startedAt: 'desc' },
      take: 2000,
    }),
    prisma.userAyRole.findMany({ where: { academicYearId: ay.id }, include: { designation: true } }),
  ]);
  const roleOf = new Map(
    memberships.map((m) => [m.userId, m.role === 'adviser' ? 'Adviser' : m.status === 'active' ? (m.designation?.name ?? 'Member') : 'No access yet']),
  );

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
      role: roleOf.get(v.userId) ?? '',
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
