import { Router } from 'express';
import type { EnrollmentLink } from '@prisma/client';
import { enrollmentLinkSchema, formatPersonName, selfEnrollSchema, studentNameKeys } from '@sft/shared';
import { rateLimit } from 'express-rate-limit';
import { isTest } from '../../config';
import { prisma } from '../../db';
import { writeAudit } from '../../lib/audit';
import { randomToken } from '../../lib/crypto';
import { conflict, HttpError, notFound, uuidParam } from '../../lib/http';
import { sendEvent } from '../../lib/events';
import { collectorRecipients } from '../../lib/notify';
import { requireAuth } from '../../middleware/auth';
import { ayContext, ctxOf, requireOpenAy, requirePermission } from '../../middleware/ay';
import { logoUrl } from '../settings/service';
import { validatePlacement } from './service';

function linkProblem(link: EnrollmentLink | null, ayStatus?: string): string | null {
  if (!link || !link.isActive) return 'This enrollment link is no longer active. Ask an officer for a new one.';
  if (link.expiresAt && link.expiresAt < new Date()) return 'This enrollment link has expired. Ask an officer for a new one.';
  if (link.maxUses && link.useCount >= link.maxUses) return 'This enrollment link has reached its limit. Ask an officer for a new one.';
  if (ayStatus === 'closed') return 'Enrollment for this academic year is closed.';
  return null;
}

const serializeLink = (l: EnrollmentLink & { _count?: { students: number } }, pending?: number) => ({
  id: l.id,
  token: l.token,
  path: `/enroll/${l.token}`,
  label: l.label,
  expiresAt: l.expiresAt,
  maxUses: l.maxUses,
  useCount: l.useCount,
  isActive: l.isActive,
  usable: linkProblem(l) === null,
  createdByName: l.createdByName,
  createdAt: l.createdAt,
  revokedAt: l.revokedAt,
  revokedByName: l.revokedByName,
  pending: pending ?? 0,
});

// ───────────── staff: manage links ─────────────

export const enrollmentLinksRouter = Router();
enrollmentLinksRouter.use(requireAuth, ayContext, requirePermission('collect'));

enrollmentLinksRouter.get('/', async (req, res) => {
  const { db } = ctxOf(req);
  const [links, pending] = await Promise.all([
    db.enrollmentLink.findMany({ orderBy: { createdAt: 'desc' } }),
    db.student.groupBy({ by: ['enrollmentLinkId'], where: { status: 'pending' }, _count: { _all: true } }),
  ]);
  const pendingBy = new Map(pending.map((p) => [p.enrollmentLinkId, p._count._all]));
  res.json({ items: links.map((l) => serializeLink(l, pendingBy.get(l.id))) });
});

enrollmentLinksRouter.post('/', requireOpenAy, async (req, res) => {
  const body = enrollmentLinkSchema.parse(req.body);
  const { db, ay, actor } = ctxOf(req);
  const link = await db.$transaction(async (tx) => {
    const link = await tx.enrollmentLink.create({
      data: {
        academicYearId: ay.id,
        token: randomToken(),
        label: body.label ?? null,
        expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
        maxUses: body.maxUses ?? null,
        createdById: actor.id!,
        createdByName: actor.name,
      },
    });
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'create',
      entityType: 'enrollment_link',
      entityId: link.id,
      after: { label: link.label, expiresAt: link.expiresAt, maxUses: link.maxUses },
      req,
    });
    return link;
  });
  res.status(201).json(serializeLink(link));
});

enrollmentLinksRouter.post('/:id/revoke', requireOpenAy, async (req, res) => {
  const { db, ay, actor } = ctxOf(req);
  const link = await db.enrollmentLink.findUnique({ where: { id: uuidParam(req.params.id) } });
  if (!link) throw notFound('Link not found.');
  if (!link.isActive) throw conflict('ALREADY_REVOKED', 'This link is already turned off.');
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.enrollmentLink.update({
      where: { id: link.id },
      data: { isActive: false, revokedAt: new Date(), revokedByName: actor.name },
    });
    await writeAudit(tx, { ayId: ay.id, actor, action: 'deactivate', entityType: 'enrollment_link', entityId: link.id, req });
    return updated;
  });
  res.json(serializeLink(updated));
});

// ───────────── public: the self-enrollment form ─────────────

const enrollLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
  handler: (_req, res) => {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many submissions from this device. Please try again later.' } });
  },
});

export const publicEnrollRouter = Router();

async function loadPublicLink(raw: unknown) {
  const token = String(raw ?? '');
  if (!/^[\w-]{20,64}$/.test(token)) throw notFound('Enrollment link not found.');
  const link = await prisma.enrollmentLink.findUnique({ where: { token }, include: { academicYear: true } });
  if (!link) throw notFound('Enrollment link not found.');
  return link;
}

publicEnrollRouter.get('/:token', async (req, res) => {
  const link = await loadPublicLink(req.params.token);
  const problem = linkProblem(link, link.academicYear.status);
  if (problem) throw new HttpError(410, 'LINK_UNAVAILABLE', problem);
  const ayId = link.academicYearId;
  const [settings, programs, sections] = await Promise.all([
    prisma.aySetting.findUnique({ where: { academicYearId: ayId } }),
    prisma.program.findMany({ where: { academicYearId: ayId, isActive: true }, orderBy: { code: 'asc' } }),
    prisma.section.findMany({ where: { academicYearId: ayId, isActive: true }, orderBy: [{ yearLevel: 'asc' }, { name: 'asc' }] }),
  ]);
  res.json({
    academicYear: link.academicYear.label,
    org: {
      name: settings?.orgName ?? '',
      school: settings?.schoolName ?? '',
      college: settings?.collegeName ?? '',
      logoUrl: settings?.logoFileId ? logoUrl(ayId, 'org', settings.logoFileId) : null,
    },
    label: link.label,
    yearLevelCount: settings?.yearLevelCount ?? 4,
    programs: programs.map((p) => ({ id: p.id, code: p.code, name: p.name })),
    sections: sections.map((s) => ({ id: s.id, name: s.name, programId: s.programId, yearLevel: s.yearLevel })),
    privacyConsentText: settings?.privacyConsentText ?? '',
  });
});

/** Creates a PENDING student. Staff must approve it before it counts as enrolled. */
publicEnrollRouter.post('/:token', enrollLimiter, async (req, res) => {
  const body = selfEnrollSchema.parse(req.body);
  const link = await loadPublicLink(req.params.token);
  const ayId = link.academicYearId;
  await validatePlacement(prisma, ayId, body);

  const student = await prisma.$transaction(async (tx) => {
    // lock the link so its use limit holds under simultaneous submissions
    await tx.$queryRaw`SELECT id FROM enrollment_links WHERE id = ${link.id}::uuid FOR UPDATE`;
    const fresh = await tx.enrollmentLink.findUniqueOrThrow({ where: { id: link.id }, include: { academicYear: true } });
    const problem = linkProblem(fresh, fresh.academicYear.status);
    if (problem) throw new HttpError(410, 'LINK_UNAVAILABLE', problem);

    if (await tx.student.findFirst({ where: { academicYearId: ayId, studentNumber: body.studentNumber, status: { not: 'rejected' } } })) {
      throw conflict(
        'ALREADY_REGISTERED',
        'This student number is already registered for this academic year. If something is wrong, contact an officer.',
      );
    }
    const settings = await tx.aySetting.findUnique({ where: { academicYearId: ayId } });
    const created = await tx.student.create({
      data: {
        academicYearId: ayId,
        studentNumber: body.studentNumber,
        firstName: body.firstName,
        middleName: body.middleName ?? null,
        lastName: body.lastName,
        suffix: body.suffix ?? null,
        ...studentNameKeys(body),
        programId: body.programId,
        yearLevel: body.yearLevel,
        sectionId: body.sectionId ?? null,
        email: body.email ?? null,
        contactNo: body.contactNo ?? null,
        status: 'pending',
        source: 'self_enroll',
        enrollmentLinkId: link.id,
        consentGivenAt: new Date(),
        consentVersion: settings?.privacyConsentVersion ?? '1',
      },
    });
    await tx.enrollmentLink.update({ where: { id: link.id }, data: { useCount: { increment: 1 } } });
    await writeAudit(tx, {
      ayId,
      actor: { id: null, name: `${formatPersonName(created)} (self-enrollment)` },
      action: 'create',
      entityType: 'student',
      entityId: created.id,
      after: { studentNumber: created.studentNumber, name: formatPersonName(created), status: 'pending', source: 'self_enroll', link: link.label },
      req,
    });
    return created;
  });

  await sendEvent('student.self_enrolled', {
    ayId,
    to: await collectorRecipients(ayId),
    vars: { studentName: formatPersonName(student), studentNumber: student.studentNumber },
    linkPath: `/students/${student.id}`,
    entityType: 'student',
    entityId: student.id,
  });
  res.status(201).json({ ok: true, name: formatPersonName(student), studentNumber: student.studentNumber });
});
