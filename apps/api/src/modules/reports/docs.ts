import { Prisma, type AcademicYear, type AySetting } from '@prisma/client';
import {
  REPORT_TITLES,
  centavosPlain,
  fillHeaderText,
  formatPersonName,
  formatReportCell,
  type ReportDoc,
  type ReportKind,
  type ReportTable,
  type Permission,
  type clearanceFilterSchema,
  type fundReportSchema,
} from '@sft/shared';
import type { z } from 'zod';
import { prisma } from '../../db';
import type { Actor } from '../../lib/audit';
import { canSeeConfidential, fundLabelFor } from '../../lib/confidential';
import { conflict, notFound } from '../../lib/http';
import { endOfDayExclusive, periodLabel, startOfDay } from '../../lib/time';
import { canViewRequest, receiptRef, requestInclude } from '../fund-requests/service';
import { reportFormats, reportLogoUrl } from './formats';
import { studentCharges } from '../students/service';
import {
  collectionByDay,
  collectionByFund,
  collectionByStaff,
  collectionRows,
  collectionTotals,
  collectionWhere,
  usageByFund,
  usageRows,
  usageTotals,
  usageWhere,
  type CollectionFilter,
  type UsageFilter,
} from './queries';

/** Longest table a report prints; the summary always covers everything. */
export const REPORT_ROW_LIMIT = 5000;

export interface ReportContext {
  ay: AcademicYear;
  settings: AySetting;
  perms: Permission[];
  actor: Actor;
  userId: string;
}

const RESTRICTED_NOTE = 'Amounts in restricted (confidential) funds are combined into one line or left out, as your position may not see them.';

/**
 * The parts every report shares, laid out as the adviser set the report's format (Settings →
 * Reports). `signatories` in `rest` (the liquidation report's own) come before the format's.
 */
function base(kind: ReportKind, ctx: ReportContext, rest: Pick<ReportDoc, 'filters' | 'summary' | 'tables'> & Partial<ReportDoc>): ReportDoc {
  const s = ctx.settings;
  const format = reportFormats(s)[kind];
  const logos = (list: typeof format.logosLeft) => list.map((l) => reportLogoUrl(s, l)).filter((u): u is string => Boolean(u));
  const { signatories: own = [], ...others } = rest;
  return {
    kind,
    title: REPORT_TITLES[kind],
    notes: [],
    header: {
      orgName: s.orgName || 'Fund Tracker',
      academicYear: ctx.ay.label,
      logosLeft: logos(format.logosLeft),
      logosRight: logos(format.logosRight),
      logoSize: format.logoSize,
      lines: format.headerLines.filter((l) => l.text).map((l) => ({ ...l, text: fillHeaderText(l.text, ctx.ay.label) })),
    },
    signatories: [
      ...own,
      // a signatory without a name is whoever generates the report
      ...format.signatories
        .filter((x) => x.show)
        .map((x) => (x.name ? { label: x.label, name: x.name, title: x.position } : { label: x.label, name: ctx.actor.name, title: x.position || (ctx.actor.designation ?? '') })),
    ],
    paperSize: format.paperSize,
    timezone: s.timezone,
    generatedAt: new Date().toISOString(),
    generatedBy: ctx.actor.name,
    ...others,
  };
}

async function lookups(academicYearId: string, ids: { programId?: string; sectionId?: string; processedById?: string; fundId?: string }) {
  const [program, section, staff, fund] = await Promise.all([
    ids.programId ? prisma.program.findFirst({ where: { id: ids.programId, academicYearId } }) : null,
    ids.sectionId ? prisma.section.findFirst({ where: { id: ids.sectionId, academicYearId }, include: { program: true } }) : null,
    ids.processedById ? prisma.user.findUnique({ where: { id: ids.processedById } }) : null,
    ids.fundId ? prisma.fund.findFirst({ where: { id: ids.fundId, academicYearId } }) : null,
  ]);
  return { program, section, staff, fund };
}

// ───────────────────────────── collection report ─────────────────────────────

export async function collectionReport(ctx: ReportContext, f: CollectionFilter): Promise<ReportDoc> {
  const tz = ctx.settings.timezone;
  const where = collectionWhere(ctx.ay.id, f, tz);
  const [totals, byFund, byStaff, byDay, rows, names] = await Promise.all([
    collectionTotals(where),
    collectionByFund(where, ctx.perms),
    collectionByStaff(where),
    collectionByDay(where, tz),
    collectionRows(where, { limit: REPORT_ROW_LIMIT, offset: 0 }),
    lookups(ctx.ay.id, f),
  ]);
  const filters = [{ label: 'Period', value: periodLabel(f.from, f.to) }];
  if (names.program) filters.push({ label: 'Program', value: names.program.code });
  if (f.yearLevel) filters.push({ label: 'Year level', value: String(f.yearLevel) });
  if (names.section) filters.push({ label: 'Section', value: `${names.section.program.code} ${names.section.yearLevel}-${names.section.name}` });
  if (names.staff) filters.push({ label: 'Processed by', value: formatPersonName(names.staff) });
  if (f.status !== 'all') filters.push({ label: 'Status', value: f.status === 'posted' ? 'Posted only' : 'Voided only' });
  if (f.q) filters.push({ label: 'Search', value: f.q });

  const tables: ReportTable[] = [
    {
      title: 'Collected per fund',
      columns: [
        { key: 'fund', label: 'Fund' },
        { key: 'payments', label: 'Payments', type: 'number' },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      rows: byFund,
      totals: { fund: 'Total', amount: byFund.reduce((s, r) => s + r.amount, 0) },
      emptyText: 'No posted payments.',
    },
    {
      title: 'Per day',
      columns: [
        { key: 'day', label: 'Date', type: 'date' },
        { key: 'count', label: 'Payments', type: 'number' },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      rows: byDay,
      totals: { day: 'Total', count: totals.postedCount, amount: totals.posted },
      emptyText: 'No posted payments.',
    },
    {
      title: 'Per staff member',
      columns: [
        { key: 'name', label: 'Processed by' },
        { key: 'count', label: 'Payments', type: 'number' },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      rows: byStaff,
      emptyText: 'No posted payments.',
    },
    {
      title: 'Transactions',
      primary: true,
      columns: [
        { key: 'transactionNo', label: 'Transaction no.' },
        { key: 'receivedAt', label: 'Date and time', type: 'datetime' },
        { key: 'studentName', label: 'Student' },
        { key: 'studentNumber', label: 'Student no.' },
        { key: 'courseYearSection', label: 'Course/yr/sec' },
        { key: 'amount', label: 'Amount paid', type: 'money' },
        { key: 'balanceAfter', label: 'Balance after', type: 'money' },
        { key: 'status', label: 'Status' },
        { key: 'processedByName', label: 'Processed by' },
      ],
      rows: rows.map((r) => ({
        transactionNo: r.transactionNo,
        receivedAt: r.receivedAt.toISOString(),
        studentName: r.studentName,
        studentNumber: r.studentNumber,
        courseYearSection: r.courseYearSection,
        amount: r.amount,
        balanceAfter: r.balanceAfter,
        status: r.status === 'voided' ? 'Voided' : 'Posted',
        processedByName: r.processedByName,
      })),
      emptyText: 'No payments match.',
    },
  ];
  return base('collections', ctx, {
    filters,
    summary: [
      { label: 'Total collected', value: totals.posted, type: 'money' },
      { label: 'Payments', value: totals.postedCount, type: 'number' },
      { label: 'Voided payments', value: totals.voidedCount, type: 'number' },
      { label: 'Voided amount', value: totals.voided, type: 'money' },
    ],
    tables,
    notes: [
      'Voided payments are listed but not counted in the totals.',
      ...(canSeeConfidential(ctx.perms) ? [] : [RESTRICTED_NOTE]),
    ],
    truncatedAt: totals.count > REPORT_ROW_LIMIT ? REPORT_ROW_LIMIT : undefined,
  });
}

// ───────────────────────────── usage report ─────────────────────────────

export async function usageReport(ctx: ReportContext, f: UsageFilter, scope: { all: boolean }): Promise<ReportDoc> {
  const where = usageWhere(ctx.ay.id, f, ctx.settings.timezone, ctx.perms, scope, ctx.userId);
  const [totals, byFund, rows, names] = await Promise.all([
    usageTotals(where),
    usageByFund(where),
    usageRows(where, { limit: REPORT_ROW_LIMIT, offset: 0 }),
    lookups(ctx.ay.id, { fundId: f.fundId }),
  ]);
  const filters = [{ label: 'Filed', value: periodLabel(f.from, f.to) }];
  if (names.fund) filters.push({ label: 'Fund', value: names.fund.name });
  if (f.status) filters.push({ label: 'Status', value: rows[0]?.statusLabel ?? f.status });
  if (f.q) filters.push({ label: 'Search', value: f.q });
  if (!scope.all) filters.push({ label: 'Requests', value: 'Your own' });

  return base('fund-usage', ctx, {
    filters,
    summary: [
      { label: 'Requests', value: totals.count, type: 'number' },
      { label: 'Approved amount', value: totals.approved, type: 'money' },
      { label: 'Used (cleared)', value: totals.used, type: 'money' },
      { label: 'Reserved (not yet liquidated)', value: totals.reserved, type: 'money' },
    ],
    tables: [
      {
        title: 'Per fund',
        columns: [
          { key: 'fund', label: 'Fund' },
          { key: 'requests', label: 'Requests', type: 'number' },
          { key: 'used', label: 'Used', type: 'money' },
          { key: 'reserved', label: 'Reserved', type: 'money' },
        ],
        rows: byFund,
        totals: { fund: 'Total', requests: totals.count, used: totals.used, reserved: totals.reserved },
        emptyText: 'No requests.',
      },
      {
        title: 'Requests',
        primary: true,
        columns: [
          { key: 'requestNo', label: 'Request no.' },
          { key: 'requestorName', label: 'Requestor' },
          { key: 'requestorDesignation', label: 'Position' },
          { key: 'fundName', label: 'Fund' },
          { key: 'purpose', label: 'Purpose' },
          { key: 'amount', label: 'Requested', type: 'money' },
          { key: 'fundUsed', label: 'Used', type: 'money' },
          { key: 'submittedAt', label: 'Filed', type: 'datetime' },
          { key: 'useAt', label: 'Date of use', type: 'date' },
          { key: 'approvedAt', label: 'Approved', type: 'datetime' },
          { key: 'approvedByName', label: 'Approved by' },
          { key: 'receiptSubmittedAt', label: 'Receipt submitted', type: 'datetime' },
          { key: 'receiptApprovedAt', label: 'Receipt approved', type: 'datetime' },
          { key: 'receiptApprovedByName', label: 'Receipt approved by' },
          { key: 'statusLabel', label: 'Status' },
        ],
        rows: rows.map((r) => ({
          requestNo: r.requestNo,
          requestorName: r.requestorName,
          requestorDesignation: r.requestorDesignation,
          fundName: r.fundName,
          purpose: r.purpose,
          amount: r.amount,
          fundUsed: r.fundUsed,
          submittedAt: r.submittedAt.toISOString(),
          useAt: r.useAt.toISOString(),
          approvedAt: r.approvedAt?.toISOString() ?? null,
          approvedByName: r.approvedByName,
          receiptSubmittedAt: r.receiptSubmittedAt?.toISOString() ?? null,
          receiptApprovedAt: r.receiptApprovedAt?.toISOString() ?? null,
          receiptApprovedByName: r.receiptApprovedByName,
          statusLabel: r.statusLabel,
        })),
        emptyText: 'No requests match.',
      },
    ],
    notes: ['Only approved liquidation receipts count as used; the fund is charged the amount actually used.'],
    truncatedAt: totals.count > REPORT_ROW_LIMIT ? REPORT_ROW_LIMIT : undefined,
  });
}

// ───────────────────────────── per-fund report ─────────────────────────────

const LEDGER_LABELS: Record<string, string> = { collection: 'Collection', usage: 'Usage', carry_over: 'Carry-over', adjustment: 'Adjustment', void: 'Void' };

export async function fundReport(ctx: ReportContext, q: z.infer<typeof fundReportSchema>): Promise<ReportDoc> {
  const tz = ctx.settings.timezone;
  const fund = await prisma.fund.findFirst({ where: { id: q.fundId, academicYearId: ctx.ay.id, ...(canSeeConfidential(ctx.perms) ? {} : { isConfidential: false }) } });
  if (!fund) throw notFound('Fund not found.');
  const from = q.from ? startOfDay(q.from, tz) : null;
  const to = q.to ? endOfDayExclusive(q.to, tz) : null;

  const [[bal], [charges], opening, entries, owing] = await Promise.all([
    prisma.$queryRaw<{ balance: bigint; committed: bigint; available: bigint }[]>`SELECT balance, committed, available FROM v_fund_balances WHERE fund_id = ${fund.id}::uuid`,
    prisma.$queryRaw<{ students: bigint; due: bigint | null; paid: bigint | null; balance: bigint | null; paid_n: bigint; partial_n: bigint; unpaid_n: bigint }[]>`
      SELECT count(*) AS students, sum(amount_due) AS due, sum(amount_paid) AS paid, sum(balance) AS balance,
             count(*) FILTER (WHERE pay_status = 'paid') AS paid_n,
             count(*) FILTER (WHERE pay_status = 'partial') AS partial_n,
             count(*) FILTER (WHERE pay_status = 'unpaid') AS unpaid_n
      FROM v_charge_balances WHERE fund_id = ${fund.id}::uuid`,
    from ? prisma.fundLedger.aggregate({ where: { fundId: fund.id, createdAt: { lt: from } }, _sum: { amount: true } }) : null,
    prisma.fundLedger.findMany({
      where: { fundId: fund.id, ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: REPORT_ROW_LIMIT,
    }),
    prisma.$queryRaw<{ student_number: string; first_name: string; middle_name: string | null; last_name: string; suffix: string | null; code: string; year_level: number; section: string | null; amount_due: bigint; amount_paid: bigint; balance: bigint }[]>`
      SELECT s.student_number, s.first_name, s.middle_name, s.last_name, s.suffix, pr.code, s.year_level, se.name AS section, cb.amount_due, cb.amount_paid, cb.balance
      FROM v_charge_balances cb
      JOIN students s ON s.id = cb.student_id
      JOIN programs pr ON pr.id = s.program_id
      LEFT JOIN sections se ON se.id = s.section_id
      WHERE cb.fund_id = ${fund.id}::uuid AND cb.balance > 0
      ORDER BY pr.code, s.year_level, se.name NULLS FIRST, s.last_name, s.first_name
      LIMIT ${REPORT_ROW_LIMIT}`,
  ]);

  let running = Number(opening?._sum.amount ?? 0);
  const ledgerRows = entries.map((e) => {
    running += Number(e.amount);
    return { createdAt: e.createdAt.toISOString(), type: LEDGER_LABELS[e.entryType] ?? e.entryType, label: e.label, amount: Number(e.amount), balance: running, by: e.createdByName };
  });
  const c = charges!;
  return base('fund', ctx, {
    subtitle: `${fund.name}${fund.isConfidential ? ' (confidential)' : ''}`,
    filters: [{ label: 'Ledger entries', value: periodLabel(q.from, q.to) }],
    summary: [
      { label: 'Amount per student', value: Number(fund.amountPerStudent), type: 'money' },
      { label: 'Students charged', value: Number(c.students), type: 'number' },
      { label: 'Total charged', value: Number(c.due ?? 0), type: 'money' },
      { label: 'Collected', value: Number(c.paid ?? 0), type: 'money' },
      { label: 'Still to collect', value: Number(c.balance ?? 0), type: 'money' },
      { label: 'Paid / partial / unpaid', value: `${c.paid_n} / ${c.partial_n} / ${c.unpaid_n}` },
      { label: 'Balance (all time)', value: Number(bal!.balance), type: 'money' },
      { label: 'Reserved for approved requests', value: Number(bal!.committed), type: 'money' },
    ],
    tables: [
      {
        title: 'Ledger',
        primary: true,
        columns: [
          { key: 'createdAt', label: 'Date and time', type: 'datetime' },
          { key: 'type', label: 'Type' },
          { key: 'label', label: 'Description' },
          { key: 'amount', label: 'Amount', type: 'money' },
          { key: 'balance', label: 'Running balance', type: 'money' },
          { key: 'by', label: 'By' },
        ],
        rows: from
          ? [{ createdAt: from.toISOString(), type: 'Opening', label: 'Balance before this period', amount: null, balance: Number(opening?._sum.amount ?? 0), by: null }, ...ledgerRows]
          : ledgerRows,
        totals: { label: 'Balance at the end of the period', balance: running },
        emptyText: 'No ledger entries in this period.',
      },
      {
        title: 'Students who still owe this fund',
        columns: [
          { key: 'studentNumber', label: 'Student no.' },
          { key: 'name', label: 'Name' },
          { key: 'courseYearSection', label: 'Course/yr/sec' },
          { key: 'due', label: 'Due', type: 'money' },
          { key: 'paid', label: 'Paid', type: 'money' },
          { key: 'balance', label: 'Balance', type: 'money' },
        ],
        rows: owing.map((s) => ({
          studentNumber: s.student_number,
          name: formatPersonName({ firstName: s.first_name, middleName: s.middle_name, lastName: s.last_name, suffix: s.suffix }),
          courseYearSection: `${s.code} ${s.year_level}${s.section ? `-${s.section}` : ''}`,
          due: Number(s.amount_due),
          paid: Number(s.amount_paid),
          balance: Number(s.balance),
        })),
        emptyText: 'Everyone charged has paid this fund in full.',
      },
    ],
  });
}

// ───────────────────────────── student statement ─────────────────────────────

export async function studentStatement(ctx: ReportContext, studentId: string): Promise<ReportDoc> {
  const student = await prisma.student.findFirst({ where: { id: studentId, academicYearId: ctx.ay.id }, include: { program: true, section: true } });
  if (!student) throw notFound('Student not found in this academic year.');
  const [account, payments] = await Promise.all([
    studentCharges(ctx.ay.id, student.id, canSeeConfidential(ctx.perms)),
    prisma.payment.findMany({
      where: { studentId: student.id, academicYearId: ctx.ay.id },
      include: { allocations: { include: { charge: { include: { fund: true } } } } },
      orderBy: { receivedAt: 'asc' },
    }),
  ]);
  const cys = `${student.program.code} ${student.yearLevel}${student.section ? `-${student.section.name}` : ''}`;
  return base('student-statement', ctx, {
    subtitle: `${formatPersonName(student)} · ${student.studentNumber} · ${cys}`,
    filters: [],
    summary: [
      { label: 'Status', value: account.isCleared ? 'Cleared' : 'Has balance' },
      { label: 'Total charged', value: account.totals.due, type: 'money' },
      { label: 'Total paid', value: account.totals.paid, type: 'money' },
      { label: 'Balance', value: account.totals.balance, type: 'money' },
    ],
    tables: [
      {
        title: 'Charges',
        columns: [
          { key: 'fund', label: 'Fund' },
          { key: 'kind', label: 'Type' },
          { key: 'due', label: 'Due', type: 'money' },
          { key: 'paid', label: 'Paid', type: 'money' },
          { key: 'balance', label: 'Balance', type: 'money' },
          { key: 'status', label: 'Status' },
        ],
        rows: account.charges.map((c) => ({
          fund: c.fundName,
          kind: c.isMandatory ? 'Mandatory' : 'Optional',
          due: c.amountDue,
          paid: c.amountPaid,
          balance: c.balance,
          status: { paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid' }[c.status],
        })),
        totals: { fund: 'Total', due: account.totals.due, paid: account.totals.paid, balance: account.totals.balance },
        emptyText: 'No charges.',
      },
      {
        title: 'Payments',
        primary: true,
        columns: [
          { key: 'transactionNo', label: 'Transaction no.' },
          { key: 'receivedAt', label: 'Date and time', type: 'datetime' },
          { key: 'split', label: 'Applied to' },
          { key: 'amount', label: 'Amount', type: 'money' },
          { key: 'status', label: 'Status' },
          { key: 'processedByName', label: 'Processed by' },
        ],
        rows: payments.map((p) => ({
          transactionNo: p.transactionNo,
          receivedAt: p.receivedAt.toISOString(),
          split: [...p.allocations]
            .sort((a, b) => a.charge.fund.priority - b.charge.fund.priority)
            .map((a) => `${fundLabelFor(ctx.perms, a.charge.fund)} ${(Number(a.amount) / 100).toFixed(2)}`)
            .join('; '),
          amount: Number(p.amount),
          status: p.status === 'voided' ? `Voided${p.voidReason ? `: ${p.voidReason}` : ''}` : 'Posted',
          processedByName: p.processedByName,
        })),
        totals: { transactionNo: 'Total paid', amount: payments.filter((p) => p.status === 'posted').reduce((s, p) => s + Number(p.amount), 0) },
        emptyText: 'No payments yet.',
      },
    ],
    notes: canSeeConfidential(ctx.perms) ? [] : ['Charges for restricted funds are shown as "Restricted fund".'],
  });
}

// ───────────────────────────── cleared / has-balance list ─────────────────────────────

export async function clearanceReport(ctx: ReportContext, f: z.infer<typeof clearanceFilterSchema>): Promise<ReportDoc> {
  const c: Prisma.Sql[] = [Prisma.sql`s.academic_year_id = ${ctx.ay.id}::uuid`, Prisma.sql`s.status = 'active'`];
  if (f.programId) c.push(Prisma.sql`s.program_id = ${f.programId}::uuid`);
  if (f.yearLevel) c.push(Prisma.sql`s.year_level = ${f.yearLevel}`);
  if (f.sectionId) c.push(Prisma.sql`s.section_id = ${f.sectionId}::uuid`);
  if (f.status === 'cleared') c.push(Prisma.sql`v.is_cleared`);
  if (f.status === 'has_balance') c.push(Prisma.sql`NOT v.is_cleared`);
  if (f.q) {
    const q = `%${f.q.replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
    c.push(Prisma.sql`(s.student_number ILIKE ${q} OR s.first_name ILIKE ${q} OR s.last_name ILIKE ${q})`);
  }
  const where = Prisma.join(c, ' AND ');
  const [rows, [counts], names] = await Promise.all([
    prisma.$queryRaw<{ student_number: string; first_name: string; middle_name: string | null; last_name: string; suffix: string | null; code: string; year_level: number; section: string | null; total_due: bigint; total_paid: bigint; total_balance: bigint; is_cleared: boolean }[]>`
      SELECT s.student_number, s.first_name, s.middle_name, s.last_name, s.suffix, pr.code, s.year_level, se.name AS section,
             v.total_due, v.total_paid, v.total_balance, v.is_cleared
      FROM students s
      JOIN v_student_clearance v ON v.student_id = s.id
      JOIN programs pr ON pr.id = s.program_id
      LEFT JOIN sections se ON se.id = s.section_id
      WHERE ${where}
      ORDER BY pr.code, s.year_level, se.name NULLS FIRST, s.last_name, s.first_name
      LIMIT ${REPORT_ROW_LIMIT}`,
    prisma.$queryRaw<{ total: bigint; cleared: bigint; balance: bigint | null }[]>`
      SELECT count(*) AS total, count(*) FILTER (WHERE v.is_cleared) AS cleared, sum(v.total_balance) AS balance
      FROM students s JOIN v_student_clearance v ON v.student_id = s.id
      WHERE ${where}`,
    lookups(ctx.ay.id, f),
  ]);
  const total = Number(counts!.total);
  const cleared = Number(counts!.cleared);
  const filters: { label: string; value: string }[] = [
    { label: 'Students', value: { all: 'Cleared and with balance', cleared: 'Cleared only', has_balance: 'With balance only' }[f.status] },
  ];
  if (names.program) filters.push({ label: 'Program', value: names.program.code });
  if (f.yearLevel) filters.push({ label: 'Year level', value: String(f.yearLevel) });
  if (names.section) filters.push({ label: 'Section', value: `${names.section.program.code} ${names.section.yearLevel}-${names.section.name}` });
  if (f.q) filters.push({ label: 'Search', value: f.q });

  return base('clearance', ctx, {
    filters,
    summary: [
      { label: 'Students', value: total, type: 'number' },
      { label: 'Cleared', value: cleared, type: 'number' },
      { label: 'Has balance', value: total - cleared, type: 'number' },
      { label: 'Total balance', value: Number(counts!.balance ?? 0), type: 'money' },
    ],
    tables: [
      {
        title: 'Students',
        primary: true,
        columns: [
          { key: 'studentNumber', label: 'Student no.' },
          { key: 'name', label: 'Name' },
          { key: 'courseYearSection', label: 'Course/yr/sec' },
          { key: 'due', label: 'Charged', type: 'money' },
          { key: 'paid', label: 'Paid', type: 'money' },
          { key: 'balance', label: 'Balance', type: 'money' },
          { key: 'status', label: 'Status' },
        ],
        rows: rows.map((s) => ({
          studentNumber: s.student_number,
          name: formatPersonName({ firstName: s.first_name, middleName: s.middle_name, lastName: s.last_name, suffix: s.suffix }),
          courseYearSection: `${s.code} ${s.year_level}${s.section ? `-${s.section}` : ''}`,
          due: Number(s.total_due),
          paid: Number(s.total_paid),
          balance: Number(s.total_balance),
          status: s.is_cleared ? 'Cleared' : 'Has balance',
        })),
        emptyText: 'No students match.',
      },
    ],
    notes: ['Cleared means every mandatory charge is paid in full; optional funds never block clearance. Balances include optional and restricted funds.'],
    truncatedAt: total > REPORT_ROW_LIMIT ? REPORT_ROW_LIMIT : undefined,
  });
}

// ───────────────────────────── liquidation report ─────────────────────────────

const LIQUIDATION_STATUS: Record<string, string> = { submitted: 'Waiting for review', revision_requested: 'Revision requested', approved: 'Approved' };

/**
 * How one fund request's money was spent: every receipt with its items and totals, against the
 * approved amount. The receipts themselves (photos and PDFs) are printed on the last pages,
 * labelled R-1, R-2… like the tables, so each line can be checked against its receipt.
 */
export async function liquidationReport(ctx: ReportContext, requestId: string): Promise<ReportDoc> {
  const r = await prisma.fundRequest.findFirst({ where: { id: requestId, academicYearId: ctx.ay.id }, include: requestInclude });
  if (!r || !(await canViewRequest(ctx.ay.id, { userId: ctx.userId, perms: ctx.perms }, r))) throw notFound('Request not found.');
  const l = r.liquidations.at(-1);
  if (!l) throw conflict('NO_LIQUIDATION', `${r.requestNo} has no liquidation yet.`);

  const approved = Number(l.approvedAmount);
  const used = Number(l.fundUsed);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const entries = l.entries;
  const charged = l.chargedAmount === null ? null : Number(l.chargedAmount);
  const absorbed = charged !== null && used > charged ? used - charged : 0;
  const owed = l.settlementKind ? Number(l.settlementAmount) : 0;
  // a moment, shown as its day in the AY's time zone
  const when = (d: Date) => formatReportCell(d.toISOString(), 'date', ctx.settings.timezone);
  const settledBy = l.settledByName ? `${l.settledByName}${l.settledByDesignation ? ` (${l.settledByDesignation})` : ''}` : '';
  // the line that says what happened to the difference between the cash advance and what was used
  const difference =
    l.settlementKind === 'reimburse'
      ? { label: l.settledAt ? `Excess reimbursed to ${r.requestorName}` : 'Reimbursement due to the requestor', value: owed, type: 'money' as const }
      : l.settlementKind === 'return'
        ? { label: l.settledAt ? 'Change returned by the requestor' : 'Change to return', value: owed, type: 'money' as const }
        : absorbed
          ? { label: 'Excess absorbed by the requestor', value: absorbed, type: 'money' as const }
          : used <= approved
            ? { label: 'Unused (to return)', value: approved - used, type: 'money' as const }
            : { label: 'Over the approved amount', value: used - approved, type: 'money' as const };
  const settlementNote = !l.settlementKind
    ? absorbed
      ? [`Only the approved amount was charged to the fund; ${r.requestorName} absorbed the excess of PHP ${centavosPlain(absorbed)}.`]
      : []
    : l.settledAt
      ? [
          l.settlementKind === 'reimburse'
            ? `PHP ${centavosPlain(owed)} was reimbursed to ${r.requestorName} on ${when(l.settledAt)}, paid by ${settledBy}.`
            : `${r.requestorName} returned the change of PHP ${centavosPlain(owed)} on ${when(l.settledAt)}, received by ${settledBy}.`,
          ...(l.settlementNote ? [`Settlement note: ${l.settlementNote}`] : []),
        ]
      : [
          l.settlementKind === 'reimburse'
            ? `Not yet settled: PHP ${centavosPlain(owed)} is still to be reimbursed to ${r.requestorName}.`
            : `Not yet settled: ${r.requestorName} still has to return the change of PHP ${centavosPlain(owed)}.`,
        ];

  return base('liquidation', ctx, {
    subtitle: `${r.requestNo} · ${r.fundNameSnapshot}`,
    filters: [
      { label: 'Purpose', value: r.purpose },
      { label: 'Date of use', value: formatReportCell(day(r.useAt), 'date', ctx.settings.timezone) },
      { label: 'Requested by', value: `${r.requestorName}${r.requestorDesignation ? ` (${r.requestorDesignation})` : ''}` },
      { label: 'Liquidation', value: `Version ${l.version} · ${LIQUIDATION_STATUS[l.status] ?? l.status}` },
    ],
    summary: [
      { label: 'Cash advance (approved)', value: approved, type: 'money' },
      { label: 'Total liquidated', value: used, type: 'money' },
      ...(absorbed ? [{ label: 'Charged to the fund', value: charged!, type: 'money' as const }] : []),
      difference,
      { label: 'Receipts', value: entries.length, type: 'number' },
    ],
    tables: [
      {
        title: 'Summary of receipts',
        primary: true,
        columns: [
          { key: 'ref', label: 'Ref.' },
          { key: 'receiptDate', label: 'Date', type: 'date' },
          { key: 'receiptNo', label: 'OR / receipt no.' },
          { key: 'payee', label: 'Store / payee' },
          { key: 'usedFor', label: 'Used for' },
          { key: 'items', label: 'Items', type: 'number' },
          { key: 'total', label: 'Total', type: 'money' },
        ],
        rows: entries.map((e) => ({
          ref: e.hasReceipt ? receiptRef(e.sortOrder) : 'Other',
          receiptDate: e.hasReceipt ? day(e.receiptDate) : null,
          receiptNo: e.hasReceipt ? e.receiptNo : 'No receipt',
          payee: e.payee,
          usedFor: e.usedFor,
          items: e.items.length,
          total: Number(e.total),
        })),
        totals: { ref: 'Total', total: used },
        emptyText: 'No receipts.',
      },
      ...entries.map((e): ReportTable =>
        !e.hasReceipt
          ? {
              // costs without a receipt (gas, fares, ...): just the item and its cost
              title: 'Other expenses (no receipt)',
              columns: [
                { key: 'description', label: 'Item' },
                { key: 'amount', label: 'Cost', type: 'money' },
              ],
              rows: e.items.map((i) => ({ description: i.description, amount: Number(i.amount) })),
              totals: { description: 'Other expenses total', amount: Number(e.total) },
            }
          : {
              title: [`${receiptRef(e.sortOrder)} · ${e.usedFor}`, e.payee, e.receiptNo && `OR ${e.receiptNo}`, formatReportCell(day(e.receiptDate), 'date', ctx.settings.timezone)]
                .filter(Boolean)
                .join(' · '),
              columns: [
                { key: 'n', label: '#', type: 'number' },
                { key: 'description', label: 'Item' },
                { key: 'quantity', label: 'Qty', type: 'number' },
                { key: 'unitCost', label: 'Unit cost', type: 'money' },
                { key: 'amount', label: 'Amount', type: 'money' },
              ],
              rows: e.items.map((i) => ({ n: i.sortOrder, description: i.description, quantity: i.quantity, unitCost: Number(i.unitCost), amount: Number(i.amount) })),
              totals: { description: `${receiptRef(e.sortOrder)} total`, amount: Number(e.total) },
            },
      ),
    ],
    notes: [
      ...(l.remarks ? [`Remarks: ${l.remarks}`] : []),
      ...settlementNote,
      ...(entries.some((e) => e.attachments.length) ? ['The receipts are on the last pages, labelled R-1, R-2… as in the tables above.'] : []),
    ],
    signatories: [
      { label: 'Prepared by', name: l.submittedByName, title: l.submittedByDesignation },
      { label: 'Approved by', name: l.approvedByName ?? '', title: l.approvedByDesignation ?? '' },
      // whoever received the money signs for it: the requestor for a reimbursement, the treasurer for returned change
      ...(l.settlementKind === 'reimburse' ? [{ label: 'Reimbursement received by', name: r.requestorName, title: r.requestorDesignation ?? '' }] : []),
      ...(l.settlementKind === 'return' ? [{ label: 'Change received by', name: l.settledByName ?? '', title: l.settledByDesignation ?? '' }] : []),
    ],
    annex: {
      title: 'Receipts',
      groups: [
        ...entries
          .filter((e) => e.attachments.length)
          .map((e) => ({
            ref: receiptRef(e.sortOrder),
            caption: [e.usedFor, e.payee, e.receiptNo && `OR ${e.receiptNo}`, formatReportCell(day(e.receiptDate), 'date', ctx.settings.timezone), `PHP ${centavosPlain(Number(e.total))}`]
              .filter(Boolean)
              .join(' · '),
            files: e.attachments.map((a) => ({ url: `/api/files/${a.file.id}`, name: a.file.originalName, mimeType: a.file.mimeType })),
          })),
        ...(l.settlementFile && l.settledAt
          ? [
              {
                ref: 'Settlement',
                caption: `${l.settlementKind === 'reimburse' ? 'Reimbursement' : 'Returned change'} acknowledgment · PHP ${centavosPlain(owed)} · ${when(l.settledAt)}`,
                files: [{ url: `/api/files/${l.settlementFile.id}`, name: l.settlementFile.originalName, mimeType: l.settlementFile.mimeType }],
              },
            ]
          : []),
      ],
    },
  });
}
