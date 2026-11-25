import type { Prisma, Program, Section, Student } from '@prisma/client';
import { formatPersonName, studentNameKeys, type PersonName } from '@sft/shared';
import { prisma } from '../../db';
import { randomToken } from '../../lib/crypto';
import { badRequest, conflict, HttpError } from '../../lib/http';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export type StudentWithRefs = Student & { program: Program; section: Section | null };
export const studentInclude = { program: true, section: true } as const;

export interface DuplicateMatch {
  id: string;
  studentNumber: string;
  name: string;
  program: string;
  yearLevel: number;
  section: string | null;
  status: Student['status'];
  strength: 'exact' | 'similar';
  overrideReason: string | null;
}

/** Statuses that count as a real record of the student in this AY. */
const LIVE = { not: 'rejected' as const };

/**
 * Looks for the same student number (always blocked) and for the same or a similar
 * name under a different number (a warning that someone has to decide on).
 */
export async function findDuplicates(
  db: Db,
  academicYearId: string,
  input: PersonName & { studentNumber: string },
  excludeId?: string,
) {
  const { nameKey, nameKeyLoose } = studentNameKeys(input);
  const notSelf = excludeId ? { id: { not: excludeId } } : {};
  const [numberTaken, sameName] = await Promise.all([
    db.student.findFirst({ where: { academicYearId, studentNumber: input.studentNumber, status: LIVE, ...notSelf }, include: studentInclude }),
    db.student.findMany({
      where: { academicYearId, status: LIVE, ...notSelf, OR: [{ nameKey }, { nameKeyLoose }] },
      include: studentInclude,
      orderBy: { studentNumber: 'asc' },
      take: 20,
    }),
  ]);
  const matches: DuplicateMatch[] = sameName
    .filter((s) => s.studentNumber !== input.studentNumber)
    .map((s) => ({
      id: s.id,
      studentNumber: s.studentNumber,
      name: formatPersonName(s),
      program: s.program.code,
      yearLevel: s.yearLevel,
      section: s.section?.name ?? null,
      status: s.status,
      strength: s.nameKey === nameKey ? 'exact' : 'similar',
      overrideReason: s.duplicateOverrideReason,
    }));
  return { numberTaken, matches, nameKey, nameKeyLoose };
}

export interface DuplicateDecision {
  acknowledgeSimilar?: boolean;
  duplicateOverrideReason?: string;
}

/**
 * The duplicate rules:
 * - the same student number in this AY is never allowed;
 * - the same full name under another number needs the ADVISER, with a reason;
 * - a similar name (same first + last name) needs staff to confirm it's a different person.
 * Returns the override to record, if any.
 */
export function resolveDuplicates(
  found: Awaited<ReturnType<typeof findDuplicates>>,
  decision: DuplicateDecision,
  canOverride: boolean,
): { overrideReason: string | null } {
  if (found.numberTaken) {
    throw conflict(
      'STUDENT_NUMBER_TAKEN',
      `Student number ${found.numberTaken.studentNumber} is already used by ${formatPersonName(found.numberTaken)} in this academic year.`,
    );
  }
  const exact = found.matches.filter((m) => m.strength === 'exact');
  if (exact.length) {
    if (!canOverride) {
      throw new HttpError(
        409,
        'POSSIBLE_DUPLICATE',
        'A student with exactly the same name but a different student number already exists. Only the adviser can save it anyway.',
        { level: 'exact', canOverride: false, matches: found.matches },
      );
    }
    if (!decision.duplicateOverrideReason || decision.duplicateOverrideReason.length < 5) {
      throw new HttpError(
        409,
        'POSSIBLE_DUPLICATE',
        'A student with exactly the same name but a different student number already exists. To save anyway, give a reason (e.g. "different person, checked with registrar").',
        { level: 'exact', canOverride: true, matches: found.matches },
      );
    }
    return { overrideReason: decision.duplicateOverrideReason };
  }
  if (found.matches.length && !decision.acknowledgeSimilar) {
    throw new HttpError(409, 'POSSIBLE_DUPLICATE', 'A student with a similar name already exists. Check that this is a different person.', {
      level: 'similar',
      canOverride: true,
      matches: found.matches,
    });
  }
  return { overrideReason: null };
}

/** Program and section must belong to this AY and be active; the year level must exist. */
export async function validatePlacement(
  db: Db,
  academicYearId: string,
  input: { programId: string; yearLevel: number; sectionId?: string | null },
  current?: { programId: string; sectionId: string | null },
) {
  const [program, section, settings] = await Promise.all([
    db.program.findFirst({ where: { id: input.programId, academicYearId } }),
    input.sectionId ? db.section.findFirst({ where: { id: input.sectionId, academicYearId } }) : null,
    db.aySetting.findUnique({ where: { academicYearId } }),
  ]);
  // keeping a program/section that was deactivated later is fine; choosing one isn't
  if (!program || (!program.isActive && program.id !== current?.programId)) throw badRequest('INVALID_PROGRAM', 'Choose an active program.');
  if (input.sectionId && (!section || (!section.isActive && section.id !== current?.sectionId))) {
    throw badRequest('INVALID_SECTION', 'Choose an active section.');
  }
  const maxYear = settings?.yearLevelCount ?? 4;
  if (input.yearLevel > maxYear) throw badRequest('INVALID_YEAR_LEVEL', `Year level must be from 1 to ${maxYear}.`);
  // a section belongs to one program and year level
  if (section && (section.programId !== input.programId || section.yearLevel !== input.yearLevel)) {
    throw badRequest('INVALID_SECTION', `Section ${section.name} isn't one of ${program.code}'s sections for that year level. Choose the section again.`);
  }
}

/** Any client with a studentQrToken delegate (base, scoped or inside a transaction). */
interface QrTokenClient {
  studentQrToken: { create(args: { data: Prisma.StudentQrTokenUncheckedCreateInput }): PromiseLike<unknown> };
}

export const newQrToken = (tx: QrTokenClient, academicYearId: string, studentId: string) =>
  tx.studentQrToken.create({ data: { academicYearId, studentId, token: randomToken() } }) as PromiseLike<{ id: string; token: string; createdAt: Date }>;

/** Marks students whose name matches another student's (same AY, different record). */
export async function duplicateFlags(academicYearId: string, students: Pick<Student, 'id' | 'nameKey' | 'nameKeyLoose'>[]) {
  if (students.length === 0) return new Map<string, 'exact' | 'similar'>();
  const [exact, loose] = await Promise.all([
    prisma.student.groupBy({
      by: ['nameKey'],
      where: { academicYearId, status: LIVE, nameKey: { in: [...new Set(students.map((s) => s.nameKey))] } },
      _count: { _all: true },
    }),
    prisma.student.groupBy({
      by: ['nameKeyLoose'],
      where: { academicYearId, status: LIVE, nameKeyLoose: { in: [...new Set(students.map((s) => s.nameKeyLoose))] } },
      _count: { _all: true },
    }),
  ]);
  const exactKeys = new Set(exact.filter((g) => g._count._all > 1).map((g) => g.nameKey));
  const looseKeys = new Set(loose.filter((g) => g._count._all > 1).map((g) => g.nameKeyLoose));
  const flags = new Map<string, 'exact' | 'similar'>();
  for (const s of students) {
    if (exactKeys.has(s.nameKey)) flags.set(s.id, 'exact');
    else if (looseKeys.has(s.nameKeyLoose)) flags.set(s.id, 'similar');
  }
  return flags;
}

export function serializeStudent(s: StudentWithRefs, flag?: 'exact' | 'similar' | null) {
  return {
    id: s.id,
    studentNumber: s.studentNumber,
    name: formatPersonName(s),
    firstName: s.firstName,
    middleName: s.middleName,
    lastName: s.lastName,
    suffix: s.suffix,
    program: { id: s.program.id, code: s.program.code, name: s.program.name },
    yearLevel: s.yearLevel,
    section: s.section ? { id: s.section.id, name: s.section.name } : null,
    email: s.email,
    contactNo: s.contactNo,
    status: s.status,
    source: s.source,
    needsProfileConfirmation: s.needsProfileConfirmation,
    profileConfirmedAt: s.profileConfirmedAt,
    profileConfirmedByName: s.profileConfirmedByName,
    duplicateFlag: flag ?? null,
    duplicateOverride: s.duplicateOverride,
    duplicateOverrideByName: s.duplicateOverrideByName,
    duplicateOverrideReason: s.duplicateOverrideReason,
    consentGivenAt: s.consentGivenAt,
    approvedAt: s.approvedAt,
    approvedByName: s.approvedByName,
    rejectedAt: s.rejectedAt,
    rejectedByName: s.rejectedByName,
    rejectionComment: s.rejectionComment,
    createdByName: s.createdByName,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** What the audit log keeps about a student. */
export const studentSnapshot = (s: StudentWithRefs) => ({
  studentNumber: s.studentNumber,
  name: formatPersonName(s),
  program: s.program.code,
  yearLevel: s.yearLevel,
  section: s.section?.name ?? null,
  email: s.email,
  contactNo: s.contactNo,
  status: s.status,
  needsProfileConfirmation: s.needsProfileConfirmation,
});

export const courseYearSection = (s: StudentWithRefs) => `${s.program.code} ${s.yearLevel}${s.section ? `-${s.section.name}` : ''}`;

export interface StudentCharge {
  chargeId: string;
  /** null when the fund is confidential and the viewer may not see it */
  fundId: string | null;
  fundName: string;
  restricted: boolean;
  isMandatory: boolean;
  priority: number;
  amountDue: number;
  amountPaid: number;
  balance: number;
  status: 'unpaid' | 'partial' | 'paid';
}

/** A student's active charges in priority order, with confidential funds masked for viewers who may not see them. */
export async function studentCharges(academicYearId: string, studentId: string, canSeeConfidential: boolean) {
  const rows = await prisma.$queryRaw<
    {
      charge_id: string;
      fund_id: string;
      fund_name: string;
      priority: number;
      is_mandatory: boolean;
      is_confidential: boolean;
      amount_due: bigint;
      amount_paid: bigint;
      balance: bigint;
      pay_status: 'unpaid' | 'partial' | 'paid';
    }[]
  >`
    SELECT charge_id, fund_id, fund_name, priority, is_mandatory, is_confidential, amount_due, amount_paid, balance, pay_status
    FROM v_charge_balances
    WHERE academic_year_id = ${academicYearId}::uuid AND student_id = ${studentId}::uuid
    ORDER BY priority`;
  const charges: StudentCharge[] = rows.map((r) => {
    const restricted = r.is_confidential && !canSeeConfidential;
    return {
      chargeId: r.charge_id,
      fundId: restricted ? null : r.fund_id,
      fundName: restricted ? 'Restricted fund' : r.fund_name,
      restricted,
      isMandatory: r.is_mandatory,
      priority: r.priority,
      amountDue: Number(r.amount_due),
      amountPaid: Number(r.amount_paid),
      balance: Number(r.balance),
      status: r.pay_status,
    };
  });
  const sum = (k: 'amountDue' | 'amountPaid' | 'balance') => charges.reduce((s, c) => s + c[k], 0);
  return {
    charges,
    totals: { due: sum('amountDue'), paid: sum('amountPaid'), balance: sum('balance') },
    // Cleared only when every MANDATORY charge is fully paid
    isCleared: charges.every((c) => !c.isMandatory || c.status === 'paid'),
  };
}

/** Cleared / Has Balance for many students at once (from v_student_clearance). */
export async function clearanceFor(academicYearId: string, studentIds: string[]) {
  if (studentIds.length === 0) return new Map<string, { isCleared: boolean; totalBalance: number; totalDue: number }>();
  const rows = await prisma.$queryRaw<{ student_id: string; is_cleared: boolean; total_balance: bigint; total_due: bigint }[]>`
    SELECT student_id, is_cleared, total_balance, total_due
    FROM v_student_clearance
    WHERE academic_year_id = ${academicYearId}::uuid AND student_id = ANY(${studentIds}::uuid[])`;
  return new Map(rows.map((r) => [r.student_id, { isCleared: r.is_cleared, totalBalance: Number(r.total_balance), totalDue: Number(r.total_due) }]));
}
