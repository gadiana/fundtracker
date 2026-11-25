import { Router, type Request } from 'express';
import {
  REPORT_KINDS,
  clearanceFilterSchema,
  collectionFilterSchema,
  fundReportSchema,
  liquidationReportSchema,
  pageSchema,
  studentStatementSchema,
  usageFilterSchema,
} from '@sft/shared';
import { z } from 'zod';
import { prisma } from '../../db';
import { visibleFundsWhere } from '../../lib/confidential';
import { conflict, forbidden, notFound } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { ayContext, ctxOf, requireMember, requirePermission } from '../../middleware/ay';
import { clearanceReport, collectionReport, fundReport, liquidationReport, studentStatement, usageReport, type ReportContext } from './docs';
import { collectionRows, collectionTotals, collectionWhere, usageRows, usageScope, usageTotals, usageWhere } from './queries';

async function reportContext(req: Request): Promise<ReportContext> {
  const { ay, perms, actor } = ctxOf(req);
  const settings = await prisma.aySetting.findUnique({ where: { academicYearId: ay.id } });
  if (!settings) throw conflict('NEEDS_SETUP', `AY ${ay.label} hasn't been set up yet.`);
  return { ay, settings, perms, actor, userId: req.user!.id };
}

// ───────────────────────────── transaction histories ─────────────────────────────

/** Collection history and use-of-fund history, a page at a time. */
export const historyRouter = Router();
historyRouter.use(requireAuth, ayContext, requireMember);

/** Choices for the history filters. */
historyRouter.get('/options', async (req, res) => {
  const { ay, perms } = ctxOf(req);
  const canCollect = perms.includes('collect');
  let canSeeUsage = true;
  try {
    await usageScope(ay.id, req.user!.id, perms);
  } catch {
    canSeeUsage = false;
  }
  const [programs, sections, staff, funds, settings] = await Promise.all([
    prisma.program.findMany({ where: { academicYearId: ay.id }, orderBy: { code: 'asc' } }),
    prisma.section.findMany({ where: { academicYearId: ay.id }, orderBy: [{ yearLevel: 'asc' }, { name: 'asc' }] }),
    canCollect
      ? prisma.$queryRaw<{ id: string; name: string }[]>`
          SELECT DISTINCT p.processed_by AS id, p.processed_by_name AS name FROM payments p
          WHERE p.academic_year_id = ${ay.id}::uuid ORDER BY name`
      : [],
    prisma.fund.findMany({ where: { academicYearId: ay.id, ...visibleFundsWhere(perms) }, orderBy: { priority: 'asc' } }),
    prisma.aySetting.findUnique({ where: { academicYearId: ay.id } }),
  ]);
  res.json({
    canSeeCollections: canCollect,
    canSeeUsage,
    yearLevelCount: settings?.yearLevelCount ?? 4,
    programs: programs.map((p) => ({ id: p.id, code: p.code })),
    sections: sections.map((s) => ({ id: s.id, name: s.name, programId: s.programId, yearLevel: s.yearLevel })),
    staff,
    funds: funds.map((f) => ({ id: f.id, name: f.name })),
  });
});

historyRouter.get('/collections', requirePermission('collect'), async (req, res) => {
  const f = collectionFilterSchema.parse(req.query);
  const { page, pageSize } = pageSchema.parse(req.query);
  const { ay } = ctxOf(req);
  const settings = await prisma.aySetting.findUnique({ where: { academicYearId: ay.id } });
  const where = collectionWhere(ay.id, f, settings?.timezone ?? 'Asia/Manila');
  const [totals, items] = await Promise.all([collectionTotals(where), collectionRows(where, { limit: pageSize, offset: (page - 1) * pageSize })]);
  res.json({ total: totals.count, page, pageSize, totals, items });
});

historyRouter.get('/fund-usage', async (req, res) => {
  const f = usageFilterSchema.parse(req.query);
  const { page, pageSize } = pageSchema.parse(req.query);
  const { ay, perms } = ctxOf(req);
  const scope = await usageScope(ay.id, req.user!.id, perms);
  const settings = await prisma.aySetting.findUnique({ where: { academicYearId: ay.id } });
  const where = usageWhere(ay.id, f, settings?.timezone ?? 'Asia/Manila', perms, scope, req.user!.id);
  const [totals, items] = await Promise.all([usageTotals(where), usageRows(where, { limit: pageSize, offset: (page - 1) * pageSize })]);
  res.json({ total: totals.count, page, pageSize, totals, items, ownOnly: !scope.all });
});

// ───────────────────────────── printable reports ─────────────────────────────

/** Every report as one printable document (see ReportDoc in @sft/shared). */
export const reportsRouter = Router();
reportsRouter.use(requireAuth, ayContext, requireMember);

reportsRouter.get('/:kind', async (req, res) => {
  const kind = z.enum(REPORT_KINDS).safeParse(req.params.kind);
  if (!kind.success) throw notFound('Unknown report.');
  const ctx = await reportContext(req);
  const collector = ctx.perms.includes('collect');
  switch (kind.data) {
    case 'collections':
      if (!collector) throw forbidden();
      return res.json(await collectionReport(ctx, collectionFilterSchema.parse(req.query)));
    case 'fund-usage':
      return res.json(await usageReport(ctx, usageFilterSchema.parse(req.query), await usageScope(ctx.ay.id, ctx.userId, ctx.perms)));
    case 'fund':
      if (!collector) throw forbidden();
      return res.json(await fundReport(ctx, fundReportSchema.parse(req.query)));
    case 'student-statement':
      if (!collector) throw forbidden();
      return res.json(await studentStatement(ctx, studentStatementSchema.parse(req.query).studentId));
    case 'clearance':
      if (!collector) throw forbidden();
      return res.json(await clearanceReport(ctx, clearanceFilterSchema.parse(req.query)));
    case 'liquidation':
      // anyone who may open the request (requestor, approvers, adviser)
      return res.json(await liquidationReport(ctx, liquidationReportSchema.parse(req.query).requestId));
  }
});

