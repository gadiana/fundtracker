import { Router, type Request } from 'express';
import { COPY_OPTIONS, copyOptionIssues, createAySchema, formatPersonName, setupAySchema, type CopyOptions } from '@sft/shared';
import { prisma } from '../../db';
import { actorFrom, writeAudit, type Actor } from '../../lib/audit';
import { COUNTER_KEYS } from '../../lib/defaults';
import { badRequest, conflict, forbidden, notFound, uuidParam } from '../../lib/http';
import { applyBranding } from '../../lib/branding';
import { getCurrentAy, invalidateSecurityCache } from '../../lib/settings';
import { requireAuth } from '../../middleware/auth';
import { ayContext, ctxOf, requireAdviser, requireOpenAy } from '../../middleware/ay';
import { buildMe } from '../auth/me';
import { joinAcademicYear, notifyAdviserOfPending } from '../members/service';
import { authorizeSetup, isActiveAdviser, previewSetup, runSetup } from './setup';

export const aysRouter = Router();
aysRouter.use(requireAuth);

const adviserActor = (req: Request): Actor => ({ ...actorFrom(req.user!), role: 'adviser', designation: 'Adviser' });

async function loadAy(id: unknown) {
  const ay = await prisma.academicYear.findUnique({ where: { id: uuidParam(id) } });
  if (!ay) throw notFound('Academic year not found.');
  return ay;
}

// ───────────── list & create (adviser of the selected AY) ─────────────

aysRouter.get('/', ayContext, requireAdviser, async (req, res) => {
  const userId = req.user!.id;
  const [ays, counts, advisers, mine, copyRuns] = await Promise.all([
    prisma.academicYear.findMany({ orderBy: { startYear: 'desc' }, include: { settings: { select: { orgName: true } } } }),
    prisma.userAyRole.groupBy({ by: ['academicYearId', 'status'], _count: { _all: true } }),
    prisma.userAyRole.findMany({ where: { role: 'adviser', status: 'active' }, include: { user: true } }),
    prisma.userAyRole.findMany({ where: { userId } }),
    prisma.ayCopyRun.findMany({ orderBy: { executedAt: 'desc' }, include: { sourceAcademicYear: { select: { label: true } } } }),
  ]);
  const count = (ayId: string, status: string) =>
    counts.find((c) => c.academicYearId === ayId && c.status === status)?._count._all ?? 0;

  res.json({
    items: ays.map((ay) => {
      const adviser = advisers.find((a) => a.academicYearId === ay.id);
      const me = mine.find((m) => m.academicYearId === ay.id);
      const copy = copyRuns.find((c) => c.targetAcademicYearId === ay.id);
      return {
        id: ay.id,
        label: ay.label,
        status: ay.status,
        isCurrent: ay.isCurrent,
        needsSetup: !ay.settings,
        orgName: ay.settings?.orgName ?? null,
        adviserName: adviser ? formatPersonName(adviser.user) : null,
        activeMembers: count(ay.id, 'active'),
        pendingMembers: count(ay.id, 'pending'),
        createdAt: ay.createdAt,
        closedAt: ay.closedAt,
        closedByName: ay.closedByName,
        copiedFrom: copy ? { label: copy.sourceAcademicYear.label, at: copy.executedAt, by: copy.executedByName } : null,
        iAmAdviser: me?.role === 'adviser' && me.status === 'active',
      };
    }),
  });
});

aysRouter.post('/', ayContext, requireAdviser, async (req, res) => {
  const { startYear } = createAySchema.parse(req.body);
  const { ay: selected, actor } = ctxOf(req);
  const label = `${startYear}-${startYear + 1}`;
  if (await prisma.academicYear.findUnique({ where: { startYear } })) throw conflict('DUPLICATE', `AY ${label} already exists.`);

  const ay = await prisma.$transaction(async (tx) => {
    const ay = await tx.academicYear.create({ data: { startYear, endYear: startYear + 1, label, createdById: actor.id } });
    await tx.ayCounter.createMany({ data: COUNTER_KEYS.map((counterKey) => ({ academicYearId: ay.id, counterKey })) });
    await writeAudit(tx, {
      ayId: selected.id,
      actor,
      action: 'create',
      entityType: 'academic_year',
      entityId: ay.id,
      after: { label },
      req,
    });
    return ay;
  });
  res.status(201).json({ id: ay.id, label: ay.label, me: await buildMe(req.user!.id) });
});

// ───────────── current / close / reopen ─────────────

/** The current AY is where new signups go. Its adviser (or the target's adviser) can move it. */
aysRouter.post('/:id/make-current', async (req, res) => {
  const target = await loadAy(req.params.id);
  const current = await getCurrentAy();
  const userId = req.user!.id;
  const allowed = (current && (await isActiveAdviser(userId, current.id))) || (await isActiveAdviser(userId, target.id));
  if (!allowed) throw forbidden('Only the adviser of the current or the chosen academic year can do this.');
  if (target.status === 'closed') throw conflict('AY_CLOSED', `AY ${target.label} is closed. Reopen it first.`);
  if (target.isCurrent) {
    res.json({ me: await buildMe(userId) });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.academicYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
    await tx.academicYear.update({ where: { id: target.id }, data: { isCurrent: true } });
    await writeAudit(tx, {
      ayId: target.id,
      actor: adviserActor(req),
      action: 'update',
      entityType: 'academic_year',
      entityId: target.id,
      before: { currentAy: current?.label ?? null },
      after: { currentAy: target.label },
      req,
    });
  });
  invalidateSecurityCache();
  res.json({ me: await buildMe(userId) });
});

aysRouter.post('/:id/close', async (req, res) => {
  const target = await loadAy(req.params.id);
  if (!(await isActiveAdviser(req.user!.id, target.id))) throw forbidden(`Only the adviser of AY ${target.label} can close it.`);
  if (target.status === 'closed') throw conflict('ALREADY_CLOSED', `AY ${target.label} is already closed.`);
  if (target.isCurrent) {
    throw conflict('IS_CURRENT', `AY ${target.label} is the current academic year. Make another year current before closing it.`);
  }
  const actor = adviserActor(req);
  await prisma.$transaction(async (tx) => {
    await tx.academicYear.update({
      where: { id: target.id },
      data: { status: 'closed', closedAt: new Date(), closedById: actor.id, closedByName: actor.name },
    });
    await writeAudit(tx, {
      ayId: target.id,
      actor,
      action: 'update',
      entityType: 'academic_year',
      entityId: target.id,
      before: { status: 'open' },
      after: { status: 'closed' },
      req,
    });
  });
  res.json({ me: await buildMe(req.user!.id) });
});

aysRouter.post('/:id/reopen', async (req, res) => {
  const target = await loadAy(req.params.id);
  if (!(await isActiveAdviser(req.user!.id, target.id))) throw forbidden(`Only the adviser of AY ${target.label} can reopen it.`);
  if (target.status === 'open') throw conflict('ALREADY_OPEN', `AY ${target.label} is already open.`);
  const actor = adviserActor(req);
  await prisma.$transaction(async (tx) => {
    await tx.academicYear.update({
      where: { id: target.id },
      data: { status: 'open', closedAt: null, closedById: null, closedByName: null },
    });
    await writeAudit(tx, {
      ayId: target.id,
      actor,
      action: 'update',
      entityType: 'academic_year',
      entityId: target.id,
      before: { status: 'closed', closedByName: target.closedByName },
      after: { status: 'open' },
      req,
    });
  });
  res.json({ me: await buildMe(req.user!.id) });
});

// ───────────── setup & Copy Wizard ─────────────

function optionsFromQuery(query: Request['query']): CopyOptions {
  const options = Object.fromEntries(COPY_OPTIONS.map((o) => [o, query[o] === '1' || query[o] === 'true'])) as CopyOptions;
  const issues = copyOptionIssues(options);
  if (issues.length) throw badRequest('BAD_OPTIONS', issues[0]!, { issues });
  return options;
}

aysRouter.get('/:id/setup-preview', async (req, res) => {
  const target = await loadAy(req.params.id);
  const sourceAyId = typeof req.query.sourceAyId === 'string' && req.query.sourceAyId ? uuidParam(req.query.sourceAyId) : undefined;
  const options = optionsFromQuery(req.query);
  const source = await authorizeSetup(req.user!.id, target, sourceAyId);
  res.json(await previewSetup(target, source, options));
});

aysRouter.post('/:id/setup', async (req, res) => {
  const target = await loadAy(req.params.id);
  const body = setupAySchema.parse(req.body);
  const source = await authorizeSetup(req.user!.id, target, body.sourceAyId);
  const summary = await runSetup({ target, source, options: body.options, actor: adviserActor(req), req });
  // the organization's name and logos always come from src/branding.ts
  await applyBranding(target.id);
  res.json({ summary, me: await buildMe(req.user!.id) });
});

// ───────────── access requests ─────────────

/**
 * An existing account asks to join the selected AY (sent as X-AY-Id).
 * Like signup, they wait as "pending" for an adviser.
 */
aysRouter.post('/request-access', ayContext, requireOpenAy, async (req, res) => {
  const { ay, membership } = ctxOf(req);
  const user = req.user!;
  if (membership?.status === 'active') throw conflict('ALREADY_MEMBER', 'You already have access to this academic year.');
  if (membership?.status === 'pending') throw conflict('ALREADY_PENDING', 'Your request is already waiting for approval.');
  if (membership?.status === 'deactivated') {
    throw forbidden('Your access to this academic year was deactivated. Contact the adviser.', 'DEACTIVATED');
  }

  const joined = await prisma.$transaction(async (tx) => {
    const joined = await joinAcademicYear(tx, user.id, ay.id);
    await writeAudit(tx, {
      ayId: ay.id,
      actor: { id: user.id, name: formatPersonName(user) },
      action: 'request_access',
      entityType: 'user_ay_role',
      entityId: joined.id,
      before: membership ? { status: membership.status } : undefined,
      after: { role: joined.role, status: joined.status },
      req,
    });
    return joined;
  });
  if (joined.status === 'pending') await notifyAdviserOfPending(ay.id, user, joined.id);

  res.json({ status: joined.status, role: joined.role, me: await buildMe(user.id) });
});
