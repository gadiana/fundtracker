import { beforeEach, describe, expect, it } from 'vitest';
import type { AcademicYear, Program, Section } from '@prisma/client';
import { centavosToInput, parsePesos } from '@sft/shared';
import { prisma } from '../src/db';
import { createProgram, createSection, recordCollection, sectionFor } from './fixtures';
import { Client, createAy, expectStatus, registerAndLogin, resetDb, type Client as ClientType } from './helpers';

let ay: AcademicYear;
let bsit: Program;
let bscs: Program;
let sectionA: Section;
let adviser: ClientType;
let collector: ClientType;
let collectorUserId: string;
let designations: Awaited<ReturnType<typeof createAy>>['designations'];

async function approve(email: string, designationId: string) {
  const c = await registerAndLogin(email);
  const pending = (await adviser.get('/members?status=pending')).body.items.find((m: { user: { email: string } }) => m.user.email === email);
  expectStatus(await adviser.post(`/members/${pending.id}/approve`, { designationId }), 200);
  return { client: c, userId: pending.user.id as string };
}

async function addStudent(number: string, yearLevel: number, program = bsit, extra: Record<string, unknown> = {}) {
  return expectStatus(
    await collector.post('/students', {
      studentNumber: number,
      firstName: `First${number}`,
      lastName: `Last${number}`,
      programId: program.id,
      yearLevel,
      sectionId: (await sectionFor(ay.id, program.id, yearLevel)).id,
      ...extra,
    }),
    201,
  ).body as { id: string };
}

const fundBody = (over: Record<string, unknown> = {}) => ({
  name: 'Student Fee',
  amountPerStudent: 50_000,
  isMandatory: true,
  isConfidential: false,
  yearLevels: [1, 2, 3, 4],
  allPrograms: true,
  programIds: [],
  ...over,
});

const chargesOf = (studentId: string) =>
  prisma.studentCharge.findMany({ where: { studentId, status: 'active' }, include: { fund: true }, orderBy: { fund: { priority: 'asc' } } });

beforeEach(async () => {
  await resetDb();
  const created = await createAy(2026);
  ay = created.ay;
  designations = created.designations;
  bsit = await createProgram(ay.id, 'BSIT');
  bscs = await createProgram(ay.id, 'BSCS');
  sectionA = await createSection(ay.id, 'A', bsit.id, 1);
  adviser = await registerAndLogin('adviser@test.ph', undefined, ['Maria', 'Santos']);
  const c = await approve('collector@test.ph', designations.collector.id);
  collector = c.client;
  collectorUserId = c.userId;
});

describe('money helpers', () => {
  it('parses pesos to integer centavos without floating-point errors', () => {
    expect(parsePesos('2,500.60')).toBe(250_060);
    expect(parsePesos('₱0.1')).toBe(10);
    expect(parsePesos('0.29')).toBe(29); // 0.29 * 100 is 28.999… in floating point
    expect(parsePesos('1.234')).toBeNull();
    expect(parsePesos('abc')).toBeNull();
    expect(centavosToInput(250_060)).toBe('2500.60');
    expect(centavosToInput(-5)).toBe('-0.05');
  });
});

describe('creating funds and generating charges', () => {
  it('charges every active student the fund applies to, and only them', async () => {
    const first = await addStudent('1001', 1);
    const second = await addStudent('1002', 2);
    const cs = await addStudent('1003', 1, bscs);
    const inactive = await addStudent('1004', 1);
    expectStatus(await collector.post(`/students/${inactive.id}/deactivate`), 200);

    const res = expectStatus(await adviser.post('/funds', fundBody({ name: 'Palaro', amountPerStudent: 10_000, yearLevels: [1], allPrograms: false, programIds: [bsit.id] })), 201);
    expect(res.body.charges).toEqual({ added: 1, reactivated: 0, cancelled: 0, keptWithPayments: 0 });
    expect((await chargesOf(first.id)).map((c) => [c.fund.name, Number(c.amountDue)])).toEqual([['Palaro', 10_000]]);
    expect(await chargesOf(second.id)).toHaveLength(0); // wrong year
    expect(await chargesOf(cs.id)).toHaveLength(0); // wrong program
    expect(await chargesOf(inactive.id)).toHaveLength(0); // deactivated
    expect(res.body.fund.stats).toMatchObject({ students: 1, totalDue: 10_000, unpaidCount: 1 });
  });

  it('is adviser-only and validates its input', async () => {
    expect((await collector.post('/funds', fundBody())).status).toBe(403);
    expect((await adviser.post('/funds', fundBody({ yearLevels: [] }))).status).toBe(400);
    expect((await adviser.post('/funds', fundBody({ yearLevels: [6] }))).body.error.code).toBe('INVALID_YEAR_LEVEL');
    expect((await adviser.post('/funds', fundBody({ allPrograms: false, programIds: [] }))).status).toBe(400);
    expect((await adviser.post('/funds', fundBody({ amountPerStudent: 12.5 }))).status).toBe(400); // centavos only
    expectStatus(await adviser.post('/funds', fundBody()), 201);
    expect((await adviser.post('/funds', fundBody({ name: 'student fee' }))).body.error.code).toBe('DUPLICATE');
  });

  it('charges students who are added, approved, imported, confirmed or reactivated later', async () => {
    expectStatus(await adviser.post('/funds', fundBody()), 201);
    expectStatus(await adviser.post('/funds', fundBody({ name: 'Insurance', amountPerStudent: 15_000 })), 201);

    // added by staff
    const added = await addStudent('2001', 1);
    expect(await chargesOf(added.id)).toHaveLength(2);

    // self-enrolled: no charges while pending, charged on approval
    const link = expectStatus(await collector.post('/enrollment-links', {}), 201).body;
    const anon = await Client.create();
    expectStatus(
      await anon.post(`/public/enroll/${link.token}`, { studentNumber: '2002', firstName: 'Self', lastName: 'Enrolled', programId: bsit.id, yearLevel: 2, consent: true }),
      201,
    );
    const pending = await prisma.student.findFirstOrThrow({ where: { studentNumber: '2002' } });
    expect(await chargesOf(pending.id)).toHaveLength(0);
    expectStatus(await collector.post(`/students/${pending.id}/approve`), 200);
    expect(await chargesOf(pending.id)).toHaveLength(2);

    // imported
    const csv = 'student_number,last_name,first_name,program,year_level\n2003,Imported,Ina,BSCS,3';
    expectStatus(await collector.post('/students/import', { csv }), 201);
    const imported = await prisma.student.findFirstOrThrow({ where: { studentNumber: '2003' } });
    expect(await chargesOf(imported.id)).toHaveLength(2);

    // promoted: nothing until the course/year/section is confirmed
    const promoted = await prisma.student.create({
      data: {
        academicYearId: ay.id,
        studentNumber: '2004',
        firstName: 'Pro',
        lastName: 'Moted',
        nameKey: 'promoted',
        nameKeyLoose: 'promoted',
        programId: bsit.id,
        yearLevel: 2,
        source: 'promoted',
        needsProfileConfirmation: true,
      },
    });
    // even a fund-wide re-sync leaves an unconfirmed student alone
    const fee = await prisma.fund.findFirstOrThrow({ where: { name: 'Student Fee' } });
    expectStatus(await adviser.patch(`/funds/${fee.id}`, { notes: 'resync' }), 200);
    expect(await chargesOf(promoted.id)).toHaveLength(0);
    expectStatus(await collector.post(`/students/${promoted.id}/confirm-profile`, { programId: bsit.id, yearLevel: 2 }), 200);
    expect(await chargesOf(promoted.id)).toHaveLength(2);

    // deactivated while a new fund was created, then reactivated
    expectStatus(await collector.post(`/students/${added.id}/deactivate`), 200);
    expectStatus(await adviser.post('/funds', fundBody({ name: 'Books', amountPerStudent: 20_000 })), 201);
    expect(await chargesOf(added.id)).toHaveLength(2);
    expectStatus(await collector.post(`/students/${added.id}/reactivate`), 200);
    expect((await chargesOf(added.id)).map((c) => c.fund.name)).toEqual(['Student Fee', 'Insurance', 'Books']);
  });

  it('re-syncs when a student changes year level, keeping charges that already have payments', async () => {
    const firstYearOnly = expectStatus(await adviser.post('/funds', fundBody({ name: 'Orientation', amountPerStudent: 5_000, yearLevels: [1] })), 201).body.fund;
    const secondYearOnly = expectStatus(await adviser.post('/funds', fundBody({ name: 'Field Trip', amountPerStudent: 30_000, yearLevels: [2] })), 201).body.fund;
    const a = await addStudent('3001', 1);
    const b = await addStudent('3002', 1);
    await recordCollection({ academicYearId: ay.id, studentId: b.id, fundId: firstYearOnly.id, amount: 1_000, processedById: collectorUserId });

    expectStatus(await collector.patch(`/students/${a.id}`, { yearLevel: 2 }), 200);
    expect((await chargesOf(a.id)).map((c) => c.fund.name)).toEqual(['Field Trip']);
    const cancelled = await prisma.studentCharge.findFirstOrThrow({ where: { studentId: a.id, fundId: firstYearOnly.id } });
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'Student moved to another program or year level' });

    expectStatus(await collector.patch(`/students/${b.id}`, { yearLevel: 2 }), 200);
    // the partly paid Orientation charge stays; Field Trip is added
    expect((await chargesOf(b.id)).map((c) => c.fund.name).sort()).toEqual(['Field Trip', 'Orientation']);
    void secondYearOnly;

    // moving back re-activates the cancelled charge instead of creating a duplicate
    expectStatus(await collector.patch(`/students/${a.id}`, { yearLevel: 1 }), 200);
    expect((await chargesOf(a.id)).map((c) => c.fund.name)).toEqual(['Orientation']);
    expect(await prisma.studentCharge.count({ where: { studentId: a.id, fundId: firstYearOnly.id } })).toBe(1);
  });
});

describe('editing funds', () => {
  it('updates every charge when the amount changes, until collection starts', async () => {
    const s = await addStudent('4001', 1);
    const fund = expectStatus(await adviser.post('/funds', fundBody()), 201).body.fund;
    expectStatus(await adviser.patch(`/funds/${fund.id}`, { amountPerStudent: 45_000 }), 200);
    expect(Number((await chargesOf(s.id))[0]!.amountDue)).toBe(45_000);

    await recordCollection({ academicYearId: ay.id, studentId: s.id, fundId: fund.id, amount: 100, processedById: collectorUserId });
    const locked = await adviser.patch(`/funds/${fund.id}`, { amountPerStudent: 60_000 });
    expect(locked.body.error.code).toBe('AMOUNT_LOCKED');
    expect(expectStatus(await adviser.get(`/funds/${fund.id}`), 200).body.amountLocked).toBe(true);
    // the database refuses too, whoever asks
    await expect(prisma.fund.update({ where: { id: fund.id }, data: { amountPerStudent: 60_000n } })).rejects.toThrow(/locked/);
    // other details can still change
    expectStatus(await adviser.patch(`/funds/${fund.id}`, { notes: 'Still editable', isMandatory: false }), 200);
  });

  it('adds and removes charges when year levels or programs change', async () => {
    const one = await addStudent('5001', 1);
    const cs = await addStudent('5002', 3, bscs);
    const fund = expectStatus(await adviser.post('/funds', fundBody({ yearLevels: [1] })), 201).body.fund;
    expect(await chargesOf(cs.id)).toHaveLength(0);

    const widened = expectStatus(await adviser.patch(`/funds/${fund.id}`, { yearLevels: [1, 3] }), 200).body;
    expect(widened.charges.added).toBe(1);
    expect(await chargesOf(cs.id)).toHaveLength(1);

    const narrowed = expectStatus(await adviser.patch(`/funds/${fund.id}`, { allPrograms: false, programIds: [bsit.id] }), 200).body;
    expect(narrowed.charges.cancelled).toBe(1);
    expect(await chargesOf(cs.id)).toHaveLength(0);
    expect(await chargesOf(one.id)).toHaveLength(1);
  });

  it('reorders priorities', async () => {
    const a = expectStatus(await adviser.post('/funds', fundBody({ name: 'A' })), 201).body.fund;
    const b = expectStatus(await adviser.post('/funds', fundBody({ name: 'B' })), 201).body.fund;
    const c = expectStatus(await adviser.post('/funds', fundBody({ name: 'C' })), 201).body.fund;
    expect([a.priority, b.priority, c.priority]).toEqual([1, 2, 3]);
    expectStatus(await adviser.post('/funds/reorder', { ids: [c.id, a.id, b.id] }), 200);
    const list = expectStatus(await collector.get('/funds'), 200).body.items;
    expect(list.map((f: { name: string; priority: number }) => [f.name, f.priority])).toEqual([
      ['C', 1],
      ['A', 2],
      ['B', 3],
    ]);
    expect((await adviser.post('/funds/reorder', { ids: [a.id, b.id] })).body.error.code).toBe('BAD_ORDER');
  });

  it('deactivates only funds nobody has paid into', async () => {
    const s = await addStudent('6001', 1);
    const unused = expectStatus(await adviser.post('/funds', fundBody({ name: 'Unused' })), 201).body.fund;
    const used = expectStatus(await adviser.post('/funds', fundBody({ name: 'Used' })), 201).body.fund;
    await recordCollection({ academicYearId: ay.id, studentId: s.id, fundId: used.id, amount: 500, processedById: collectorUserId });

    expect(expectStatus(await adviser.post(`/funds/${unused.id}/deactivate`), 200).body.charges.cancelled).toBe(1);
    expect((await adviser.post(`/funds/${used.id}/deactivate`)).body.error.code).toBe('HAS_PAYMENTS');
    expect(expectStatus(await adviser.post(`/funds/${unused.id}/reactivate`), 200).body.charges.reactivated).toBe(1);
  });
});

describe('ledger and balances', () => {
  it('a fund’s balance is the sum of its ledger, and the ledger is append-only', async () => {
    const s = await addStudent('7001', 1);
    const fund = expectStatus(await adviser.post('/funds', fundBody()), 201).body.fund;
    await recordCollection({ academicYearId: ay.id, studentId: s.id, fundId: fund.id, amount: 30_000, processedById: collectorUserId });
    expectStatus(await adviser.post(`/funds/${fund.id}/adjustments`, { amount: -5_000, reason: 'Bank charge on deposit' }), 201);

    const ledger = expectStatus(await collector.get(`/funds/${fund.id}/ledger`), 200).body;
    expect(ledger.items.map((e: { entryType: string; amount: number; balanceAfter: number }) => [e.entryType, e.amount, e.balanceAfter])).toEqual([
      ['collection', 30_000, 30_000],
      ['adjustment', -5_000, 25_000],
    ]);
    const detail = expectStatus(await collector.get(`/funds/${fund.id}`), 200).body;
    expect(detail.stats).toMatchObject({ balance: 25_000, collected: 30_000, available: 25_000, partialCount: 1 });

    const entry = await prisma.fundLedger.findFirstOrThrow({ where: { entryType: 'adjustment' } });
    await expect(prisma.fundLedger.update({ where: { id: entry.id }, data: { amount: 1n } })).rejects.toThrow(/append-only/);
    await expect(prisma.fundLedger.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
  });

  it('refuses adjustments that would overdraw the fund, and from non-advisers', async () => {
    const fund = expectStatus(await adviser.post('/funds', fundBody()), 201).body.fund;
    expect((await adviser.post(`/funds/${fund.id}/adjustments`, { amount: -1, reason: 'Too much' })).body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect((await collector.post(`/funds/${fund.id}/adjustments`, { amount: 100, reason: 'Not allowed' })).status).toBe(403);
    expect((await adviser.post(`/funds/${fund.id}/adjustments`, { amount: 100, reason: 'x' })).status).toBe(400);
  });

  it('marks a student Cleared only when every mandatory fund is fully paid', async () => {
    const s = await addStudent('8001', 1);
    const fee = expectStatus(await adviser.post('/funds', fundBody({ amountPerStudent: 50_000 })), 201).body.fund;
    expectStatus(await adviser.post('/funds', fundBody({ name: 'Yearbook', amountPerStudent: 80_000, isMandatory: false })), 201);

    const before = expectStatus(await collector.get(`/students/${s.id}`), 200).body.account;
    expect(before).toMatchObject({ isCleared: false, totals: { due: 130_000, paid: 0, balance: 130_000 } });

    await recordCollection({ academicYearId: ay.id, studentId: s.id, fundId: fee.id, amount: 50_000, processedById: collectorUserId });
    const after = expectStatus(await collector.get(`/students/${s.id}`), 200).body.account;
    expect(after.isCleared).toBe(true); // the unpaid optional yearbook doesn't block clearance
    expect(after.charges.map((c: { fundName: string; status: string }) => [c.fundName, c.status])).toEqual([
      ['Student Fee', 'paid'],
      ['Yearbook', 'unpaid'],
    ]);
    const list = expectStatus(await collector.get('/students'), 200).body.items;
    expect(list[0].clearance).toMatchObject({ isCleared: true, totalBalance: 80_000 });
  });
});

describe('confidential funds', () => {
  it('are hidden from staff without the exemption, masked on student charges, and visible to the adviser', async () => {
    const s = await addStudent('9001', 1);
    const secret = expectStatus(await adviser.post('/funds', fundBody({ name: 'Adviser Reserve', amountPerStudent: 2_000, isConfidential: true })), 201).body.fund;
    expectStatus(await adviser.post('/funds', fundBody({ name: 'Student Fee' })), 201);

    const staffList = expectStatus(await collector.get('/funds'), 200).body;
    expect(staffList.items.map((f: { name: string }) => f.name)).toEqual(['Student Fee']);
    expect(staffList.canSeeConfidential).toBe(false);
    expect((await collector.get(`/funds/${secret.id}`)).status).toBe(404);
    expect((await collector.get(`/funds/${secret.id}/ledger`)).status).toBe(404);

    const staffView = expectStatus(await collector.get(`/students/${s.id}`), 200).body.account.charges;
    const masked = staffView.find((c: { restricted: boolean }) => c.restricted);
    expect(masked).toMatchObject({ fundName: 'Restricted fund', fundId: null, amountDue: 2_000 });

    const adviserList = expectStatus(await adviser.get('/funds'), 200).body.items.map((f: { name: string }) => f.name);
    expect(adviserList).toEqual(['Adviser Reserve', 'Student Fee']);

    // granting the exemption to the Collector position reveals it
    expectStatus(await adviser.patch(`/designations/${designations.collector.id}`, { isConfidentialExempt: true }), 200);
    expectStatus(await collector.get(`/funds/${secret.id}`), 200);
    const unmasked = expectStatus(await collector.get(`/students/${s.id}`), 200).body.account.charges;
    expect(unmasked.some((c: { fundName: string }) => c.fundName === 'Adviser Reserve')).toBe(true);
  });

  it('keep other AYs’ funds out of reach', async () => {
    const other = await createAy(2027, { current: false });
    const theirs = await prisma.fund.create({ data: { academicYearId: other.ay.id, name: 'Elsewhere', amountPerStudent: 1n, priority: 1 } });
    expect((await adviser.get(`/funds/${theirs.id}`)).status).toBe(404);
    expect((await adviser.patch(`/funds/${theirs.id}`, { notes: 'x' })).status).toBe(404);
  });
});
