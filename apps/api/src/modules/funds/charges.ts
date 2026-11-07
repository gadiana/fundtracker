/**
 * Charge generation: each student gets one charge per fund that applies to them.
 *
 * A fund applies to a student when the fund is active, the student is active and their
 * course/year/section is confirmed, their year level is one of the fund's, and the fund is
 * for all programs or lists theirs.
 *
 * syncCharges() makes the stored charges match that rule, for any set of students and/or
 * funds. It is called whenever a fund or a student changes:
 * - missing charges are created (or re-activated if they were cancelled before);
 * - charges that no longer apply are cancelled, but only if nothing has been paid on them;
 *   charges with payments are kept and reported.
 * Pending, deactivated and unconfirmed students are left alone.
 */
import type { Prisma } from '@prisma/client';
import type { Actor } from '../../lib/audit';

type Tx = Prisma.TransactionClient;

export interface SyncResult {
  added: number;
  reactivated: number;
  cancelled: number;
  /** charges that no longer apply but already have payments, so they stay */
  keptWithPayments: number;
}

export const EMPTY_SYNC: SyncResult = { added: 0, reactivated: 0, cancelled: 0, keptWithPayments: 0 };

export async function syncCharges(
  tx: Tx,
  academicYearId: string,
  scope: { studentIds?: string[]; fundIds?: string[] },
  actor: Actor,
  reason = 'No longer applies',
): Promise<SyncResult> {
  if (scope.studentIds?.length === 0 || scope.fundIds?.length === 0) return { ...EMPTY_SYNC };

  const [funds, students] = await Promise.all([
    tx.fund.findMany({
      where: { academicYearId, ...(scope.fundIds ? { id: { in: scope.fundIds } } : {}) },
      include: { yearLevels: true, programs: true },
    }),
    tx.student.findMany({
      where: {
        academicYearId,
        status: 'active',
        needsProfileConfirmation: false,
        ...(scope.studentIds ? { id: { in: scope.studentIds } } : {}),
      },
      select: { id: true, programId: true, yearLevel: true },
    }),
  ]);
  if (funds.length === 0 || students.length === 0) return { ...EMPTY_SYNC };

  const existing = await tx.studentCharge.findMany({
    where: { academicYearId, fundId: { in: funds.map((f) => f.id) }, studentId: { in: students.map((s) => s.id) } },
    select: { id: true, studentId: true, fundId: true, status: true },
  });
  const paid = await paidByCharge(tx, existing.map((c) => c.id));
  const byPair = new Map(existing.map((c) => [`${c.studentId}:${c.fundId}`, c]));

  const toCreate: Prisma.StudentChargeCreateManyInput[] = [];
  const toReactivate = new Map<bigint, string[]>(); // amount → charge ids
  const toCancel: string[] = [];
  let keptWithPayments = 0;

  for (const fund of funds) {
    const levels = new Set(fund.yearLevels.map((y) => y.yearLevel));
    const programs = new Set(fund.programs.map((p) => p.programId));
    for (const s of students) {
      const applies = fund.isActive && levels.has(s.yearLevel) && (fund.allPrograms || programs.has(s.programId));
      const charge = byPair.get(`${s.id}:${fund.id}`);
      if (applies) {
        if (!charge) {
          toCreate.push({ academicYearId, studentId: s.id, fundId: fund.id, amountDue: fund.amountPerStudent });
        } else if (charge.status === 'cancelled') {
          toReactivate.set(fund.amountPerStudent, [...(toReactivate.get(fund.amountPerStudent) ?? []), charge.id]);
        }
      } else if (charge?.status === 'active') {
        if ((paid.get(charge.id) ?? 0n) > 0n) keptWithPayments++;
        else toCancel.push(charge.id);
      }
    }
  }

  if (toCreate.length) await tx.studentCharge.createMany({ data: toCreate });
  let reactivated = 0;
  for (const [amountDue, ids] of toReactivate) {
    const r = await tx.studentCharge.updateMany({
      where: { id: { in: ids } },
      data: { status: 'active', amountDue, cancelledAt: null, cancelledById: null, cancelledByName: null, cancelReason: null },
    });
    reactivated += r.count;
  }
  if (toCancel.length) {
    await tx.studentCharge.updateMany({
      where: { id: { in: toCancel } },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: actor.id, cancelledByName: actor.name, cancelReason: reason },
    });
  }
  return { added: toCreate.length, reactivated, cancelled: toCancel.length, keptWithPayments };
}

/** Posted (not voided) amount paid on each charge. */
export async function paidByCharge(tx: Tx, chargeIds: string[]) {
  if (chargeIds.length === 0) return new Map<string, bigint>();
  const rows = await tx.paymentAllocation.groupBy({
    by: ['chargeId'],
    where: { chargeId: { in: chargeIds }, payment: { status: 'posted' } },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.chargeId, r._sum.amount ?? 0n]));
}

/** How many students a fund with these settings would charge right now (for the confirmation dialog). */
export async function countApplicableStudents(
  tx: Tx,
  academicYearId: string,
  opts: { yearLevels: number[]; allPrograms: boolean; programIds: string[] },
) {
  return tx.student.count({
    where: {
      academicYearId,
      status: 'active',
      needsProfileConfirmation: false,
      yearLevel: { in: opts.yearLevels },
      ...(opts.allPrograms ? {} : { programId: { in: opts.programIds } }),
    },
  });
}
