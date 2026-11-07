import { beforeEach, describe, expect, it } from 'vitest';
import type { AcademicYear } from '@prisma/client';
import { prisma } from '../src/db';
import { createFund, createProgram, createSection, createStudent, recordCollection } from './fixtures';
import { createAy, createEmptyAy, expectStatus, registerAndLogin, resetDb, type Client } from './helpers';

const ALL = { adviser: true, staff: true, settings: true, funds: true, carryOver: true, promoteStudents: true };

let source: AcademicYear;
let adviser: Client;
let collectorId: string;

beforeEach(async () => {
  await resetDb();
  const created = await createAy(2026);
  source = created.ay;
  collectorId = created.designations.collector.id;
  adviser = await registerAndLogin('adviser@test.ph', undefined, ['Maria', 'Santos']);
});

async function approve(email: string, designationId = collectorId) {
  const c = await registerAndLogin(email, undefined, ['Juan', 'Dela Cruz']);
  const pending = (await adviser.get('/members?status=pending')).body.items.find((m: { user: { email: string } }) => m.user.email === email);
  expectStatus(await adviser.post(`/members/${pending.id}/approve`, { designationId }), 200);
  return { client: c, userId: pending.user.id as string };
}

describe('academic year management', () => {
  it('lets the adviser create a new AY, which starts empty', async () => {
    const res = expectStatus(await adviser.post('/ays', { startYear: 2027 }), 201);
    expect(res.body.label).toBe('2027-2028');
    const entry = res.body.me.academicYears.find((a: { label: string }) => a.label === '2027-2028');
    expect(entry).toMatchObject({ needsSetup: true, hasAdviser: false, isCurrent: false, membership: null });
    expect(await prisma.ayCounter.count({ where: { academicYearId: res.body.id } })).toBe(2);

    expect((await adviser.post('/ays', { startYear: 2027 })).body.error.code).toBe('DUPLICATE');
  });

  it('does not let staff create academic years', async () => {
    const { client } = await approve('staff@test.ph');
    expect((await client.post('/ays', { startYear: 2027 })).status).toBe(403);
  });

  it('moves the current AY, and only closes a year that is not current', async () => {
    const next = await createEmptyAy(2027);
    expect((await adviser.post(`/ays/${source.id}/close`)).body.error.code).toBe('IS_CURRENT');

    expectStatus(await adviser.post(`/ays/${next.id}/make-current`), 200);
    expect((await prisma.academicYear.findUniqueOrThrow({ where: { id: next.id } })).isCurrent).toBe(true);
    expect((await prisma.academicYear.findUniqueOrThrow({ where: { id: source.id } })).isCurrent).toBe(false);

    const closed = expectStatus(await adviser.post(`/ays/${source.id}/close`), 200);
    const entry = closed.body.me.academicYears.find((a: { id: string }) => a.id === source.id);
    expect(entry.status).toBe('closed');

    // a closed AY can't become current again until it is reopened
    expect((await adviser.post(`/ays/${source.id}/make-current`)).body.error.code).toBe('AY_CLOSED');
    expectStatus(await adviser.post(`/ays/${source.id}/reopen`), 200);
  });

  it('only lets an AY’s own adviser close it', async () => {
    const { client } = await approve('staff@test.ph');
    const next = await createEmptyAy(2027);
    expect((await client.post(`/ays/${next.id}/close`)).status).toBe(403);
  });
});

describe('Copy Wizard', () => {
  async function buildSource() {
    const { userId: staffId } = await approve('collector@test.ph');
    expectStatus(await adviser.patch('/settings', { orgName: 'Sample Student Organization', schoolAbbr: 'SSU', yearLevelCount: 4 }), 200);
    expectStatus(await adviser.put(`/approvers/${staffId}`, { approvesFundRequests: true, approvesLiquidations: true }), 200);

    const bsit = await createProgram(source.id, 'BSIT');
    const bscs = await createProgram(source.id, 'BSCS');
    const sectionA = await createSection(source.id, 'A');
    const studentFee = await createFund(source.id, { name: 'Student Fee', amount: 50_000, priority: 1 });
    const palaro = await createFund(source.id, { name: 'Palaro', amount: 10_000, priority: 2, yearLevels: [1, 2], programIds: [bsit.id] });

    const firstYear = await createStudent(source.id, { number: '1001', first: 'Jhon', last: 'Gadiana', programId: bsit.id, yearLevel: 1, sectionId: sectionA.id });
    await createStudent(source.id, { number: '1002', first: 'Lia', last: 'Ramos', programId: bscs.id, yearLevel: 3 });
    await createStudent(source.id, { number: '1003', first: 'Graduating', last: 'Senior', programId: bscs.id, yearLevel: 4 });

    await recordCollection({ academicYearId: source.id, studentId: firstYear.id, fundId: studentFee.id, amount: 40_000, processedById: staffId });
    await recordCollection({ academicYearId: source.id, studentId: firstYear.id, fundId: palaro.id, amount: 10_000, processedById: staffId });
    return { staffId, bsit, studentFee, palaro, firstYear };
  }

  it('previews exactly what will be copied', async () => {
    await buildSource();
    const target = await createEmptyAy(2027);
    const params = new URLSearchParams({ sourceAyId: source.id, ...Object.fromEntries(Object.keys(ALL).map((k) => [k, '1'])) });
    const preview = expectStatus(await adviser.get(`/ays/${target.id}/setup-preview?${params}`), 200).body;

    expect(preview.adviser).toEqual({ name: 'Maria Santos', willCopy: true });
    expect(preview.staff.people).toEqual([{ name: 'Juan Dela Cruz', position: 'Collector' }]);
    expect(preview.funds.items.map((f: { name: string }) => f.name)).toEqual(['Student Fee', 'Palaro']);
    expect(preview.carryOver.items).toEqual([
      { fundName: 'Student Fee', label: 'Remaining balance from Student Fee AY 2026-2027', amount: 40_000, committed: 0 },
      { fundName: 'Palaro', label: 'Remaining balance from Palaro AY 2026-2027', amount: 10_000, committed: 0 },
    ]);
    expect(preview.students).toEqual({ promotable: 2, graduating: 1 });
    expect(preview.warnings.join(' ')).toMatch(/still open/);

    // preview writes nothing
    expect(await prisma.aySetting.findUnique({ where: { academicYearId: target.id } })).toBeNull();
  });

  it('copies everything chosen in one go, and nothing else', async () => {
    const { staffId, bsit, studentFee } = await buildSource();
    const target = await createEmptyAy(2027);
    const sourceCounts = {
      payments: await prisma.payment.count({ where: { academicYearId: source.id } }),
      ledger: await prisma.fundLedger.count({ where: { academicYearId: source.id } }),
      students: await prisma.student.count({ where: { academicYearId: source.id } }),
    };

    const res = expectStatus(await adviser.post(`/ays/${target.id}/setup`, { sourceAyId: source.id, options: ALL }), 200);
    expect(res.body.summary).toMatchObject({
      settingsCopied: true,
      adviserCopied: true,
      staff: 1,
      approvers: 1,
      funds: 2,
      carryOver: { entries: 2, total: 50_000 },
      students: 2,
    });

    const T = target.id;
    // settings and structure, re-created inside the new AY
    expect((await prisma.aySetting.findUniqueOrThrow({ where: { academicYearId: T } })).schoolAbbr).toBe('SSU');
    const targetBsit = await prisma.program.findFirstOrThrow({ where: { academicYearId: T, code: 'BSIT' } });
    expect(targetBsit.id).not.toBe(bsit.id);
    expect(await prisma.section.count({ where: { academicYearId: T } })).toBe(1);

    // people: same accounts, new memberships with positions of the new AY
    const memberships = await prisma.userAyRole.findMany({ where: { academicYearId: T }, include: { designation: true } });
    expect(memberships.find((m) => m.role === 'adviser')?.status).toBe('active');
    const staff = memberships.find((m) => m.userId === staffId)!;
    expect(staff).toMatchObject({ role: 'member', status: 'active' });
    expect(staff.designation).toMatchObject({ name: 'Collector', academicYearId: T });
    expect(await prisma.ayApprover.count({ where: { academicYearId: T, userId: staffId } })).toBe(1);

    // funds: definitions only, programs re-pointed to the new AY's programs
    const palaro = await prisma.fund.findFirstOrThrow({ where: { academicYearId: T, name: 'Palaro' }, include: { yearLevels: true, programs: true } });
    expect(palaro.yearLevels.map((y) => y.yearLevel).sort()).toEqual([1, 2]);
    expect(palaro.programs.map((p) => p.programId)).toEqual([targetBsit.id]);
    expect(await prisma.studentCharge.count({ where: { academicYearId: T } })).toBe(0);
    expect(await prisma.payment.count({ where: { academicYearId: T } })).toBe(0);

    // carry-over: one labelled ledger entry per fund, counted in the fund's balance
    const newFee = await prisma.fund.findFirstOrThrow({ where: { academicYearId: T, name: 'Student Fee' } });
    const carry = await prisma.fundLedger.findFirstOrThrow({ where: { fundId: newFee.id } });
    expect(carry).toMatchObject({
      entryType: 'carry_over',
      amount: 40_000n,
      label: 'Remaining balance from Student Fee AY 2026-2027',
      sourceFundId: studentFee.id,
      sourceAcademicYearId: source.id,
    });
    const [balance] = await prisma.$queryRaw<{ balance: bigint }[]>`SELECT balance FROM v_fund_balances WHERE fund_id = ${newFee.id}::uuid`;
    expect(balance!.balance).toBe(40_000n);

    // students: one level up, waiting for staff to confirm, with a fresh QR token; the graduate stays behind
    const promoted = await prisma.student.findMany({ where: { academicYearId: T }, include: { qrTokens: true }, orderBy: { studentNumber: 'asc' } });
    expect(promoted.map((s) => [s.studentNumber, s.yearLevel])).toEqual([
      ['1001', 2],
      ['1002', 4],
    ]);
    expect(promoted.every((s) => s.needsProfileConfirmation && s.source === 'promoted')).toBe(true);
    expect(promoted.every((s) => s.qrTokens.length === 1 && s.qrTokens[0]!.isActive)).toBe(true);

    // the source AY is untouched
    expect({
      payments: await prisma.payment.count({ where: { academicYearId: source.id } }),
      ledger: await prisma.fundLedger.count({ where: { academicYearId: source.id } }),
      students: await prisma.student.count({ where: { academicYearId: source.id } }),
    }).toEqual(sourceCounts);

    // the run is recorded, and can't happen twice
    expect(await prisma.ayCopyRun.count({ where: { targetAcademicYearId: T } })).toBe(1);
    expect((await adviser.post(`/ays/${T}/setup`, { sourceAyId: source.id, options: ALL })).body.error.code).toBe('ALREADY_SET_UP');
  });

  it('blocks payments for promoted students until staff confirm their course/year/section', async () => {
    const { staffId } = await buildSource();
    const target = await createEmptyAy(2027);
    expectStatus(await adviser.post(`/ays/${target.id}/setup`, { sourceAyId: source.id, options: ALL }), 200);
    const student = await prisma.student.findFirstOrThrow({ where: { academicYearId: target.id, studentNumber: '1001' } });
    const fund = await prisma.fund.findFirstOrThrow({ where: { academicYearId: target.id, name: 'Student Fee' } });

    await expect(
      recordCollection({ academicYearId: target.id, studentId: student.id, fundId: fund.id, amount: 100, processedById: staffId }),
    ).rejects.toThrow(/confirmed course\/year\/section/);

    await prisma.student.update({ where: { id: student.id }, data: { needsProfileConfirmation: false, profileConfirmedAt: new Date() } });
    await expect(
      recordCollection({ academicYearId: target.id, studentId: student.id, fundId: fund.id, amount: 100, processedById: staffId }),
    ).resolves.toBeTruthy();
  });

  it('starts fresh with default settings and positions', async () => {
    const target = await createEmptyAy(2027);
    const res = expectStatus(await adviser.post(`/ays/${target.id}/setup`, { options: {} }), 200);
    expect(res.body.summary).toMatchObject({ settingsCopied: false, designations: 7, staff: 0, funds: 0 });
    expect(res.body.me.academicYears.find((a: { id: string }) => a.id === target.id).needsSetup).toBe(false);
    // nobody was copied, so the next person to join becomes its adviser
    expect(await prisma.userAyRole.count({ where: { academicYearId: target.id } })).toBe(0);
    expect(await prisma.ayCopyRun.count()).toBe(0);
  });

  it('refuses options without the options they depend on', async () => {
    const target = await createEmptyAy(2027);
    const res = await adviser.post(`/ays/${target.id}/setup`, { sourceAyId: source.id, options: { staff: true } });
    expect(res.status).toBe(400);
    const carry = await adviser.post(`/ays/${target.id}/setup`, { sourceAyId: source.id, options: { settings: true, carryOver: true } });
    expect(carry.status).toBe(400);
  });

  it('only lets an adviser of the source AY copy from it', async () => {
    const { client } = await approve('staff@test.ph');
    const target = await createEmptyAy(2027);
    const res = await client.post(`/ays/${target.id}/setup`, { sourceAyId: source.id, options: { settings: true } });
    expect(res.status).toBe(403);
  });

  it('rolls everything back if any part of the copy fails', async () => {
    await buildSource();
    const target = await createEmptyAy(2027);
    // a student already sitting in the target AY with the same number makes the promotion step fail
    const stray = await createProgram(target.id, 'XTRA');
    await createStudent(target.id, { number: '1001', first: 'Stray', last: 'Record', programId: stray.id, yearLevel: 1 });

    const res = await adviser.post(`/ays/${target.id}/setup`, { sourceAyId: source.id, options: ALL });
    expect(res.status).toBe(409);

    const T = target.id;
    expect(await prisma.aySetting.findUnique({ where: { academicYearId: T } })).toBeNull();
    expect(await prisma.userAyRole.count({ where: { academicYearId: T } })).toBe(0);
    expect(await prisma.fund.count({ where: { academicYearId: T } })).toBe(0);
    expect(await prisma.fundLedger.count({ where: { academicYearId: T } })).toBe(0);
    expect(await prisma.ayCopyRun.count()).toBe(0);
  });
});
