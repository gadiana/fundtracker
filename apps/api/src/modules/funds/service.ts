import type { Fund, FundProgram, FundYearLevel, Prisma, Program } from '@prisma/client';
import { prisma } from '../../db';

type Db = Prisma.TransactionClient | typeof prisma;

export type FundWithRefs = Fund & { yearLevels: FundYearLevel[]; programs: (FundProgram & { program: Program })[] };
export const fundInclude = { yearLevels: true, programs: { include: { program: true } } } as const;

export interface FundStats {
  students: number;
  totalDue: number;
  collected: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
  balance: number;
  committed: number;
  available: number;
}

const ZERO_STATS: FundStats = { students: 0, totalDue: 0, collected: 0, paidCount: 0, partialCount: 0, unpaidCount: 0, balance: 0, committed: 0, available: 0 };

/** Charge and ledger totals per fund of one AY (from the v_charge_balances / v_fund_balances views). */
export async function fundStats(db: Db, academicYearId: string): Promise<Map<string, FundStats>> {
  const [charges, balances] = await Promise.all([
    db.$queryRaw<
      { fund_id: string; students: number; due: bigint; paid: bigint; paid_count: number; partial_count: number; unpaid_count: number }[]
    >`
      SELECT fund_id,
             count(*)::int AS students,
             COALESCE(sum(amount_due), 0)::bigint AS due,
             COALESCE(sum(amount_paid), 0)::bigint AS paid,
             count(*) FILTER (WHERE pay_status = 'paid')::int AS paid_count,
             count(*) FILTER (WHERE pay_status = 'partial')::int AS partial_count,
             count(*) FILTER (WHERE pay_status = 'unpaid')::int AS unpaid_count
      FROM v_charge_balances
      WHERE academic_year_id = ${academicYearId}::uuid
      GROUP BY fund_id`,
    db.$queryRaw<{ fund_id: string; balance: bigint; committed: bigint; available: bigint }[]>`
      SELECT fund_id, balance, committed, available FROM v_fund_balances WHERE academic_year_id = ${academicYearId}::uuid`,
  ]);
  const stats = new Map<string, FundStats>();
  for (const b of balances) {
    stats.set(b.fund_id, { ...ZERO_STATS, balance: Number(b.balance), committed: Number(b.committed), available: Number(b.available) });
  }
  for (const c of charges) {
    const s = stats.get(c.fund_id) ?? { ...ZERO_STATS };
    stats.set(c.fund_id, {
      ...s,
      students: c.students,
      totalDue: Number(c.due),
      collected: Number(c.paid),
      paidCount: c.paid_count,
      partialCount: c.partial_count,
      unpaidCount: c.unpaid_count,
    });
  }
  return stats;
}

/** Once any payment has touched a fund's charges, its amount can never change (also enforced by a DB trigger). */
export async function fundHasCollections(db: Db, fundId: string) {
  return (await db.paymentAllocation.count({ where: { charge: { fundId } } })) > 0;
}

export function serializeFund(f: FundWithRefs, stats?: FundStats, amountLocked?: boolean) {
  return {
    id: f.id,
    name: f.name,
    notes: f.notes,
    amountPerStudent: Number(f.amountPerStudent),
    isConfidential: f.isConfidential,
    isMandatory: f.isMandatory,
    allPrograms: f.allPrograms,
    programs: f.programs.map((p) => ({ id: p.program.id, code: p.program.code })).sort((a, b) => a.code.localeCompare(b.code)),
    yearLevels: f.yearLevels.map((y) => y.yearLevel).sort((a, b) => a - b),
    priority: f.priority,
    isActive: f.isActive,
    copiedFromFundId: f.copiedFromFundId,
    createdByName: f.createdByName,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    stats: stats ?? { ...ZERO_STATS },
    amountLocked: amountLocked ?? false,
  };
}

export const fundSnapshot = (f: FundWithRefs) => ({
  name: f.name,
  amountPerStudent: Number(f.amountPerStudent),
  isConfidential: f.isConfidential,
  isMandatory: f.isMandatory,
  yearLevels: f.yearLevels.map((y) => y.yearLevel).sort((a, b) => a - b),
  programs: f.allPrograms ? 'all' : f.programs.map((p) => p.program.code).sort(),
  isActive: f.isActive,
  notes: f.notes,
});
