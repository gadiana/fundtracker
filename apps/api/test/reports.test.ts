import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AcademicYear } from '@prisma/client';
import type { ReportDoc } from '@sft/shared';
import { prisma } from '../src/db';
import { createProgram, sectionFor } from './fixtures';
import { createAy, expectStatus, oneReceipt, pngBuffer, registerAndLogin, resetDb, type Client } from './helpers';

let ay: AcademicYear;
let adviser: Client;
let collector: Client;
let president: Client;
let studentFee: string;
let insurance: string;
const students: Record<string, string> = {};

async function approve(email: string, designationId: string, names: [string, string]) {
  const c = await registerAndLogin(email, undefined, names);
  const pending = (await adviser.get('/members?status=pending')).body.items.find((m: { user: { email: string } }) => m.user.email === email);
  expectStatus(await adviser.post(`/members/${pending.id}/approve`, { designationId }), 200);
  return c;
}

const pay = async (who: Client, student: string, amount: number) =>
  expectStatus(await who.post('/payments', { idempotencyKey: randomUUID(), studentId: students[student], amount }), 201).body.receipt;

const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
const manilaDay = (days: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(Date.now() + days * 86_400_000));

const table = (doc: ReportDoc, title: string) => doc.tables.find((t) => t.title === title)!;
const summary = (doc: ReportDoc, label: string) => doc.summary.find((s) => s.label === label)!.value;

beforeEach(async () => {
  await resetDb();
  const created = await createAy(2026);
  ay = created.ay;
  await prisma.aySetting.update({ where: { academicYearId: ay.id }, data: { reportPreparedByName: 'Carla Treasurer', reportPreparedByTitle: 'Treasurer', reportNotedByName: 'Maria Santos', reportPaperSize: 'LETTER' } });
  const bsit = await createProgram(ay.id, 'BSIT');
  const bscs = await createProgram(ay.id, 'BSCS');
  adviser = await registerAndLogin('adviser@test.ph', undefined, ['Maria', 'Santos']);
  collector = await approve('collector@test.ph', created.designations.collector.id, ['Carlo', 'Reyes']);
  president = await approve('president@test.ph', created.designations.president.id, ['Paolo', 'Lim']);

  const fund = async (name: string, amount: number, isConfidential: boolean) =>
    expectStatus(await adviser.post('/funds', { name, amountPerStudent: amount, isMandatory: true, isConfidential, yearLevels: [1, 2], allPrograms: true }), 201).body.fund.id;
  studentFee = await fund('Student Fee', 50_000, false);
  insurance = await fund('Insurance', 15_000, true);

  for (const [number, first, last, programId, yearLevel] of [
    ['1001', 'Ana', 'Cruz', bsit.id, 1],
    ['1002', 'Ben', 'Abad', bsit.id, 2],
    ['2001', 'Cara', 'Bello', bscs.id, 1],
  ] as const) {
    students[number] = expectStatus(await collector.post('/students', { studentNumber: number, firstName: first, lastName: last, programId, yearLevel, sectionId: (await sectionFor(ay.id, programId, yearLevel)).id }), 201).body.id;
  }
  // Ana pays everything, Ben pays part of Student Fee, Cara's payment is voided
  await pay(collector, '1001', 65_000);
  await pay(adviser, '1002', 20_000);
  const voided = await pay(collector, '2001', 10_000);
  expectStatus(await adviser.post(`/payments/${voided.id}/void`, { reason: 'Wrong student' }), 200);
});

describe('collection history', () => {
  it('lists every payment with its snapshot details, and totals only posted ones', async () => {
    const res = expectStatus(await collector.get('/history/collections'), 200).body;
    expect(res.total).toBe(3);
    expect(res.totals).toMatchObject({ postedCount: 2, posted: 85_000, voidedCount: 1, voided: 10_000 });
    expect(res.items[0]).toMatchObject({ studentName: 'Cara Bello', courseYearSection: 'BSCS 1-A', status: 'voided', voidReason: 'Wrong student', processedByName: 'Carlo Reyes' });
    expect(res.items.map((i: { transactionNo: string }) => i.transactionNo)).toEqual([...res.items.map((i: { transactionNo: string }) => i.transactionNo)].sort().reverse());
  });

  it('filters by search, program, status, staff and Manila calendar dates', async () => {
    const count = async (qs: string) => expectStatus(await collector.get(`/history/collections?${qs}`), 200).body.total;
    expect(await count('q=abad')).toBe(1);
    expect(await count('q=1001')).toBe(1);
    const bsit = await prisma.program.findFirstOrThrow({ where: { code: 'BSIT' } });
    expect(await count(`programId=${bsit.id}`)).toBe(2);
    expect(await count('status=voided')).toBe(1);
    const carlo = await prisma.user.findUniqueOrThrow({ where: { email: 'collector@test.ph' } });
    expect(await count(`processedById=${carlo.id}`)).toBe(2);
    expect(await count(`from=${manilaToday()}&to=${manilaToday()}`)).toBe(3);
    expect(await count(`to=${manilaDay(-1)}`)).toBe(0);
    expect(await count(`from=${manilaDay(1)}`)).toBe(0);
    const page = expectStatus(await collector.get('/history/collections?pageSize=2&page=2'), 200).body;
    expect(page.items).toHaveLength(1);
  });

  it('is for positions that collect', async () => {
    expect((await president.get('/history/collections')).status).toBe(403);
    expect((await president.get('/reports/collections')).status).toBe(403);
  });
});

describe('collection report', () => {
  it('breaks money down per fund, day and staff, merging restricted funds for those who may not see them', async () => {
    const forAdviser: ReportDoc = expectStatus(await adviser.get('/reports/collections'), 200).body;
    expect(summary(forAdviser, 'Total collected')).toBe(85_000);
    expect(table(forAdviser, 'Collected per fund').rows).toEqual([
      { fund: 'Student Fee', amount: 70_000, payments: 2 },
      { fund: 'Insurance', amount: 15_000, payments: 1 },
    ]);
    expect(table(forAdviser, 'Per day').rows).toEqual([{ day: manilaToday(), count: 2, amount: 85_000 }]);
    expect(table(forAdviser, 'Transactions').rows).toHaveLength(3);
    expect(forAdviser.signatories).toEqual([
      { label: 'Prepared by', name: 'Carla Treasurer', title: 'Treasurer' },
      { label: 'Noted by', name: 'Maria Santos', title: 'Adviser' },
    ]);
    expect(forAdviser).toMatchObject({ paperSize: 'LETTER', header: { orgName: 'Sample Student Organization', academicYear: '2026-2027' } });

    const forCollector: ReportDoc = expectStatus(await collector.get('/reports/collections'), 200).body;
    expect(table(forCollector, 'Collected per fund').rows).toEqual([
      { fund: 'Student Fee', amount: 70_000, payments: 2 },
      { fund: 'Restricted funds', amount: 15_000, payments: 1 },
    ]);
    expect(JSON.stringify(forCollector)).not.toContain('Insurance');
    expect(forCollector.notes.join(' ')).toContain('restricted');
  });
});

describe('use-of-fund history and usage report', () => {
  async function clearedRequest() {
    const file = expectStatus(await president.upload('/uploads', pngBuffer(), 'doc.png'), 201).body.id;
    const r = expectStatus(
      await president.post('/fund-requests', { fundId: studentFee, amount: 30_000, purpose: 'Printing', useAt: `${manilaDay(3)}T12:00:00+08:00`, attachmentIds: [file] }),
      201,
    ).body;
    expectStatus(await adviser.post(`/fund-requests/${r.id}/approve`), 200);
    const receipt = expectStatus(await president.upload('/uploads', pngBuffer(), 'or.png'), 201).body.id;
    expectStatus(await president.post(`/fund-requests/${r.id}/liquidations`, oneReceipt(27_550, [receipt])), 201);
    const lid = (await prisma.liquidationReceipt.findFirstOrThrow({ where: { fundRequestId: r.id } })).id;
    expectStatus(await adviser.post(`/fund-requests/${r.id}/liquidations/${lid}/approve`, {}), 200);
    // the change of ₱24.50 is returned to the treasurer
    expectStatus(await adviser.post(`/fund-requests/${r.id}/settle`, {}), 200);
    return r.id as string;
  }

  it('shows every date and name of a request’s life', async () => {
    await clearedRequest();
    const row = expectStatus(await adviser.get('/history/fund-usage'), 200).body.items[0];
    expect(row).toMatchObject({ requestNo: 'FR-0001', requestorName: 'Paolo Lim', requestorDesignation: 'President', amount: 30_000, fundUsed: 27_550, approvedByName: 'Maria Santos', receiptApprovedByName: 'Maria Santos', status: 'cleared' });
    for (const k of ['submittedAt', 'useAt', 'approvedAt', 'receiptSubmittedAt', 'receiptApprovedAt']) expect(row[k]).toBeTruthy();

    const doc: ReportDoc = expectStatus(await adviser.get('/reports/fund-usage'), 200).body;
    expect(summary(doc, 'Used (cleared)')).toBe(27_550);
    expect(table(doc, 'Per fund').rows).toEqual([{ fund: 'Student Fee', requests: 1, used: 27_550, reserved: 0 }]);
  });

  it('shows requestors only their own requests, and nothing to positions that neither file nor approve', async () => {
    await clearedRequest();
    const other = await prisma.fundRequest.findFirstOrThrow();
    await prisma.fundRequest.create({
      data: { ...other, id: randomUUID(), requestNo: 'FR-0099', requestorId: (await prisma.user.findUniqueOrThrow({ where: { email: 'adviser@test.ph' } })).id, requestorName: 'Maria Santos', status: 'pending', approvedAt: null, approvedById: null, approvedByName: null, approvedByDesignation: null, clearedAt: null },
    });
    const own = expectStatus(await president.get('/history/fund-usage'), 200).body;
    expect(own).toMatchObject({ total: 1, ownOnly: true });
    expect(expectStatus(await adviser.get('/history/fund-usage'), 200).body.total).toBe(2);
    expect((await collector.get('/history/fund-usage')).status).toBe(403);
    expect((await collector.get('/reports/fund-usage')).status).toBe(403);
  });
});

describe('per-fund report', () => {
  it('lists the ledger with a running balance and who still owes', async () => {
    const doc: ReportDoc = expectStatus(await adviser.get(`/reports/fund?fundId=${studentFee}`), 200).body;
    expect(doc.subtitle).toBe('Student Fee');
    expect(summary(doc, 'Collected')).toBe(70_000);
    expect(summary(doc, 'Still to collect')).toBe(80_000); // Ben 30,000 + Cara 50,000
    expect(summary(doc, 'Paid / partial / unpaid')).toBe('1 / 1 / 1');
    const ledger = table(doc, 'Ledger');
    expect(ledger.rows.map((r) => [r.type, r.amount, r.balance])).toEqual([
      ['Collection', 50_000, 50_000],
      ['Collection', 20_000, 70_000],
      ['Collection', 10_000, 80_000],
      ['Void', -10_000, 70_000],
    ]);
    expect(table(doc, 'Students who still owe this fund').rows.map((r) => [r.studentNumber, r.balance])).toEqual([
      ['2001', 50_000],
      ['1002', 30_000],
    ]);
    // an opening balance row when the period starts later
    const later: ReportDoc = expectStatus(await adviser.get(`/reports/fund?fundId=${studentFee}&from=${manilaDay(1)}`), 200).body;
    expect(table(later, 'Ledger').rows).toEqual([expect.objectContaining({ type: 'Opening', balance: 70_000 })]);
  });

  it('keeps confidential funds away from those who may not see them', async () => {
    expect((await collector.get(`/reports/fund?fundId=${insurance}`)).status).toBe(404);
    expectStatus(await adviser.get(`/reports/fund?fundId=${insurance}`), 200);
  });
});

describe('student statement and clearance list', () => {
  it('shows a student’s charges and payments, masking restricted funds', async () => {
    const doc: ReportDoc = expectStatus(await collector.get(`/reports/student-statement?studentId=${students['1001']}`), 200).body;
    expect(doc.subtitle).toBe('Ana Cruz · 1001 · BSIT 1-A');
    expect(summary(doc, 'Status')).toBe('Cleared');
    expect(table(doc, 'Charges').rows.map((r) => r.fund)).toEqual(['Student Fee', 'Restricted fund']);
    expect(table(doc, 'Payments').rows[0]!.split).toBe('Student Fee 500.00; Restricted fund 150.00');
    const adviserDoc: ReportDoc = expectStatus(await adviser.get(`/reports/student-statement?studentId=${students['1001']}`), 200).body;
    expect(table(adviserDoc, 'Charges').rows.map((r) => r.fund)).toEqual(['Student Fee', 'Insurance']);
  });

  it('lists cleared and has-balance students by course, year and section', async () => {
    const all: ReportDoc = expectStatus(await collector.get('/reports/clearance'), 200).body;
    expect([summary(all, 'Students'), summary(all, 'Cleared'), summary(all, 'Has balance')]).toEqual([3, 1, 2]);
    expect(table(all, 'Students').rows.map((r) => [r.studentNumber, r.status])).toEqual([
      ['2001', 'Has balance'],
      ['1001', 'Cleared'],
      ['1002', 'Has balance'],
    ]);
    const owing: ReportDoc = expectStatus(await collector.get('/reports/clearance?status=has_balance'), 200).body;
    expect(table(owing, 'Students').rows).toHaveLength(2);
    expect(summary(owing, 'Total balance')).toBe(65_000 + 45_000);
  });
});

describe('dashboard', () => {
  it('totals every fund for the adviser and leaves restricted funds out for others', async () => {
    const a = expectStatus(await adviser.get('/dashboard?range=30d'), 200).body;
    expect(a.totals).toMatchObject({ collected: 85_000, due: 195_000, outstanding: 110_000, balance: 85_000, used: 0 });
    expect(a.clearance).toEqual({ cleared: 1, hasBalance: 2, total: 3 });
    expect(a.funds.map((f: { name: string }) => f.name)).toEqual(['Student Fee', 'Insurance']);
    expect(a.collectionsOverTime).toHaveLength(31);
    expect(a.collectionsOverTime.at(-1)).toEqual({ period: manilaToday(), amount: 85_000, payments: 2 });
    expect(a.byProgram).toEqual([
      { label: 'BSCS', due: 65_000, collected: 0, outstanding: 65_000 },
      { label: 'BSIT', due: 130_000, collected: 85_000, outstanding: 45_000 },
    ]);
    expect(a.pending).toMatchObject({ pendingStudents: 0, pendingMembers: 0 });

    const c = expectStatus(await collector.get('/dashboard'), 200).body;
    expect(c.totals).toMatchObject({ collected: 70_000, due: 150_000 });
    expect(c.funds.map((f: { name: string }) => f.name)).toEqual(['Student Fee']);
    expect(c.restrictedHidden).toBe(true);
    expect(c.pending.pendingMembers).toBeNull();
    expect(JSON.stringify(c)).not.toContain('Insurance');

    const p = expectStatus(await president.get('/dashboard'), 200).body;
    expect(p.recentPayments).toEqual([]);
  });
});
