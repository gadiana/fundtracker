import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { uuidParam } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { ayContext, ctxOf } from '../../middleware/ay';

/** The signed-in user's notifications for the selected AY (plus account-wide ones). */
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth, ayContext);

function whereFor(userId: string, ayId: string): Prisma.NotificationWhereInput {
  return { userId, OR: [{ academicYearId: ayId }, { academicYearId: null }] };
}

const listQuery = z.object({
  filter: z.enum(['all', 'unread']).default('all'),
  /** the `nextCursor` of the previous page: "<createdAt>_<id>" */
  before: z
    .string()
    .regex(/^[\dT:.\-Z+]+_[0-9a-f-]{36}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** Newest first, a page at a time. Notices sent together share a time, so the id breaks ties. */
notificationsRouter.get('/', async (req, res) => {
  const { ay } = ctxOf(req);
  const q = listQuery.parse(req.query);
  const [at, id] = q.before ? (q.before.split('_') as [string, string]) : [];
  const where: Prisma.NotificationWhereInput = {
    AND: [
      whereFor(req.user!.id, ay.id),
      q.filter === 'unread' ? { readAt: null } : {},
      at && id ? { OR: [{ createdAt: { lt: new Date(at) } }, { createdAt: new Date(at), id: { lt: id } }] } : {},
    ],
  };
  const rows = await prisma.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1 });
  const items = rows.slice(0, q.limit);
  const last = items.at(-1);
  res.json({ items, nextCursor: rows.length > q.limit && last ? `${last.createdAt.toISOString()}_${last.id}` : null });
});

notificationsRouter.get('/unread-count', async (req, res) => {
  const { ay } = ctxOf(req);
  const count = await prisma.notification.count({ where: { ...whereFor(req.user!.id, ay.id), readAt: null } });
  res.json({ count });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  await prisma.notification.updateMany({
    where: { id: uuidParam(req.params.id), userId: req.user!.id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ ok: true });
});

notificationsRouter.post('/:id/unread', async (req, res) => {
  await prisma.notification.updateMany({ where: { id: uuidParam(req.params.id), userId: req.user!.id }, data: { readAt: null } });
  res.json({ ok: true });
});

notificationsRouter.post('/read-all', async (req, res) => {
  const { ay } = ctxOf(req);
  await prisma.notification.updateMany({
    where: { ...whereFor(req.user!.id, ay.id), readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ ok: true });
});
