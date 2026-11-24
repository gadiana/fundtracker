import type { Prisma } from '@prisma/client';
import { formatTransactionNo } from '@sft/shared';
import { config } from '../../config';
import { prisma } from '../../db';
import { randomToken } from '../../lib/crypto';
import { notFound } from '../../lib/http';
import { logoUrl } from '../settings/service';

type Tx = Prisma.TransactionClient;

/** The calendar date in the AY's time zone, as YYYY-MM-DD. */
export function localDate(timezone: string, at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/**
 * Next number of an AY-wide counter. The row stays locked until the transaction commits,
 * so two payments can never get the same number, and a rolled-back payment uses none.
 */
export async function nextCounter(tx: Tx, academicYearId: string, counterKey: string) {
  const [row] = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO ay_counters (academic_year_id, counter_key, last_value)
    VALUES (${academicYearId}::uuid, ${counterKey}, 1)
    ON CONFLICT (academic_year_id, counter_key) DO UPDATE SET last_value = ay_counters.last_value + 1
    RETURNING last_value`;
  return row!.last_value;
}

export async function nextTransactionNo(tx: Tx, academicYearId: string, timezone: string, at = new Date()) {
  return formatTransactionNo(localDate(timezone, at), await nextCounter(tx, academicYearId, 'receipt'));
}

export const verifyUrl = (token: string) => `${config.WEB_URL}/verify/${token}`;

/** The student's active status token, created if they don't have one yet. */
export async function ensureQrToken(tx: Tx, academicYearId: string, studentId: string) {
  const current = await tx.studentQrToken.findFirst({ where: { studentId, isActive: true } });
  if (current) return current;
  return tx.studentQrToken.create({ data: { academicYearId, studentId, token: randomToken() } });
}

export interface ChargeWithBalance {
  chargeId: string;
  fundId: string;
  fundName: string;
  isConfidential: boolean;
  isMandatory: boolean;
  priority: number;
  amountDue: number;
  paid: number;
  balance: number;
}

/** Active charges of a student with what's still owed, read inside the payment transaction. */
export async function chargeBalances(tx: Tx, studentId: string): Promise<ChargeWithBalance[]> {
  const charges = await tx.studentCharge.findMany({
    where: { studentId, status: 'active' },
    include: { fund: true, allocations: { where: { payment: { status: 'posted' } }, select: { amount: true } } },
  });
  return charges
    .map((c) => {
      const paid = c.allocations.reduce((sum, a) => sum + Number(a.amount), 0);
      return {
        chargeId: c.id,
        fundId: c.fundId,
        fundName: c.fund.name,
        isConfidential: c.fund.isConfidential,
        isMandatory: c.fund.isMandatory,
        priority: c.fund.priority,
        amountDue: Number(c.amountDue),
        paid,
        balance: Number(c.amountDue) - paid,
      };
    })
    .sort((a, b) => a.priority - b.priority);
}

/** A receipt is a student-facing document, so confidential funds are always shown as this. */
export const RESTRICTED_FEE = 'Restricted fee';

/** Everything printed on the digital receipt. */
export async function receiptFor(paymentId: string, academicYearId: string) {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, academicYearId },
    include: {
      allocations: { include: { charge: { include: { fund: true } } } },
    },
  });
  if (!payment) throw notFound('Payment not found.');
  const [settings, ay] = await Promise.all([
    prisma.aySetting.findUnique({ where: { academicYearId } }),
    prisma.academicYear.findUniqueOrThrow({ where: { id: academicYearId } }),
  ]);
  const receiptLogo = settings?.receiptLogoFileId ?? settings?.logoFileId;
  return {
    id: payment.id,
    transactionNo: payment.transactionNo,
    status: payment.status,
    amount: Number(payment.amount),
    receivedAt: payment.receivedAt,
    academicYear: ay.label,
    timezone: settings?.timezone ?? 'Asia/Manila',
    student: {
      id: payment.studentId,
      name: payment.studentNameSnapshot,
      studentNumber: payment.studentNumberSnapshot,
      courseYearSection: `${payment.programSnapshot} ${payment.yearLevelSnapshot}${payment.sectionSnapshot ? `-${payment.sectionSnapshot}` : ''}`,
    },
    allocations: payment.allocations
      .sort((a, b) => a.charge.fund.priority - b.charge.fund.priority)
      .map((a) => ({
        fundName: a.charge.fund.isConfidential ? RESTRICTED_FEE : a.fundNameSnapshot,
        amount: Number(a.amount),
        remainingOnFund: Number(a.chargeBalanceAfter),
      })),
    balanceBefore: Number(payment.balanceBefore),
    balanceAfter: Number(payment.balanceAfter),
    clearedAfter: payment.clearedAfter,
    processedByName: payment.processedByName,
    processedByDesignation: payment.processedByDesignation,
    qrUrl: payment.qrUrl,
    notes: payment.notes,
    org: {
      name: settings?.orgName ?? '',
      abbr: settings?.orgAbbr ?? '',
      school: settings?.schoolName ?? '',
      college: settings?.collegeName ?? '',
      logoUrl: receiptLogo ? logoUrl(academicYearId, 'receipt', receiptLogo) : null,
    },
    qrMessage: settings?.receiptQrMessage ?? 'Please check student status using the QR',
    footer: settings?.receiptFooterText ?? '',
    voided:
      payment.status === 'voided'
        ? { at: payment.voidedAt, byName: payment.voidedByName, reason: payment.voidReason }
        : null,
  };
}
export type Receipt = Awaited<ReturnType<typeof receiptFor>>;
