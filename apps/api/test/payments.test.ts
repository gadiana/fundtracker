import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AcademicYear, Program } from '@prisma/client';
import { allocateByPriority, allocationProblems, formatTransactionNo } from '@sft/shared';
import { prisma } from '../src/db';
import { sentMail } from '../src/lib/mailer';
import { localDate } from '../src/modules/payments/service';
import { createProgram } from './fixtures';
import { Client, createAy, expectStatus, registerAndLogin, resetDb, type Client as ClientType } from './helpers';

let ay: AcademicYear;
let bsit: Program;
let adviser: ClientType;
let collector: ClientType;
let designations: Awaited<ReturnType<typeof createAy>>['designations'];
const funds: Record<string, string> = {};

async function approve(email: string, designationId: string, names: [string, string]) {
  const c = await registerAndLogin(email, undefined, names);
  const pending = (await adviser.get('/members?status=pending')).body.items.find((m: { user: { email: string } }) => m.user.email === email);
  expectStatus(await adviser.post(`/members/${pending.id}/approve`, { designationId }), 200);
  return c;
}

async function addStudent(number: string, extra: Record<string, unknown> = {}) {
  return expectStatus(
    await collector.post('/students', { studentNumber: number, firstName: 'Jhon', lastName: `Student${number}`, programId: bsit.id, yearLevel: 1, ...extra }),
    201,
  ).body as { id: string };
}

const pay = (client: ClientType, studentId: string, amount: number, allocations?: { chargeId: string; amount: number }[], key = randomUUID()) =>
  client.post('/payments', { idempotencyKey: key, studentId, amount, allocations });

const chargeOf = async (studentId: string, fund: string) =>
  (await prisma.studentCharge.findFirstOrThrow({ where: { studentId, fund: { name: fund } } })).id;

beforeEach(async () => {
  await resetDb();
  const created = await createAy(2026);
  ay = created.ay;
  designations = created.designations;
  bsit = await createProgram(ay.id, 'BSIT');
  adviser = await registerAndLogin('adviser@test.ph', undefined, ['Maria', 'Santos']);
  collector = await approve('collector@test.ph', designations.collector.id, ['Carlo', 'Reyes']);
  // the spec's example: ₱950 in total
  for (const [name, amount] of [
    ['Student Fee', 50_000],
    ['Palaro', 10_000],
    ['Insurance', 15_000],
    ['Books', 20_000],
  ] as const) {
    const res = expectStatus(
      await adviser.post('/funds', { name, amountPerStudent: amount, isMandatory: true, isConfidential: false, yearLevels: [1, 2, 3, 4], allPrograms: true }),
      201,
    );
    funds[name] = res.body.fund.id;
  }
});

describe('allocation rules', () => {
  const charges = [
    { chargeId: 'fee', priority: 1, balance: 50_000 },
    { chargeId: 'palaro', priority: 2, balance: 10_000 },
    { chargeId: 'insurance', priority: 3, balance: 15_000 },
    { chargeId: 'books', priority: 4, balance: 20_000 },
  ];

  it('fills funds in priority order (the spec examples)', () => {
    expect(allocateByPriority(charges, 5_000, true)).toEqual([{ chargeId: 'fee', amount: 5_000 }]);
    expect(allocateByPriority(charges, 40_000, true)).toEqual([{ chargeId: 'fee', amount: 40_000 }]);
    expect(allocateByPriority(charges, 55_000, true)).toEqual([
      { chargeId: 'fee', amount: 50_000 },
      { chargeId: 'palaro', amount: 5_000 },
    ]);
    expect(allocateByPriority(charges, 95_000, true).reduce((s, a) => s + a.amount, 0)).toBe(95_000);
  });

  it('only fills whole funds when partial payments are off', () => {
    expect(allocateByPriority(charges, 25_000, false)).toEqual([
      { chargeId: 'palaro', amount: 10_000 },
      { chargeId: 'insurance', amount: 15_000 },
    ]);
    expect(allocationProblems(charges, 5_000, allocateByPriority(charges, 5_000, false), false)).not.toHaveLength(0);
  });

  it('rejects splits that do not add up, overpay a fund, or overpay overall', () => {
    expect(allocationProblems(charges, 10_000, [{ chargeId: 'fee', amount: 9_000 }], true)[0]).toMatch(/adds up to/);
    expect(allocationProblems(charges, 20_000, [{ chargeId: 'palaro', amount: 20_000 }], true)[0]).toMatch(/more than what is left/);
    expect(allocationProblems(charges, 100_000, allocateByPriority(charges, 100_000, true), true)[0]).toMatch(/Overpayment/);
    expect(allocationProblems(charges, 1_000, [{ chargeId: 'nope', amount: 1_000 }], true)[0]).toMatch(/not one of this student/);
  });

  it('formats transaction numbers with the AY counter and the local date', () => {
    expect(formatTransactionNo('2026-11-12', 11)).toBe('2026-11-12-0011');
    expect(formatTransactionNo('2027-03-01', 12345)).toBe('2027-03-01-12345');
    // 23:30 UTC on Nov 11 is already Nov 12 in Manila
    expect(localDate('Asia/Manila', new Date('2026-11-11T23:30:00Z'))).toBe('2026-11-12');
  });
});

describe('recording payments', () => {
  it('records a partial payment split by priority, with ledger entries and snapshots', async () => {
    const s = await addStudent('1001');
    const res = expectStatus(await pay(collector, s.id, 40_000), 201).body.receipt;

    expect(res.transactionNo).toMatch(new RegExp(`^${localDate('Asia/Manila')}-0001$`));
    expect(res).toMatchObject({
      amount: 40_000,
      balanceBefore: 95_000,
      balanceAfter: 55_000,
      clearedAfter: false,
      processedByName: 'Carlo Reyes',
      processedByDesignation: 'Collector',
      student: { name: 'Jhon Student1001', studentNumber: '1001', courseYearSection: 'BSIT 1' },
      allocations: [{ fundName: 'Student Fee', amount: 40_000, remainingOnFund: 10_000 }],
    });
    expect(res.qrUrl).toMatch(/\/verify\/[\w-]{40,}$/);

    const ledger = await prisma.fundLedger.findMany({ where: { fundId: funds['Student Fee'] } });
    expect(ledger.map((l) => [l.entryType, Number(l.amount)])).toEqual([['collection', 40_000]]);
    const profile = expectStatus(await collector.get(`/students/${s.id}`), 200).body.account;
    expect(profile.charges[0]).toMatchObject({ fundName: 'Student Fee', status: 'partial', balance: 10_000 });
  });

  it('accepts a custom split in hybrid mode and clears the student once all mandatory funds are paid', async () => {
    const s = await addStudent('1002');
    const split = [
      { chargeId: await chargeOf(s.id, 'Books'), amount: 20_000 },
      { chargeId: await chargeOf(s.id, 'Palaro'), amount: 10_000 },
    ];
    const first = expectStatus(await pay(collector, s.id, 30_000, split), 201).body.receipt;
    expect(first.allocations.map((a: { fundName: string }) => a.fundName)).toEqual(['Palaro', 'Books']);

    const rest = expectStatus(await pay(collector, s.id, 65_000), 201).body.receipt;
    expect(rest).toMatchObject({ balanceAfter: 0, clearedAfter: true });
    const account = expectStatus(await collector.get(`/students/${s.id}`), 200).body.account;
    expect(account.isCleared).toBe(true);
  });

  it('numbers receipts with one counter for the whole AY, without gaps or duplicates under load', async () => {
    const students = await Promise.all(['2001', '2002', '2003', '2004', '2005'].map((n) => addStudent(n)));
    const results = await Promise.all(students.map((s) => pay(collector, s.id, 1_000)));
    const numbers = results.map((r) => expectStatus(r, 201).body.receipt.transactionNo.slice(-4)).sort();
    expect(numbers).toEqual(['0001', '0002', '0003', '0004', '0005']);
    const counter = await prisma.ayCounter.findUniqueOrThrow({ where: { academicYearId_counterKey: { academicYearId: ay.id, counterKey: 'receipt' } } });
    expect(counter.lastValue).toBe(5);
  });

  it('refuses overpayment, bad splits and other students’ charges', async () => {
    const s = await addStudent('3001');
    const other = await addStudent('3002');
    expect((await pay(collector, s.id, 95_001)).body.error.code).toBe('INVALID_ALLOCATION');
    expect((await pay(collector, s.id, 10_000, [{ chargeId: await chargeOf(s.id, 'Palaro'), amount: 5_000 }])).body.error.message).toMatch(/adds up to/);
    expect((await pay(collector, s.id, 1_000, [{ chargeId: await chargeOf(other.id, 'Palaro'), amount: 1_000 }])).status).toBe(400);
    expect(await prisma.payment.count()).toBe(0);
  });

  it('never lets two simultaneous payments overpay the same student', async () => {
    const s = await addStudent('3003');
    const [a, b] = await Promise.all([pay(collector, s.id, 60_000), pay(collector, s.id, 60_000)]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect(await prisma.payment.count({ where: { studentId: s.id } })).toBe(1);
  });

  it('returns the same payment when a submission is retried', async () => {
    const s = await addStudent('3004');
    const key = randomUUID();
    const first = expectStatus(await pay(collector, s.id, 5_000, undefined, key), 201).body;
    const retry = expectStatus(await pay(collector, s.id, 5_000, undefined, key), 200).body;
    expect(retry).toMatchObject({ replayed: true, receipt: { id: first.receipt.id } });
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.fundLedger.count()).toBe(1);
  });

  it('follows the priority-only and no-partial settings', async () => {
    const s = await addStudent('3005');
    expectStatus(await adviser.patch('/settings', { allocationMode: 'priority_only' }), 200);
    const custom = [{ chargeId: await chargeOf(s.id, 'Books'), amount: 20_000 }];
    const res = expectStatus(await pay(collector, s.id, 20_000, custom), 201).body.receipt;
    expect(res.allocations.map((a: { fundName: string }) => a.fundName)).toEqual(['Student Fee']); // the split is ignored

    expectStatus(await adviser.patch('/settings', { allocationMode: 'hybrid', allowPartialPayments: false }), 200);
    expect((await pay(collector, s.id, 1_000, [{ chargeId: await chargeOf(s.id, 'Palaro'), amount: 1_000 }])).body.error.message).toMatch(/Partial payments are turned off/);
    expectStatus(await pay(collector, s.id, 10_000, [{ chargeId: await chargeOf(s.id, 'Palaro'), amount: 10_000 }]), 201);
  });

  it('requires a confirmed course/year/section, an open AY and the collect permission', async () => {
    const promoted = await prisma.student.create({
      data: { academicYearId: ay.id, studentNumber: '4001', firstName: 'P', lastName: 'Q', nameKey: 'pq', nameKeyLoose: 'pq', programId: bsit.id, yearLevel: 2, source: 'promoted', needsProfileConfirmation: true },
    });
    expect((await pay(collector, promoted.id, 1_000)).body.error.code).toBe('NEEDS_CONFIRMATION');

    const s = await addStudent('4002');
    const president = await approve('president@test.ph', designations.president.id, ['Paolo', 'Lim']);
    expect((await pay(president, s.id, 1_000)).status).toBe(403);

    await prisma.academicYear.update({ where: { id: ay.id }, data: { status: 'closed' } });
    expect((await pay(collector, s.id, 1_000)).body.error.code).toBe('AY_CLOSED');
  });
});

describe('voiding', () => {
  it('lets only the adviser void, with a reason, reversing every ledger entry', async () => {
    const s = await addStudent('5001');
    const receipt = expectStatus(await pay(collector, s.id, 55_000), 201).body.receipt;

    expect((await collector.post(`/payments/${receipt.id}/void`, { reason: 'Wrong student' })).status).toBe(403);
    expect((await adviser.post(`/payments/${receipt.id}/void`, { reason: 'no' })).status).toBe(400);

    const voided = expectStatus(await adviser.post(`/payments/${receipt.id}/void`, { reason: 'Recorded for the wrong student' }), 200).body;
    expect(voided).toMatchObject({ status: 'voided', voided: { byName: 'Maria Santos', reason: 'Recorded for the wrong student' } });

    const entries = await prisma.fundLedger.findMany({ where: { paymentId: receipt.id }, orderBy: { createdAt: 'asc' } });
    expect(entries.filter((e) => e.entryType === 'void').map((e) => Number(e.amount)).sort((a, b) => a - b)).toEqual([-50_000, -5_000]);
    const [fee] = await prisma.$queryRaw<{ balance: bigint }[]>`SELECT balance FROM v_fund_balances WHERE fund_id = ${funds['Student Fee']}::uuid`;
    expect(fee!.balance).toBe(0n);

    // the student owes the full amount again; the payment is still on record
    expect(expectStatus(await collector.get(`/students/${s.id}`), 200).body.account.totals.balance).toBe(95_000);
    expect(await prisma.payment.count()).toBe(1);
    expect((await adviser.post(`/payments/${receipt.id}/void`, { reason: 'Again please' })).body.error.code).toBe('ALREADY_VOIDED');
    // and it can't be edited directly either
    await expect(prisma.payment.update({ where: { id: receipt.id }, data: { amount: 1n } })).rejects.toThrow();
  });
});

describe('receipt email and the public QR status page', () => {
  it('emails the receipt with the QR attached, to the student or another address', async () => {
    const s = await addStudent('6001', { email: 'jhon@example.com' });
    const noEmail = await addStudent('6002');
    const receipt = expectStatus(await pay(collector, s.id, 10_000), 201).body.receipt;
    const other = expectStatus(await pay(collector, noEmail.id, 10_000), 201).body.receipt;

    expect(expectStatus(await collector.post(`/payments/${receipt.id}/email`), 200).body.to).toBe('jhon@example.com');
    const mail = sentMail.find((m) => m.to === 'jhon@example.com')!;
    expect(mail.subject).toContain(receipt.transactionNo);
    expect(mail.html).toContain('cid:status-qr');
    expect(mail.attachments?.[0]).toMatchObject({ filename: 'status-qr.png', cid: 'status-qr' });

    expect((await collector.post(`/payments/${other.id}/email`)).body.error.code).toBe('NO_EMAIL');
    expectStatus(await collector.post(`/payments/${other.id}/email`, { to: 'parent@example.com' }), 200);
  });

  it('shows name and status, plus what’s paid and not yet paid with confidential funds merged', async () => {
    const s = await addStudent('7001');
    expectStatus(
      await adviser.post('/funds', { name: 'Adviser Reserve', amountPerStudent: 2_000, isMandatory: true, isConfidential: true, yearLevels: [1], allPrograms: true }),
      201,
    );
    const receipt = expectStatus(await pay(collector, s.id, 50_000), 201).body.receipt;
    const token = receipt.qrUrl.split('/verify/')[1];

    const anon = await Client.create();
    const status = expectStatus(await anon.get(`/public/verify/${token}`), 200).body;
    expect(status).toMatchObject({ name: 'Jhon Student7001', status: 'has_balance', selected: ay.id, academicYears: [{ id: ay.id, label: '2026-2027' }] });
    const year = status.years[0];
    expect(year).toMatchObject({ academicYear: '2026-2027', status: 'has_balance' });
    expect(year.breakdown.map((b: { fund: string; balance: number }) => [b.fund, b.balance])).toEqual([
      ['Student Fee', 0],
      ['Palaro', 10_000],
      ['Insurance', 15_000],
      ['Books', 20_000],
      ['Restricted fee', 2_000],
    ]);
    // the payment history, with no staff name in it
    expect(year.transactions).toEqual([
      { id: receipt.id, transactionNo: receipt.transactionNo, receivedAt: expect.any(String), amount: 50_000, status: 'posted', funds: ['Student Fee'] },
    ]);
    // no confidential fund name, student number field or staff name
    expect(JSON.stringify(status)).not.toMatch(/Adviser Reserve|"studentNumber"|Carlo/);

    // the adviser can switch the extras off: name and status only
    expectStatus(await adviser.patch('/settings', { publicFields: [] }), 200);
    const minimal = expectStatus(await anon.get(`/public/verify/${token}`), 200).body;
    expect(Object.keys(minimal.years[0]).sort()).toEqual(['academicYear', 'academicYearId', 'status']);
    expect((await anon.get(`/public/verify/${token}/receipts/${receipt.id}`)).status).toBe(404);
  });

  it('opens each digital receipt of the history, and only for this QR’s student', async () => {
    const s = await addStudent('7101');
    const other = await addStudent('7102');
    const receipt = expectStatus(await collector.post('/payments', { idempotencyKey: randomUUID(), studentId: s.id, amount: 30_000, notes: 'Paid by the parent' }), 201).body.receipt;
    const otherReceipt = expectStatus(await pay(collector, other.id, 10_000), 201).body.receipt;
    const token = receipt.qrUrl.split('/verify/')[1];
    const anon = await Client.create();

    const shown = expectStatus(await anon.get(`/public/verify/${token}/receipts/${receipt.id}`), 200).body;
    expect(shown).toMatchObject({ transactionNo: receipt.transactionNo, amount: 30_000, student: { name: 'Jhon Student7101' }, notes: null });
    expect((await anon.get(`/public/verify/${token}/receipts/${otherReceipt.id}`)).status).toBe(404);
    expect((await anon.get(`/public/verify/${token}/receipts/not-a-uuid`)).status).toBe(404);

    // a voided payment stays in the history, without why or by whom
    expectStatus(await adviser.post(`/payments/${receipt.id}/void`, { reason: 'Wrong amount typed' }), 200);
    const voided = expectStatus(await anon.get(`/public/verify/${token}/receipts/${receipt.id}`), 200).body;
    expect(voided.status).toBe('voided');
    expect(JSON.stringify(voided)).not.toContain('Wrong amount');
  });

  it('lets the student pick another academic year, or all of them', async () => {
    const s = await addStudent('7201');
    const receipt = expectStatus(await pay(collector, s.id, 10_000), 201).body.receipt;
    const token = receipt.qrUrl.split('/verify/')[1];
    // the same student number last year, with nothing owed
    const { ay: last } = await createAy(2025, { current: false });
    const program = await prisma.program.create({ data: { academicYearId: last.id, code: 'BSIT', name: 'BS Information Technology' } });
    await prisma.student.create({
      data: { academicYearId: last.id, studentNumber: '7201', firstName: 'Jhon', lastName: 'Student7201', nameKey: 'k', nameKeyLoose: 'k', programId: program.id, yearLevel: 1, source: 'manual' },
    });
    const anon = await Client.create();

    const now = expectStatus(await anon.get(`/public/verify/${token}`), 200).body;
    expect(now.academicYears.map((y: { label: string }) => y.label)).toEqual(['2026-2027', '2025-2026']);
    expect(now.status).toBe('has_balance');

    const lastYear = expectStatus(await anon.get(`/public/verify/${token}?ay=${last.id}`), 200).body;
    expect(lastYear).toMatchObject({ selected: last.id, status: 'cleared', years: [{ academicYear: '2025-2026', status: 'cleared', transactions: [] }] });

    const all = expectStatus(await anon.get(`/public/verify/${token}?ay=all`), 200).body;
    expect(all.selected).toBe('all');
    expect(all.years.map((y: { academicYear: string; status: string }) => [y.academicYear, y.status])).toEqual([
      ['2026-2027', 'has_balance'],
      ['2025-2026', 'cleared'],
    ]);
    // not cleared overall while any year has a balance
    expect(all.status).toBe('has_balance');
  });

  it('stops old QR codes working once the token is replaced', async () => {
    const s = await addStudent('8001');
    const receipt = expectStatus(await pay(collector, s.id, 95_000), 201).body.receipt;
    const oldToken = receipt.qrUrl.split('/verify/')[1];
    const anon = await Client.create();
    expect(expectStatus(await anon.get(`/public/verify/${oldToken}`), 200).body.status).toBe('cleared');

    const fresh = expectStatus(await collector.post(`/students/${s.id}/qr/rotate`), 200).body;
    expect((await anon.get(`/public/verify/${oldToken}`)).status).toBe(404);
    expect(expectStatus(await anon.get(`/public/verify/${fresh.token}`), 200).body.status).toBe('cleared');
    expect((await anon.get('/public/verify/short')).status).toBe(404);
  });
});
