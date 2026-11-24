import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Program, Section, Student, AcademicYear } from '@prisma/client';
import { formatPersonName } from '@sft/shared';
import { isTest } from '../../config';
import { prisma } from '../../db';
import { notFound, uuidParam } from '../../lib/http';
import { RESTRICTED_FEE, receiptFor } from '../payments/service';
import { optionalPublicFields, logoUrl } from '../settings/service';
import { studentCharges } from '../students/service';

/**
 * The page behind every receipt QR: /verify/<token>. No login.
 * It shows the student's name and Cleared / Has Balance, plus only the extras the adviser
 * switched on (fee breakdown, course/year/section, payment history with receipts).
 * Confidential funds are merged into one "Restricted fee(s)" line.
 *
 * The same student in other academic years is found by student number, so the page can show
 * one year or all of them.
 */
export const publicVerifyRouter = Router();

const verifyLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
  handler: (_req, res) => {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many checks from this device. Please wait a minute.' } });
  },
});

type StudentRecord = Student & { program: Program; section: Section | null; academicYear: AcademicYear };

async function loadQr(token: string) {
  const invalid = () => notFound('This QR code is not valid, or it has been replaced by a newer one.');
  if (!/^[\w-]{20,64}$/.test(token)) throw invalid();
  const qr = await prisma.studentQrToken.findUnique({
    where: { token },
    include: { student: { include: { program: true, section: true, academicYear: true } } },
  });
  if (!qr || !qr.isActive) throw invalid();
  return qr;
}

/** Every record of this student (same student number) in any year, newest year first. */
const recordsOf = (student: Student) =>
  prisma.student.findMany({
    where: { studentNumber: student.studentNumber, status: { not: 'rejected' } },
    include: { program: true, section: true, academicYear: true },
    orderBy: { academicYear: { startYear: 'desc' } },
  });

async function yearView(student: StudentRecord) {
  const ayId = student.academicYearId;
  const [settings, account] = await Promise.all([prisma.aySetting.findUnique({ where: { academicYearId: ayId } }), studentCharges(ayId, student.id, false)]);
  const extras = optionalPublicFields(settings?.publicFields);

  let breakdown: { fund: string; amountDue: number; paid: number; balance: number; status: string; restricted: boolean }[] | undefined;
  if (extras.includes('breakdown')) {
    breakdown = account.charges
      .filter((c) => !c.restricted)
      .map((c) => ({ fund: c.fundName, amountDue: c.amountDue, paid: c.amountPaid, balance: c.balance, status: c.status, restricted: false }));
    const restricted = account.charges.filter((c) => c.restricted);
    if (restricted.length) {
      const due = restricted.reduce((s, c) => s + c.amountDue, 0);
      const paid = restricted.reduce((s, c) => s + c.amountPaid, 0);
      breakdown.push({
        fund: restricted.length > 1 ? 'Restricted fees' : 'Restricted fee',
        amountDue: due,
        paid,
        balance: due - paid,
        status: paid >= due ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
        restricted: true,
      });
    }
  }

  const transactions = extras.includes('transactions')
    ? (
        await prisma.payment.findMany({
          where: { academicYearId: ayId, studentId: student.id },
          include: { allocations: { include: { charge: { include: { fund: true } } } } },
          orderBy: { receivedAt: 'desc' },
        })
      ).map((p) => ({
        id: p.id,
        transactionNo: p.transactionNo,
        receivedAt: p.receivedAt,
        amount: Number(p.amount),
        status: p.status,
        funds: [...new Set(p.allocations.map((a) => (a.charge.fund.isConfidential ? RESTRICTED_FEE : a.fundNameSnapshot)))],
      }))
    : undefined;

  return {
    academicYearId: ayId,
    academicYear: student.academicYear.label,
    status: account.isCleared ? ('cleared' as const) : ('has_balance' as const),
    ...(extras.includes('courseYearSection')
      ? { courseYearSection: `${student.program.code} ${student.yearLevel}${student.section ? `-${student.section.name}` : ''}` }
      : {}),
    ...(breakdown ? { breakdown, totals: { due: account.totals.due, paid: account.totals.paid, balance: account.totals.balance } } : {}),
    ...(transactions ? { transactions } : {}),
  };
}

/** ?ay=<academic year id> for one year (default: the year of this QR), ?ay=all for every year. */
publicVerifyRouter.get('/:token', verifyLimiter, async (req, res) => {
  const qr = await loadQr(String(req.params.token ?? ''));
  const student = qr.student;
  const records = await recordsOf(student);
  const pick = typeof req.query.ay === 'string' ? req.query.ay : '';
  const one = records.find((r) => r.academicYearId === pick) ?? student;
  const selected = pick === 'all' ? records : [one];
  const years = await Promise.all(selected.map(yearView));

  const settings = await prisma.aySetting.findUnique({ where: { academicYearId: student.academicYearId } });
  res.set('Cache-Control', 'no-store');
  res.json({
    name: formatPersonName(student),
    org: {
      name: settings?.orgName ?? '',
      logoUrl: settings?.logoFileId ? logoUrl(student.academicYearId, 'org', settings.logoFileId) : null,
    },
    checkedAt: new Date(),
    academicYears: records.map((r) => ({ id: r.academicYearId, label: r.academicYear.label })),
    selected: pick === 'all' ? 'all' : one.academicYearId,
    years,
    // with every year shown: cleared only when every year is cleared
    status: years.every((y) => y.status === 'cleared') ? 'cleared' : 'has_balance',
  });
});

/** One digital receipt from the payment history, for this QR's student only. */
publicVerifyRouter.get('/:token/receipts/:paymentId', verifyLimiter, async (req, res) => {
  const qr = await loadQr(String(req.params.token ?? ''));
  const payment = await prisma.payment.findUnique({ where: { id: uuidParam(req.params.paymentId) }, include: { student: true } });
  const settings = payment ? await prisma.aySetting.findUnique({ where: { academicYearId: payment.academicYearId } }) : null;
  if (
    !payment ||
    payment.student.studentNumber !== qr.student.studentNumber ||
    payment.student.status === 'rejected' ||
    !optionalPublicFields(settings?.publicFields).includes('transactions')
  ) {
    throw notFound('Receipt not found.');
  }
  const receipt = await receiptFor(payment.id, payment.academicYearId);
  res.set('Cache-Control', 'no-store');
  // staff notes and who voided it, and why, stay inside the app
  res.json({ ...receipt, notes: null, voided: receipt.voided ? { at: receipt.voided.at, byName: null, reason: null } : null });
});
