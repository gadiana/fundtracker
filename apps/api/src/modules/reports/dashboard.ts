import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { canSeeConfidential } from '../../lib/confidential';
import { requireAuth } from '../../middleware/auth';
import { ayContext, ctxOf, requireMember } from '../../middleware/ay';

/**
 * Dashboard figures for the selected AY. Money figures leave out confidential funds for
 * positions that may not see them; clearance counts are per student and include every fund.
 */
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, ayContext, requireMember);

const query = z.object({ range: z.enum(['30d', '90d', '12m', 'all']).default('90d') });

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

dashboardRouter.get('/', async (req, res) => {
  const { range } = query.parse(req.query);
  const { ay, perms } = ctxOf(req);
  const settings = await prisma.aySetting.findUnique({ where: { academicYearId: ay.id } });
  const tz = settings?.timezone ?? 'Asia/Manila';
  const seeAll = canSeeConfidential(perms);
  const visible = seeAll ? Prisma.sql`true` : Prisma.sql`f.is_confidential = false`;
  const unit = range === '30d' || range === '90d' ? 'day' : 'month';
  const since =
    range === 'all'
      ? null
      : new Date(Date.now() - { '30d': 30, '90d': 90, '12m': 365 }[range] * 86_400_000);

  const [funds, charges, collected, used, clearance, overTime, groups, recent, pending] = await Promise.all([
    prisma.$queryRaw<{ id: string; name: string; is_confidential: boolean; priority: number; is_active: boolean; balance: bigint; committed: bigint; available: bigint }[]>`
      SELECT f.id, f.name, f.is_confidential, f.priority, f.is_active, b.balance, b.committed, b.available
      FROM funds f JOIN v_fund_balances b ON b.fund_id = f.id
      WHERE f.academic_year_id = ${ay.id}::uuid AND ${visible}
      ORDER BY f.priority`,
    prisma.$queryRaw<{ fund_id: string; due: bigint; outstanding: bigint }[]>`
      SELECT cb.fund_id, sum(cb.amount_due) AS due, sum(cb.balance) AS outstanding
      FROM v_charge_balances cb JOIN funds f ON f.id = cb.fund_id JOIN students s ON s.id = cb.student_id
      WHERE cb.academic_year_id = ${ay.id}::uuid AND s.status = 'active' AND ${visible}
      GROUP BY cb.fund_id`,
    prisma.$queryRaw<{ fund_id: string; amount: bigint }[]>`
      SELECT c.fund_id, sum(a.amount) AS amount
      FROM payment_allocations a JOIN payments p ON p.id = a.payment_id JOIN student_charges c ON c.id = a.charge_id JOIN funds f ON f.id = c.fund_id
      WHERE p.academic_year_id = ${ay.id}::uuid AND p.status = 'posted' AND ${visible}
      GROUP BY c.fund_id`,
    prisma.$queryRaw<{ fund_id: string; amount: bigint }[]>`
      SELECT l.fund_id, -sum(l.amount) AS amount
      FROM fund_ledger l JOIN funds f ON f.id = l.fund_id
      WHERE l.academic_year_id = ${ay.id}::uuid AND l.entry_type = 'usage' AND ${visible}
      GROUP BY l.fund_id`,
    prisma.$queryRaw<{ cleared: bigint; total: bigint }[]>`
      SELECT count(*) FILTER (WHERE v.is_cleared) AS cleared, count(*) AS total
      FROM v_student_clearance v WHERE v.academic_year_id = ${ay.id}::uuid`,
    prisma.$queryRaw<{ bucket: Date; amount: bigint; payments: bigint }[]>`
      SELECT date_trunc(${unit}, p.received_at AT TIME ZONE ${tz})::date AS bucket, sum(a.amount) AS amount, count(DISTINCT p.id) AS payments
      FROM payment_allocations a JOIN payments p ON p.id = a.payment_id JOIN student_charges c ON c.id = a.charge_id JOIN funds f ON f.id = c.fund_id
      WHERE p.academic_year_id = ${ay.id}::uuid AND p.status = 'posted' AND ${visible}
        ${since ? Prisma.sql`AND p.received_at >= ${since}` : Prisma.empty}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ program: string; year_level: number; section: string | null; due: bigint; paid: bigint; outstanding: bigint }[]>`
      SELECT pr.code AS program, s.year_level, se.name AS section, sum(cb.amount_due) AS due, sum(cb.amount_paid) AS paid, sum(cb.balance) AS outstanding
      FROM v_charge_balances cb
      JOIN funds f ON f.id = cb.fund_id
      JOIN students s ON s.id = cb.student_id
      JOIN programs pr ON pr.id = s.program_id
      LEFT JOIN sections se ON se.id = s.section_id
      WHERE cb.academic_year_id = ${ay.id}::uuid AND s.status = 'active' AND ${visible}
      GROUP BY pr.code, s.year_level, se.name`,
    perms.includes('collect')
      ? prisma.payment.findMany({ where: { academicYearId: ay.id }, orderBy: { receivedAt: 'desc' }, take: 5 })
      : [],
    Promise.all([
      perms.includes('collect') ? prisma.student.count({ where: { academicYearId: ay.id, status: 'pending' } }) : null,
      perms.includes('collect') ? prisma.student.count({ where: { academicYearId: ay.id, status: 'active', needsProfileConfirmation: true } }) : null,
      perms.includes('manage') ? prisma.userAyRole.count({ where: { academicYearId: ay.id, status: 'pending' } }) : null,
      perms.includes('manage') ? prisma.emailOutbox.count({ where: { academicYearId: ay.id, status: 'failed' } }) : null,
    ]),
  ]);

  const due = new Map(charges.map((r) => [r.fund_id, n(r.due)]));
  const outstanding = new Map(charges.map((r) => [r.fund_id, n(r.outstanding)]));
  const got = new Map(collected.map((r) => [r.fund_id, n(r.amount)]));
  const spent = new Map(used.map((r) => [r.fund_id, n(r.amount)]));
  const fundRows = funds.map((f) => ({
    id: f.id,
    name: f.name,
    isConfidential: f.is_confidential,
    isActive: f.is_active,
    due: due.get(f.id) ?? 0,
    collected: got.get(f.id) ?? 0,
    outstanding: outstanding.get(f.id) ?? 0,
    used: spent.get(f.id) ?? 0,
    balance: n(f.balance),
    reserved: n(f.committed),
    available: n(f.available),
  }));
  const sum = (k: keyof (typeof fundRows)[number]) => fundRows.reduce((s, f) => s + (typeof f[k] === 'number' ? (f[k] as number) : 0), 0);

  // every day (or month) in the range, so the chart has no gaps
  const points = new Map(overTime.map((r) => [r.bucket.toISOString().slice(0, 10), { amount: n(r.amount), payments: n(r.payments) }]));
  const series: { period: string; amount: number; payments: number }[] = [];
  if (unit === 'day' && since) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    for (let d = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(since)}T00:00:00Z`); d.toISOString().slice(0, 10) <= today; d = new Date(d.getTime() + 86_400_000)) {
      const key = d.toISOString().slice(0, 10);
      series.push({ period: key, ...(points.get(key) ?? { amount: 0, payments: 0 }) });
    }
  } else {
    for (const [period, v] of points) series.push({ period, ...v });
  }

  const group = (key: (g: (typeof groups)[number]) => string) => {
    const m = new Map<string, { label: string; due: number; collected: number; outstanding: number }>();
    for (const g of groups) {
      const label = key(g);
      const cur = m.get(label) ?? { label, due: 0, collected: 0, outstanding: 0 };
      cur.due += n(g.due);
      cur.collected += n(g.paid);
      cur.outstanding += n(g.outstanding);
      m.set(label, cur);
    }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  };
  const [pendingStudents, needsConfirmation, pendingMembers, failedEmails] = pending;
  // positions without "See funds" get the collection figures, but no fund balances or fund list
  const seeFunds = perms.includes('view_funds');

  res.json({
    range,
    unit,
    fundsHidden: !seeFunds,
    restrictedHidden: !seeAll && (await prisma.fund.count({ where: { academicYearId: ay.id, isConfidential: true } })) > 0,
    totals: {
      due: sum('due'),
      collected: sum('collected'),
      outstanding: sum('outstanding'),
      used: seeFunds ? sum('used') : 0,
      balance: seeFunds ? sum('balance') : 0,
      reserved: seeFunds ? sum('reserved') : 0,
      available: seeFunds ? sum('available') : 0,
    },
    clearance: { cleared: n(clearance[0]?.cleared), hasBalance: n(clearance[0]?.total) - n(clearance[0]?.cleared), total: n(clearance[0]?.total) },
    pending: { pendingStudents, needsConfirmation, pendingMembers, failedEmails },
    funds: seeFunds ? fundRows : [],
    collectionsOverTime: series,
    byProgram: group((g) => g.program),
    byYear: group((g) => `Year ${g.year_level}`),
    bySection: group((g) => `${g.program} ${g.year_level}${g.section ? `-${g.section}` : ''}`),
    usageByFund: seeFunds ? fundRows.filter((f) => f.used > 0).map((f) => ({ name: f.name, used: f.used })) : [],
    recentPayments: recent.map((p) => ({
      id: p.id,
      transactionNo: p.transactionNo,
      receivedAt: p.receivedAt,
      studentName: p.studentNameSnapshot,
      amount: Number(p.amount),
      status: p.status,
    })),
  });
});
