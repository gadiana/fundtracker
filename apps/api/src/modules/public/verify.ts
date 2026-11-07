import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { formatPersonName } from '@sft/shared';
import { isTest } from '../../config';
import { prisma } from '../../db';
import { notFound } from '../../lib/http';
import { optionalPublicFields, logoUrl } from '../settings/service';
import { studentCharges } from '../students/service';

/**
 * The page behind every receipt QR: /verify/<token>. No login.
 * It shows the student's name and Cleared / Has Balance, plus only the extras the adviser
 * switched on. Confidential funds are merged into one "Restricted fee(s)" line.
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

publicVerifyRouter.get('/:token', verifyLimiter, async (req, res) => {
  const token = String(req.params.token ?? '');
  const invalid = () => notFound('This QR code is not valid, or it has been replaced by a newer one.');
  if (!/^[\w-]{20,64}$/.test(token)) throw invalid();

  const qr = await prisma.studentQrToken.findUnique({
    where: { token },
    include: { student: { include: { program: true, section: true, academicYear: true } } },
  });
  if (!qr || !qr.isActive) throw invalid();
  const student = qr.student;
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

  res.set('Cache-Control', 'no-store');
  res.json({
    name: formatPersonName(student),
    status: account.isCleared ? 'cleared' : 'has_balance',
    academicYear: student.academicYear.label,
    org: {
      name: settings?.orgName ?? '',
      logoUrl: settings?.logoFileId ? logoUrl(ayId, 'org', settings.logoFileId) : null,
    },
    checkedAt: new Date(),
    ...(extras.includes('courseYearSection')
      ? { courseYearSection: `${student.program.code} ${student.yearLevel}${student.section ? `-${student.section.name}` : ''}` }
      : {}),
    ...(breakdown ? { breakdown, totals: { due: account.totals.due, paid: account.totals.paid, balance: account.totals.balance } } : {}),
  });
});
