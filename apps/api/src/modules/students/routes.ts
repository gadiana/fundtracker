import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  confirmProfileSchema,
  normalizeNamePart,
  studentCreateSchema,
  studentDeactivateSchema,
  studentDecisionSchema,
  studentNameKeys,
  studentRejectSchema,
  studentUpdateSchema,
} from '@sft/shared';
import { prisma } from '../../db';
import { writeAudit } from '../../lib/audit';
import { conflict, notFound, uuidParam } from '../../lib/http';
import { syncCharges } from '../funds/charges';
import { requireAuth } from '../../middleware/auth';
import { ayContext, ctxOf, requireOpenAy, requirePermission } from '../../middleware/ay';
import { canSeeConfidential } from '../../lib/confidential';
import {
  clearanceFor,
  duplicateFlags,
  findDuplicates,
  newQrToken,
  resolveDuplicates,
  serializeStudent,
  studentInclude,
  studentCharges,
  studentSnapshot,
  validatePlacement,
} from './service';

/** Student records of the selected AY: collectors and the adviser. */
export const studentsRouter = Router();
studentsRouter.use(requireAuth, ayContext, requirePermission('collect'));

const canOverride = (req: Request) => ctxOf(req).perms.includes('manage');

async function loadStudent(req: Request) {
  const student = await ctxOf(req).db.student.findUnique({ where: { id: uuidParam(req.params.id) }, include: studentInclude });
  if (!student) throw notFound('Student not found in this academic year.');
  return student;
}

async function auditStudent(req: Request, tx: Parameters<typeof writeAudit>[0], action: Parameters<typeof writeAudit>[1]['action'], id: string, before?: unknown, after?: unknown) {
  const { ay, actor } = ctxOf(req);
  await writeAudit(tx, { ayId: ay.id, actor, action, entityType: 'student', entityId: id, before, after, req });
}

// ───────────────────────────── list & lookups ─────────────────────────────

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'pending', 'inactive', 'rejected']).optional(),
  programId: z.string().uuid().optional(),
  yearLevel: z.coerce.number().int().min(1).max(10).optional(),
  sectionId: z.string().uuid().optional(),
  flag: z.enum(['needs_confirmation', 'duplicates']).optional(),
  sort: z.enum(['name', 'name_desc', 'number', 'number_desc']).default('name'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** By name (last, first) or by student number, either way round. */
function studentOrder(sort: z.infer<typeof listQuery>['sort']): Prisma.StudentOrderByWithRelationInput[] {
  const dir = sort.endsWith('_desc') ? 'desc' : 'asc';
  return sort.startsWith('number')
    ? [{ studentNumber: dir }]
    : [{ lastName: dir }, { firstName: dir }, { middleName: dir }, { studentNumber: 'asc' }];
}

studentsRouter.get('/', async (req, res) => {
  const { db, ay } = ctxOf(req);
  const q = listQuery.parse(req.query);

  const where: Prisma.StudentWhereInput = {
    // the duplicates view covers every live record; otherwise the default is active students
    status: q.status ?? (q.flag === 'duplicates' ? { in: ['active', 'pending', 'inactive'] } : 'active'),
    ...(q.programId ? { programId: q.programId } : {}),
    ...(q.yearLevel ? { yearLevel: q.yearLevel } : {}),
    ...(q.sectionId ? { sectionId: q.sectionId } : {}),
    ...(q.flag === 'needs_confirmation' ? { needsProfileConfirmation: true } : {}),
  };
  if (q.q) {
    const key = normalizeNamePart(q.q);
    where.OR = [
      { studentNumber: { contains: q.q.replace(/\s+/g, ''), mode: 'insensitive' } },
      { firstName: { contains: q.q, mode: 'insensitive' } },
      { lastName: { contains: q.q, mode: 'insensitive' } },
      ...(key ? [{ nameKey: { contains: key } }] : []),
    ];
  }
  if (q.flag === 'duplicates') {
    const groups = await duplicateGroups(ay.id);
    where.id = { in: groups.flatMap((g) => g.students.map((s) => s.id)) };
  }

  const [total, rows] = await Promise.all([
    db.student.count({ where }),
    db.student.findMany({
      where,
      include: studentInclude,
      orderBy: studentOrder(q.sort),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  const [flags, clearance] = await Promise.all([duplicateFlags(ay.id, rows), clearanceFor(ay.id, rows.map((s) => s.id))]);
  res.json({
    total,
    page: q.page,
    pageSize: q.pageSize,
    items: rows.map((s) => ({ ...serializeStudent(s, flags.get(s.id)), clearance: clearance.get(s.id) ?? null })),
  });
});

/** Choices for the student forms: active programs and sections, year levels, and override rights. */
studentsRouter.get('/meta', async (req, res) => {
  const { db, ay, perms } = ctxOf(req);
  const [programs, sections, settings] = await Promise.all([
    db.program.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    db.section.findMany({ where: { isActive: true }, orderBy: [{ yearLevel: 'asc' }, { name: 'asc' }] }),
    db.aySetting.findUnique({ where: { academicYearId: ay.id } }),
  ]);
  res.json({
    programs: programs.map((p) => ({ id: p.id, code: p.code, name: p.name })),
    // each section belongs to one program and year level; the forms show only the matching ones
    sections: sections.map((s) => ({ id: s.id, name: s.name, programId: s.programId, yearLevel: s.yearLevel })),
    yearLevelCount: settings?.yearLevelCount ?? 4,
    canOverrideDuplicates: perms.includes('manage'),
  });
});

studentsRouter.get('/summary', async (req, res) => {
  const { db, ay } = ctxOf(req);
  const [byStatus, needsConfirmation, groups] = await Promise.all([
    db.student.groupBy({ by: ['status'], _count: { _all: true } }),
    db.student.count({ where: { needsProfileConfirmation: true, status: 'active' } }),
    duplicateGroups(ay.id),
  ]);
  const count = (s: string) => byStatus.find((g) => g.status === s)?._count._all ?? 0;
  res.json({
    active: count('active'),
    pending: count('pending'),
    inactive: count('inactive'),
    rejected: count('rejected'),
    needsConfirmation,
    duplicateGroups: groups.length,
  });
});

/** Groups of students in this AY that share a name but have different student numbers. */
async function duplicateGroups(academicYearId: string) {
  const students = await prisma.student.findMany({
    where: { academicYearId, status: { not: 'rejected' } },
    include: studentInclude,
    orderBy: { studentNumber: 'asc' },
  });
  const byExact = new Map<string, typeof students>();
  const byLoose = new Map<string, typeof students>();
  for (const s of students) {
    byExact.set(s.nameKey, [...(byExact.get(s.nameKey) ?? []), s]);
    byLoose.set(s.nameKeyLoose, [...(byLoose.get(s.nameKeyLoose) ?? []), s]);
  }
  const groups: { level: 'exact' | 'similar'; key: string; students: ReturnType<typeof serializeStudent>[] }[] = [];
  const covered = new Set<string>();
  for (const [key, list] of byExact) {
    if (list.length < 2) continue;
    list.forEach((s) => covered.add(s.id));
    groups.push({ level: 'exact', key, students: list.map((s) => serializeStudent(s, 'exact')) });
  }
  for (const [key, list] of byLoose) {
    if (list.length < 2 || list.every((s) => covered.has(s.id))) continue;
    groups.push({ level: 'similar', key, students: list.map((s) => serializeStudent(s, 'similar')) });
  }
  return groups;
}

studentsRouter.get('/duplicates', async (req, res) => {
  res.json({ groups: await duplicateGroups(ctxOf(req).ay.id) });
});

// ───────────────────────────── create ─────────────────────────────

studentsRouter.post('/', requireOpenAy, async (req, res) => {
  const body = studentCreateSchema.parse(req.body);
  const { ay, actor } = ctxOf(req);
  await validatePlacement(prisma, ay.id, body);
  const found = await findDuplicates(prisma, ay.id, body);
  const { overrideReason } = resolveDuplicates(found, body, canOverride(req));

  const student = await prisma.$transaction(async (tx) => {
    const created = await tx.student.create({
      data: {
        academicYearId: ay.id,
        studentNumber: body.studentNumber,
        firstName: body.firstName,
        middleName: body.middleName ?? null,
        lastName: body.lastName,
        suffix: body.suffix ?? null,
        nameKey: found.nameKey,
        nameKeyLoose: found.nameKeyLoose,
        programId: body.programId,
        yearLevel: body.yearLevel,
        sectionId: body.sectionId ?? null,
        email: body.email ?? null,
        contactNo: body.contactNo ?? null,
        status: 'active',
        source: 'manual',
        ...(overrideReason
          ? { duplicateOverride: true, duplicateOverrideById: actor.id, duplicateOverrideByName: actor.name, duplicateOverrideReason: overrideReason }
          : {}),
        approvedAt: new Date(),
        approvedById: actor.id,
        approvedByName: actor.name,
        createdById: actor.id,
        createdByName: actor.name,
      },
      include: studentInclude,
    });
    await newQrToken(tx, ay.id, created.id);
    const charges = await syncCharges(tx, ay.id, { studentIds: [created.id] }, actor);
    await auditStudent(req, tx, 'create', created.id, undefined, {
      ...studentSnapshot(created),
      charges,
      ...(overrideReason ? { duplicateOverrideReason: overrideReason } : {}),
      ...(body.acknowledgeSimilar && found.matches.length ? { similarNameAcknowledged: found.matches.map((m) => m.studentNumber) } : {}),
    });
    return created;
  });
  res.status(201).json(serializeStudent(student));
});

// ───────────────────────────── profile ─────────────────────────────

studentsRouter.get('/:id', async (req, res) => {
  const { db, ay } = ctxOf(req);
  const student = await loadStudent(req);
  const [found, token, history, promotedFrom] = await Promise.all([
    findDuplicates(prisma, ay.id, student, student.id),
    db.studentQrToken.findFirst({ where: { studentId: student.id, isActive: true } }),
    prisma.auditLog.findMany({ where: { academicYearId: ay.id, entityType: 'student', entityId: student.id }, orderBy: { id: 'desc' }, take: 50 }),
    student.promotedFromStudentId
      ? prisma.student.findUnique({ where: { id: student.promotedFromStudentId }, include: { academicYear: true, program: true, section: true } })
      : null,
  ]);
  const [flags, account] = await Promise.all([
    duplicateFlags(ay.id, [student]),
    studentCharges(ay.id, student.id, canSeeConfidential(ctxOf(req).perms)),
  ]);
  res.json({
    student: serializeStudent(student, flags.get(student.id)),
    account,
    duplicates: found.matches,
    qr: token ? { token: token.token, verifyPath: `/verify/${token.token}`, createdAt: token.createdAt } : null,
    promotedFrom: promotedFrom
      ? {
          academicYear: promotedFrom.academicYear.label,
          courseYearSection: `${promotedFrom.program.code} ${promotedFrom.yearLevel}${promotedFrom.section ? `-${promotedFrom.section.name}` : ''}`,
        }
      : null,
    history: history.map((h) => ({
      id: h.id.toString(),
      action: h.action,
      actorName: h.actorName,
      actorDesignation: h.actorDesignation,
      createdAt: h.createdAt,
      before: h.beforeData,
      after: h.afterData,
    })),
  });
});

// ───────────────────────────── edit ─────────────────────────────

studentsRouter.patch('/:id', requireOpenAy, async (req, res) => {
  const body = studentUpdateSchema.parse(req.body);
  const { ay, actor } = ctxOf(req);
  const before = await loadStudent(req);
  if (before.status === 'rejected') throw conflict('REJECTED', 'Rejected enrollments cannot be edited.');

  const next = {
    studentNumber: body.studentNumber ?? before.studentNumber,
    firstName: body.firstName ?? before.firstName,
    middleName: 'middleName' in body ? (body.middleName ?? null) : before.middleName,
    lastName: body.lastName ?? before.lastName,
    suffix: 'suffix' in body ? (body.suffix ?? null) : before.suffix,
    programId: body.programId ?? before.programId,
    yearLevel: body.yearLevel ?? before.yearLevel,
    // a section belongs to one program and year level: moving the student elsewhere without
    // choosing a new section leaves them without one
    sectionId:
      'sectionId' in body
        ? (body.sectionId ?? null)
        : (body.programId ?? before.programId) === before.programId && (body.yearLevel ?? before.yearLevel) === before.yearLevel
          ? before.sectionId
          : null,
    email: 'email' in body ? (body.email ?? null) : before.email,
    contactNo: 'contactNo' in body ? (body.contactNo ?? null) : before.contactNo,
  };
  await validatePlacement(prisma, ay.id, next, before);

  const keys = studentNameKeys(next);
  const identityChanged =
    next.studentNumber !== before.studentNumber || keys.nameKey !== before.nameKey || keys.nameKeyLoose !== before.nameKeyLoose;
  let overrideReason: string | null = null;
  if (identityChanged) {
    overrideReason = resolveDuplicates(await findDuplicates(prisma, ay.id, next, before.id), body, canOverride(req)).overrideReason;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.student.update({
      where: { id: before.id },
      data: {
        ...next,
        ...keys,
        ...(overrideReason
          ? { duplicateOverride: true, duplicateOverrideById: actor.id, duplicateOverrideByName: actor.name, duplicateOverrideReason: overrideReason }
          : {}),
      },
      include: studentInclude,
    });
    // a new program or year level can change which funds apply
    const charges =
      next.programId !== before.programId || next.yearLevel !== before.yearLevel
        ? await syncCharges(tx, ay.id, { studentIds: [before.id] }, actor, 'Student moved to another program or year level')
        : undefined;
    await auditStudent(req, tx, 'update', before.id, studentSnapshot(before), {
      ...studentSnapshot(updated),
      ...(overrideReason ? { duplicateOverrideReason: overrideReason } : {}),
      ...(charges ? { charges } : {}),
    });
    return updated;
  });
  res.json(serializeStudent(updated));
});

/** Promoted students: staff confirm or correct course, year and section before their first payment. */
studentsRouter.post('/:id/confirm-profile', requireOpenAy, async (req, res) => {
  const body = confirmProfileSchema.parse(req.body);
  const { ay, actor } = ctxOf(req);
  const before = await loadStudent(req);
  if (before.status !== 'active') throw conflict('NOT_ACTIVE', 'Only active students can be confirmed.');
  if (!before.needsProfileConfirmation) throw conflict('ALREADY_CONFIRMED', 'This student’s course, year and section are already confirmed.');
  await validatePlacement(prisma, ay.id, body, before);

  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.student.update({
      where: { id: before.id },
      data: {
        programId: body.programId,
        yearLevel: body.yearLevel,
        sectionId: body.sectionId ?? null,
        needsProfileConfirmation: false,
        profileConfirmedAt: new Date(),
        profileConfirmedById: actor.id,
        profileConfirmedByName: actor.name,
      },
      include: studentInclude,
    });
    // charges are created only now, for the confirmed year level and program
    const charges = await syncCharges(tx, ay.id, { studentIds: [before.id] }, actor);
    await auditStudent(req, tx, 'approve', before.id, studentSnapshot(before), { ...studentSnapshot(updated), charges });
    return updated;
  });
  res.json(serializeStudent(updated));
});

// ───────────────────────────── self-enrollment approvals ─────────────────────────────

studentsRouter.post('/:id/approve', requireOpenAy, async (req, res) => {
  const decision = studentDecisionSchema.parse(req.body);
  const { ay, actor } = ctxOf(req);
  const before = await loadStudent(req);
  if (before.status !== 'pending') throw conflict('NOT_PENDING', 'Only pending enrollments can be approved.');
  await validatePlacement(prisma, ay.id, before, before);
  const { overrideReason } = resolveDuplicates(await findDuplicates(prisma, ay.id, before, before.id), decision, canOverride(req));

  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.student.update({
      where: { id: before.id },
      data: {
        status: 'active',
        approvedAt: new Date(),
        approvedById: actor.id,
        approvedByName: actor.name,
        ...(overrideReason
          ? { duplicateOverride: true, duplicateOverrideById: actor.id, duplicateOverrideByName: actor.name, duplicateOverrideReason: overrideReason }
          : {}),
      },
      include: studentInclude,
    });
    await newQrToken(tx, ay.id, before.id);
    const charges = await syncCharges(tx, ay.id, { studentIds: [before.id] }, actor);
    await auditStudent(req, tx, 'approve', before.id, studentSnapshot(before), { ...studentSnapshot(updated), charges });
    return updated;
  });
  res.json(serializeStudent(updated));
});

studentsRouter.post('/:id/reject', requireOpenAy, async (req, res) => {
  const { comment } = studentRejectSchema.parse(req.body);
  const { db, actor } = ctxOf(req);
  const before = await loadStudent(req);
  if (before.status !== 'pending') throw conflict('NOT_PENDING', 'Only pending enrollments can be rejected.');

  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.student.update({
      where: { id: before.id },
      data: { status: 'rejected', rejectedAt: new Date(), rejectedById: actor.id, rejectedByName: actor.name, rejectionComment: comment ?? null },
      include: studentInclude,
    });
    await auditStudent(req, tx, 'reject', before.id, studentSnapshot(before), { ...studentSnapshot(updated), comment: comment ?? null });
    return updated;
  });
  res.json(serializeStudent(updated));
});

// ───────────────────────────── deactivate ─────────────────────────────

/** Students are never deleted; deactivating keeps every record and payment. */
studentsRouter.post('/:id/deactivate', requireOpenAy, async (req, res) => {
  const { reason } = studentDeactivateSchema.parse(req.body);
  const { db } = ctxOf(req);
  const before = await loadStudent(req);
  if (before.status !== 'active') throw conflict('NOT_ACTIVE', 'Only active students can be deactivated.');
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.student.update({ where: { id: before.id }, data: { status: 'inactive' }, include: studentInclude });
    await auditStudent(req, tx, 'deactivate', before.id, studentSnapshot(before), { ...studentSnapshot(updated), reason: reason ?? null });
    return updated;
  });
  res.json(serializeStudent(updated));
});

studentsRouter.post('/:id/reactivate', requireOpenAy, async (req, res) => {
  const { ay, actor } = ctxOf(req);
  const before = await loadStudent(req);
  if (before.status !== 'inactive') throw conflict('NOT_INACTIVE', 'Only deactivated students can be reactivated.');
  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.student.update({ where: { id: before.id }, data: { status: 'active' }, include: studentInclude });
    // funds created while they were deactivated now apply to them too
    const charges = await syncCharges(tx, ay.id, { studentIds: [before.id] }, actor);
    await auditStudent(req, tx, 'reactivate', before.id, studentSnapshot(before), { ...studentSnapshot(updated), charges });
    return updated;
  });
  res.json(serializeStudent(updated));
});


// ───────────────────────────── status QR ─────────────────────────────

/**
 * Replaces the student's status QR token. Old receipts' QR codes stop working,
 * which is the point when a receipt was lost or the link was shared.
 */
studentsRouter.post('/:id/qr/rotate', requireOpenAy, async (req, res) => {
  const { ay, actor } = ctxOf(req);
  const student = await loadStudent(req);
  if (student.status !== 'active') throw conflict('NOT_ACTIVE', 'Only active students have a status QR.');
  const token = await prisma.$transaction(async (tx) => {
    const old = await tx.studentQrToken.findFirst({ where: { studentId: student.id, isActive: true } });
    if (old) {
      await tx.studentQrToken.update({
        where: { id: old.id },
        data: { isActive: false, revokedAt: new Date(), revokedById: actor.id, revokedByName: actor.name, revokeReason: 'Replaced by a new QR code' },
      });
    }
    const token = await newQrToken(tx, ay.id, student.id);
    await auditStudent(req, tx, 'update', student.id, { qr: old ? 'replaced' : 'none' }, { qr: 'new token issued' });
    return token;
  });
  res.json({ token: token.token, verifyPath: `/verify/${token.token}`, createdAt: token.createdAt });
});
