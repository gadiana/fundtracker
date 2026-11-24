import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { FUND_REQUEST_STATUS_LABELS, type collectionFilterSchema, type Permission, type usageFilterSchema } from '@sft/shared';
import { prisma } from '../../db';
import { canSeeConfidential } from '../../lib/confidential';
import { forbidden } from '../../lib/http';
import { endOfDayExclusive, startOfDay } from '../../lib/time';

export type CollectionFilter = z.infer<typeof collectionFilterSchema>;
export type UsageFilter = z.infer<typeof usageFilterSchema>;

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// ───────────────────────────── collections ─────────────────────────────

/** WHERE clause over payments p (joined to students s) for the collection history and report. */
export function collectionWhere(academicYearId: string, f: CollectionFilter, timeZone: string) {
  const c: Prisma.Sql[] = [Prisma.sql`p.academic_year_id = ${academicYearId}::uuid`];
  if (f.from) c.push(Prisma.sql`p.received_at >= ${startOfDay(f.from, timeZone)}`);
  if (f.to) c.push(Prisma.sql`p.received_at < ${endOfDayExclusive(f.to, timeZone)}`);
  if (f.status !== 'all') c.push(Prisma.sql`p.status = ${f.status}::payment_status`);
  if (f.processedById) c.push(Prisma.sql`p.processed_by = ${f.processedById}::uuid`);
  // course/year/section filters follow where the student is now
  if (f.programId) c.push(Prisma.sql`s.program_id = ${f.programId}::uuid`);
  if (f.yearLevel) c.push(Prisma.sql`s.year_level = ${f.yearLevel}`);
  if (f.sectionId) c.push(Prisma.sql`s.section_id = ${f.sectionId}::uuid`);
  if (f.q) {
    const q = like(f.q);
    c.push(Prisma.sql`(p.transaction_no ILIKE ${q} OR p.student_name_snapshot ILIKE ${q} OR p.student_number_snapshot ILIKE ${q})`);
  }
  return Prisma.join(c, ' AND ');
}

export interface CollectionRow {
  id: string;
  transactionNo: string;
  receivedAt: Date;
  studentName: string;
  studentNumber: string;
  courseYearSection: string;
  amount: number;
  balanceAfter: number;
  status: 'posted' | 'voided';
  processedByName: string;
  voidReason: string | null;
}

export async function collectionRows(where: Prisma.Sql, page: { limit: number; offset: number }) {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      transaction_no: string;
      received_at: Date;
      student_name_snapshot: string;
      student_number_snapshot: string;
      program_snapshot: string;
      year_level_snapshot: number;
      section_snapshot: string | null;
      amount: bigint;
      balance_after: bigint;
      status: 'posted' | 'voided';
      processed_by_name: string;
      void_reason: string | null;
    }[]
  >`SELECT p.id, p.transaction_no, p.received_at, p.student_name_snapshot, p.student_number_snapshot, p.program_snapshot,
           p.year_level_snapshot, p.section_snapshot, p.amount, p.balance_after, p.status, p.processed_by_name, p.void_reason
    FROM payments p JOIN students s ON s.id = p.student_id
    WHERE ${where}
    ORDER BY p.received_at DESC, p.transaction_no DESC
    LIMIT ${page.limit} OFFSET ${page.offset}`;
  return rows.map(
    (r): CollectionRow => ({
      id: r.id,
      transactionNo: r.transaction_no,
      receivedAt: r.received_at,
      studentName: r.student_name_snapshot,
      studentNumber: r.student_number_snapshot,
      courseYearSection: `${r.program_snapshot} ${r.year_level_snapshot}${r.section_snapshot ? `-${r.section_snapshot}` : ''}`,
      amount: Number(r.amount),
      balanceAfter: Number(r.balance_after),
      status: r.status,
      processedByName: r.processed_by_name,
      voidReason: r.void_reason,
    }),
  );
}

export async function collectionTotals(where: Prisma.Sql) {
  const [t] = await prisma.$queryRaw<{ count: bigint; posted_count: bigint; posted: bigint | null; voided_count: bigint; voided: bigint | null }[]>`
    SELECT count(*) AS count,
           count(*) FILTER (WHERE p.status = 'posted') AS posted_count,
           sum(p.amount) FILTER (WHERE p.status = 'posted') AS posted,
           count(*) FILTER (WHERE p.status = 'voided') AS voided_count,
           sum(p.amount) FILTER (WHERE p.status = 'voided') AS voided
    FROM payments p JOIN students s ON s.id = p.student_id
    WHERE ${where}`;
  return {
    count: Number(t!.count),
    postedCount: Number(t!.posted_count),
    posted: Number(t!.posted ?? 0),
    voidedCount: Number(t!.voided_count),
    voided: Number(t!.voided ?? 0),
  };
}

/** Posted money per fund; confidential funds merge into one "Restricted funds" line for viewers who may not see them. */
export async function collectionByFund(where: Prisma.Sql, perms: Permission[]) {
  const rows = await prisma.$queryRaw<{ fund_name: string; is_confidential: boolean; priority: number; amount: bigint; payments: bigint }[]>`
    SELECT f.name AS fund_name, f.is_confidential, f.priority, sum(a.amount) AS amount, count(DISTINCT p.id) AS payments
    FROM payments p
    JOIN students s ON s.id = p.student_id
    JOIN payment_allocations a ON a.payment_id = p.id
    JOIN student_charges c ON c.id = a.charge_id
    JOIN funds f ON f.id = c.fund_id
    WHERE ${where} AND p.status = 'posted'
    GROUP BY f.id, f.name, f.is_confidential, f.priority
    ORDER BY f.priority`;
  const out: { fund: string; amount: number; payments: number }[] = [];
  let restricted: { fund: string; amount: number; payments: number } | null = null;
  for (const r of rows) {
    if (r.is_confidential && !canSeeConfidential(perms)) {
      restricted ??= { fund: 'Restricted funds', amount: 0, payments: 0 };
      restricted.amount += Number(r.amount);
      restricted.payments += Number(r.payments);
    } else out.push({ fund: r.fund_name, amount: Number(r.amount), payments: Number(r.payments) });
  }
  return restricted ? [...out, restricted] : out;
}

export async function collectionByStaff(where: Prisma.Sql) {
  const rows = await prisma.$queryRaw<{ name: string; count: bigint; amount: bigint }[]>`
    SELECT p.processed_by_name AS name, count(*) AS count, sum(p.amount) AS amount
    FROM payments p JOIN students s ON s.id = p.student_id
    WHERE ${where} AND p.status = 'posted'
    GROUP BY p.processed_by_name ORDER BY amount DESC`;
  return rows.map((r) => ({ name: r.name, count: Number(r.count), amount: Number(r.amount) }));
}

export async function collectionByDay(where: Prisma.Sql, timeZone: string) {
  const rows = await prisma.$queryRaw<{ day: Date; count: bigint; amount: bigint }[]>`
    SELECT (p.received_at AT TIME ZONE ${timeZone})::date AS day, count(*) AS count, sum(p.amount) AS amount
    FROM payments p JOIN students s ON s.id = p.student_id
    WHERE ${where} AND p.status = 'posted'
    GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), count: Number(r.count), amount: Number(r.amount) }));
}

// ───────────────────────────── fund usage ─────────────────────────────

/**
 * Who may see the use-of-fund history: the adviser and extra approvers see every request
 * (of funds they may see); anyone else who may file requests sees their own.
 */
export async function usageScope(academicYearId: string, userId: string, perms: Permission[]) {
  if (perms.includes('manage')) return { all: true };
  const approver = await prisma.ayApprover.findUnique({ where: { academicYearId_userId: { academicYearId, userId } } });
  if (approver) return { all: true };
  if (perms.includes('file_requests')) return { all: false };
  throw forbidden('Only the adviser, approvers and positions that file requests can see the use of funds.');
}

export function usageWhere(academicYearId: string, f: UsageFilter, timeZone: string, perms: Permission[], scope: { all: boolean }, userId: string) {
  const c: Prisma.Sql[] = [Prisma.sql`r.academic_year_id = ${academicYearId}::uuid`];
  if (!canSeeConfidential(perms)) c.push(Prisma.sql`f.is_confidential = false`);
  if (!scope.all) c.push(Prisma.sql`r.requestor_id = ${userId}::uuid`);
  if (f.from) c.push(Prisma.sql`r.submitted_at >= ${startOfDay(f.from, timeZone)}`);
  if (f.to) c.push(Prisma.sql`r.submitted_at < ${endOfDayExclusive(f.to, timeZone)}`);
  if (f.fundId) c.push(Prisma.sql`r.fund_id = ${f.fundId}::uuid`);
  if (f.status) c.push(Prisma.sql`r.status = ${f.status}::fund_request_status`);
  if (f.q) {
    const q = like(f.q);
    c.push(Prisma.sql`(r.request_no ILIKE ${q} OR r.requestor_name ILIKE ${q} OR r.purpose ILIKE ${q})`);
  }
  return Prisma.join(c, ' AND ');
}

const USAGE_FROM = Prisma.sql`
  FROM fund_requests r
  JOIN funds f ON f.id = r.fund_id
  LEFT JOIN LATERAL (
    SELECT lr.submitted_at, lr.approved_at, lr.approved_by_name, COALESCE(lr.charged_amount, lr.fund_used) AS fund_used, lr.status
    FROM liquidation_receipts lr WHERE lr.fund_request_id = r.id ORDER BY lr.version DESC LIMIT 1
  ) l ON true`;

export interface UsageRow {
  id: string;
  requestNo: string;
  requestorName: string;
  requestorDesignation: string;
  fundName: string;
  purpose: string;
  amount: number;
  fundUsed: number | null;
  submittedAt: Date;
  useAt: Date;
  approvedAt: Date | null;
  approvedByName: string | null;
  receiptSubmittedAt: Date | null;
  receiptApprovedAt: Date | null;
  receiptApprovedByName: string | null;
  status: string;
  statusLabel: string;
  archived: boolean;
}

export async function usageRows(where: Prisma.Sql, page: { limit: number; offset: number }) {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      request_no: string;
      requestor_name: string;
      requestor_designation: string;
      fund_name_snapshot: string;
      purpose: string;
      amount_requested: bigint;
      submitted_at: Date;
      use_at: Date;
      approved_at: Date | null;
      approved_by_name: string | null;
      status: keyof typeof FUND_REQUEST_STATUS_LABELS;
      archived_at: Date | null;
      receipt_submitted_at: Date | null;
      receipt_approved_at: Date | null;
      receipt_approved_by: string | null;
      fund_used: bigint | null;
    }[]
  >`SELECT r.id, r.request_no, r.requestor_name, r.requestor_designation, r.fund_name_snapshot, r.purpose, r.amount_requested,
           r.submitted_at, r.use_at, r.approved_at, r.approved_by_name, r.status, r.archived_at,
           l.submitted_at AS receipt_submitted_at, l.approved_at AS receipt_approved_at, l.approved_by_name AS receipt_approved_by, l.fund_used
    ${USAGE_FROM}
    WHERE ${where}
    ORDER BY r.submitted_at DESC
    LIMIT ${page.limit} OFFSET ${page.offset}`;
  return rows.map(
    (r): UsageRow => ({
      id: r.id,
      requestNo: r.request_no,
      requestorName: r.requestor_name,
      requestorDesignation: r.requestor_designation,
      fundName: r.fund_name_snapshot,
      purpose: r.purpose,
      amount: Number(r.amount_requested),
      fundUsed: (r.status === 'cleared' || r.status === 'settlement_due') && r.fund_used !== null ? Number(r.fund_used) : null,
      submittedAt: r.submitted_at,
      useAt: r.use_at,
      approvedAt: r.approved_at,
      approvedByName: r.approved_by_name,
      receiptSubmittedAt: r.receipt_submitted_at,
      receiptApprovedAt: r.receipt_approved_at,
      receiptApprovedByName: r.receipt_approved_by,
      status: r.status,
      statusLabel: FUND_REQUEST_STATUS_LABELS[r.status],
      archived: Boolean(r.archived_at),
    }),
  );
}

export async function usageTotals(where: Prisma.Sql) {
  const [t] = await prisma.$queryRaw<{ count: bigint; requested: bigint | null; reserved: bigint | null; used: bigint | null; cleared: bigint }[]>`
    SELECT count(*) AS count,
           sum(r.amount_requested) FILTER (WHERE r.status NOT IN ('pending', 'rejected', 'canceled')) AS requested,
           sum(r.amount_requested) FILTER (WHERE r.status IN ('approved', 'receipt_submitted', 'revision_requested')) AS reserved,
           sum(l.fund_used) FILTER (WHERE r.status IN ('settlement_due', 'cleared')) AS used,
           count(*) FILTER (WHERE r.status = 'cleared') AS cleared
    ${USAGE_FROM}
    WHERE ${where}`;
  return {
    count: Number(t!.count),
    approved: Number(t!.requested ?? 0),
    reserved: Number(t!.reserved ?? 0),
    used: Number(t!.used ?? 0),
    cleared: Number(t!.cleared),
  };
}

export async function usageByFund(where: Prisma.Sql) {
  const rows = await prisma.$queryRaw<{ fund: string; requests: bigint; used: bigint | null; reserved: bigint | null }[]>`
    SELECT r.fund_name_snapshot AS fund, count(*) AS requests,
           sum(l.fund_used) FILTER (WHERE r.status IN ('settlement_due', 'cleared')) AS used,
           sum(r.amount_requested) FILTER (WHERE r.status IN ('approved', 'receipt_submitted', 'revision_requested')) AS reserved
    ${USAGE_FROM}
    WHERE ${where}
    GROUP BY r.fund_name_snapshot ORDER BY used DESC NULLS LAST`;
  return rows.map((r) => ({ fund: r.fund, requests: Number(r.requests), used: Number(r.used ?? 0), reserved: Number(r.reserved ?? 0) }));
}
