import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { requireAuth } from '../../middleware/auth';
import { ayContext, ctxOf, requireAdviser } from '../../middleware/ay';

/** Audit log of the selected AY. Adviser only. */
export const auditRouter = Router();
auditRouter.use(requireAuth, ayContext, requireAdviser);

const querySchema = z.object({
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
  const query = querySchema.parse(req.query);
  const where: Prisma.AuditLogWhereInput = {
    academicYearId: ay.id,
    ...(query.action ? { action: query.action } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.q ? { actorName: { contains: query.q, mode: 'insensitive' } } : {}),
    ...(query.from || query.to ? { createdAt: { gte: query.from, lte: query.to } } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  res.json({
    total,
    page: query.page,
    pageSize: query.pageSize,
    items: rows.map((r) => ({
      id: r.id.toString(),
      createdAt: r.createdAt,
      actorName: r.actorName,
      actorDesignation: r.actorDesignation,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.beforeData,
      after: r.afterData,
      ipAddress: r.ipAddress,
    })),
  });
});

auditRouter.get('/filters', async (req, res) => {
  const { ay } = ctxOf(req);
  const [actions, entityTypes] = await Promise.all([
    prisma.auditLog.findMany({ where: { academicYearId: ay.id }, distinct: ['action'], select: { action: true } }),
    prisma.auditLog.findMany({ where: { academicYearId: ay.id }, distinct: ['entityType'], select: { entityType: true } }),
  ]);
  res.json({
    actions: actions.map((a) => a.action).sort(),
    entityTypes: entityTypes.map((e) => e.entityType).sort(),
  });
});
