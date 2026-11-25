/**
 * Direct database fixtures for data whose screens arrive in later phases
 * (funds, students, payments). They go through every database guard and trigger.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/db';

export async function createProgram(academicYearId: string, code: string) {
  return prisma.program.create({ data: { academicYearId, code, name: `${code} program` } });
}

/** A section of one program's year level. */
export async function createSection(academicYearId: string, name: string, programId: string, yearLevel: number) {
  return prisma.section.create({ data: { academicYearId, name, programId, yearLevel } });
}

/** The section (made if needed) for a program and year level; "A" unless named. */
export async function sectionFor(academicYearId: string, programId: string, yearLevel: number, name = 'A') {
  return prisma.section.upsert({
    where: { academicYearId_programId_yearLevel_name: { academicYearId, programId, yearLevel, name } },
    update: {},
    create: { academicYearId, programId, yearLevel, name },
  });
}

export async function createFund(
  academicYearId: string,
  opts: { name: string; amount: number; priority: number; yearLevels?: number[]; programIds?: string[]; confidential?: boolean },
) {
  const fund = await prisma.fund.create({
    data: {
      academicYearId,
      name: opts.name,
      amountPerStudent: BigInt(opts.amount),
      priority: opts.priority,
      isConfidential: opts.confidential ?? false,
      allPrograms: !opts.programIds?.length,
    },
  });
  await prisma.fundYearLevel.createMany({
    data: (opts.yearLevels ?? [1, 2, 3, 4]).map((yearLevel) => ({ academicYearId, fundId: fund.id, yearLevel })),
  });
  if (opts.programIds?.length) {
    await prisma.fundProgram.createMany({ data: opts.programIds.map((programId) => ({ academicYearId, fundId: fund.id, programId })) });
  }
  return fund;
}

export async function createStudent(
  academicYearId: string,
  opts: { number: string; first: string; last: string; programId: string; yearLevel: number; sectionId?: string },
) {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return prisma.student.create({
    data: {
      academicYearId,
      studentNumber: opts.number,
      firstName: opts.first,
      lastName: opts.last,
      nameKey: key(opts.first + opts.last),
      nameKeyLoose: key(opts.first + opts.last),
      programId: opts.programId,
      yearLevel: opts.yearLevel,
      sectionId: opts.sectionId ?? null,
      source: 'manual',
    },
  });
}

/** One payment fully allocated to one charge, plus its ledger "collection" entry. */
export async function recordCollection(opts: { academicYearId: string; studentId: string; fundId: string; amount: number; processedById: string }) {
  const { academicYearId, studentId, fundId, amount, processedById } = opts;
  return prisma.$transaction(async (tx) => {
    const fund = await tx.fund.findUniqueOrThrow({ where: { id: fundId } });
    const student = await tx.student.findUniqueOrThrow({ where: { id: studentId }, include: { program: true } });
    const charge = await tx.studentCharge.upsert({
      where: { studentId_fundId: { studentId, fundId } },
      update: {},
      create: { academicYearId, studentId, fundId, amountDue: fund.amountPerStudent },
    });
    const payment = await tx.payment.create({
      data: {
        academicYearId,
        transactionNo: `2026-11-12-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        idempotencyKey: randomUUID(),
        studentId,
        amount: BigInt(amount),
        balanceBefore: charge.amountDue,
        balanceAfter: charge.amountDue - BigInt(amount),
        clearedAfter: false,
        studentNumberSnapshot: student.studentNumber,
        studentNameSnapshot: `${student.firstName} ${student.lastName}`,
        programSnapshot: student.program.code,
        yearLevelSnapshot: student.yearLevel,
        processedById,
        processedByName: 'Test Collector',
        qrUrl: 'http://localhost/verify/test',
      },
    });
    const allocation = await tx.paymentAllocation.create({
      data: {
        academicYearId,
        paymentId: payment.id,
        chargeId: charge.id,
        amount: BigInt(amount),
        fundNameSnapshot: fund.name,
        chargeBalanceAfter: charge.amountDue - BigInt(amount),
      },
    });
    await tx.fundLedger.create({
      data: {
        academicYearId,
        fundId,
        entryType: 'collection',
        amount: BigInt(amount),
        label: `Payment ${payment.transactionNo}`,
        paymentId: payment.id,
        allocationId: allocation.id,
        createdById: processedById,
        createdByName: 'Test Collector',
      },
    });
    return payment;
  });
}
