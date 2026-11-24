import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { requireAuth } from '../../middleware/auth';
import { ayContext, ctxOf, requireAdviser } from '../../middleware/ay';
import { ACTIVITY_WHERE, describeActivity } from './describe';

/**
 * The adviser's activity log for the selected AY: who changed which student or staff record,
 * in plain words. The full audit log (every action, raw data, IP addresses) is under /api/admin.
 */
export const auditRouter = Router();
auditRouter.use(requireAuth, ayContext, requireAdviser);

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  kind: z.enum(['student', 'staff']).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

auditRouter.get('/', async (req, res) => {
  const { ay } = ctxOf(req);
  const query = querySchema.parse(req.query);
  const where: Prisma.AuditLogWhereInput = {
    AND: [
      ACTIVITY_WHERE(ay.id, query.kind),
      ...(query.q ? [{ actorName: { contains: query.q, mode: 'insensitive' as const } }] : []),
      ...(query.from || query.to ? [{ createdAt: { gte: query.from, lte: query.to } }] : []),
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
  ]);
  res.json({ total, page: query.page, pageSize: query.pageSize, items: await describeActivity(rows) });
});
