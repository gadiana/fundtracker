import { beforeEach, describe, expect, it } from 'vitest';
import type { AcademicYear, Program, Section } from '@prisma/client';
import { prisma } from '../src/db';
import { createProgram, createSection } from './fixtures';
import { Client, createAy, expectStatus, registerAndLogin, resetDb, type Client as ClientType } from './helpers';

let ay: AcademicYear;
let bsit: Program;
let sectionA: Section;
let adviser: ClientType;
let collector: ClientType;
let president: ClientType;

async function approve(email: string, designationId: string, names: [string, string]) {
  const c = await registerAndLogin(email, undefined, names);
  const pending = (await adviser.get('/members?status=pending')).body.items.find((m: { user: { email: string } }) => m.user.email === email);
  expectStatus(await adviser.post(`/members/${pending.id}/approve`, { designationId }), 200);
  return c;
}

beforeEach(async () => {
  await resetDb();
  const created = await createAy(2026);
  ay = created.ay;
  bsit = await createProgram(ay.id, 'BSIT');
  sectionA = await createSection(ay.id, 'A');
  adviser = await registerAndLogin('adviser@test.ph', undefined, ['Maria', 'Santos']);
  collector = await approve('collector@test.ph', created.designations.collector.id, ['Carlo', 'Reyes']);
  president = await approve('president@test.ph', created.designations.president.id, ['Paolo', 'Lim']);
});

const student = (over: Record<string, unknown> = {}) => ({
  studentNumber: '1001',
  firstName: 'Jhon Ezekiel',
  middleName: 'B.',
  lastName: 'Gadiana',
  programId: bsit.id,
  yearLevel: 1,
  sectionId: sectionA.id,
  ...over,
});

describe('adding students', () => {
  it('lets collectors add students, who get a QR token right away', async () => {
    const res = expectStatus(await collector.post('/students', student({ email: 'Jhon@Example.com' })), 201);
    expect(res.body).toMatchObject({ studentNumber: '1001', name: 'Jhon Ezekiel B. Gadiana', status: 'active', source: 'manual', email: 'jhon@example.com' });
    expect(res.body.createdByName).toBe('Carlo Reyes');
    expect(await prisma.studentQrToken.count({ where: { studentId: res.body.id, isActive: true } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: 'student', action: 'create', entityId: res.body.id } })).toBe(1);
  });

  it('sorts the list by name or by student number, either way round', async () => {
    for (const [studentNumber, firstName, lastName] of [
      ['2001', 'Ana', 'Cruz'],
      ['2003', 'Ben', 'Abad'],
      ['2002', 'Cara', 'Bello'],
    ]) {
      expectStatus(await collector.post('/students', student({ studentNumber, firstName, middleName: null, lastName })), 201);
    }
    const order = async (sort?: string) =>
      expectStatus(await collector.get(`/students${sort ? `?sort=${sort}` : ''}`), 200).body.items.map((s: { studentNumber: string }) => s.studentNumber);
    expect(await order()).toEqual(['2003', '2002', '2001']); // Abad, Bello, Cruz
    expect(await order('name_desc')).toEqual(['2001', '2002', '2003']);
    expect(await order('number')).toEqual(['2001', '2002', '2003']);
    expect(await order('number_desc')).toEqual(['2003', '2002', '2001']);
    expect((await collector.get('/students?sort=age')).status).toBe(400);
  });

  it('keeps people without the collect permission out', async () => {
    expect((await president.get('/students')).status).toBe(403);
    expect((await president.post('/students', student())).status).toBe(403);
  });

  it('never allows the same student number twice in an AY, however it is typed', async () => {
    expectStatus(await collector.post('/students', student()), 201);
    const res = await collector.post('/students', student({ studentNumber: ' 1001 ', firstName: 'Someone', middleName: null, lastName: 'Else' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STUDENT_NUMBER_TAKEN');
  });

  it('flags the same name under a different number, and only the adviser can override it with a reason', async () => {
    expectStatus(await collector.post('/students', student()), 201);

    const byStaff = await collector.post('/students', student({ studentNumber: '1002', middleName: 'B' }));
    expect(byStaff.status).toBe(409);
    expect(byStaff.body.error).toMatchObject({ code: 'POSSIBLE_DUPLICATE', details: { level: 'exact', canOverride: false } });
    expect(byStaff.body.error.details.matches[0]).toMatchObject({ studentNumber: '1001', strength: 'exact' });
    // a staff "reason" doesn't help
    expect((await collector.post('/students', student({ studentNumber: '1002', duplicateOverrideReason: 'trust me please' }))).status).toBe(409);

    const noReason = await adviser.post('/students', student({ studentNumber: '1002' }));
    expect(noReason.body.error.details).toMatchObject({ level: 'exact', canOverride: true });

    const ok = expectStatus(await adviser.post('/students', student({ studentNumber: '1002', duplicateOverrideReason: 'Twins; checked with the registrar' })), 201);
    expect(ok.body).toMatchObject({ duplicateOverride: true, duplicateOverrideByName: 'Maria Santos', duplicateFlag: null });

    // both stay flagged so they can be reviewed later
    const groups = expectStatus(await collector.get('/students/duplicates'), 200).body.groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].level).toBe('exact');
    expect(groups[0].students.map((s: { studentNumber: string }) => s.studentNumber)).toEqual(['1001', '1002']);
    const list = expectStatus(await collector.get('/students?flag=duplicates'), 200).body.items;
    expect(list.every((s: { duplicateFlag: string }) => s.duplicateFlag === 'exact')).toBe(true);
  });

  it('asks staff to confirm a similar name (same first and last name)', async () => {
    expectStatus(await collector.post('/students', student()), 201);
    const similar = student({ studentNumber: '1003', middleName: 'Bautista' });
    const res = await collector.post('/students', similar);
    expect(res.body.error.details).toMatchObject({ level: 'similar', canOverride: true });
    expectStatus(await collector.post('/students', { ...similar, acknowledgeSimilar: true }), 201);
  });

  it('only accepts this AY’s active programs and valid year levels', async () => {
    const other = await createAy(2027, { current: false });
    const foreign = await createProgram(other.ay.id, 'BSIT');
    expect((await collector.post('/students', student({ programId: foreign.id }))).body.error.code).toBe('INVALID_PROGRAM');
    expect((await collector.post('/students', student({ yearLevel: 6 }))).body.error.code).toBe('INVALID_YEAR_LEVEL');
    await prisma.program.update({ where: { id: bsit.id }, data: { isActive: false } });
    expect((await collector.post('/students', student())).body.error.code).toBe('INVALID_PROGRAM');
  });

  it('is blocked in a closed academic year', async () => {
    await prisma.academicYear.update({ where: { id: ay.id }, data: { status: 'closed' } });
    expect((await collector.post('/students', student())).body.error.code).toBe('AY_CLOSED');
  });
});

describe('editing and status', () => {
  it('re-checks duplicates when the number or name changes', async () => {
    expectStatus(await collector.post('/students', student()), 201);
    const other = expectStatus(await collector.post('/students', student({ studentNumber: '2001', firstName: 'Ana', middleName: null, lastName: 'Cruz' })), 201).body;

    expect((await collector.patch(`/students/${other.id}`, { studentNumber: '1001' })).body.error.code).toBe('STUDENT_NUMBER_TAKEN');
    expect((await collector.patch(`/students/${other.id}`, { firstName: 'Jhon Ezekiel', middleName: 'B.', lastName: 'Gadiana' })).body.error.code).toBe(
      'POSSIBLE_DUPLICATE',
    );
    const ok = expectStatus(await collector.patch(`/students/${other.id}`, { yearLevel: 2, contactNo: '09171234567' }), 200);
    expect(ok.body).toMatchObject({ yearLevel: 2, contactNo: '09171234567' });

    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: other.id, action: 'update' } });
    expect(log.beforeData).toMatchObject({ yearLevel: 1 });
    expect(log.afterData).toMatchObject({ yearLevel: 2 });
  });

  it('deactivates and reactivates instead of deleting', async () => {
    const s = expectStatus(await collector.post('/students', student()), 201).body;
    expect(expectStatus(await collector.post(`/students/${s.id}/deactivate`, { reason: 'Dropped' }), 200).body.status).toBe('inactive');
    expect((await collector.get('/students')).body.items).toHaveLength(0);
    expect((await collector.get('/students?status=inactive')).body.items).toHaveLength(1);
    expect(expectStatus(await collector.post(`/students/${s.id}/reactivate`), 200).body.status).toBe('active');
    expect((await collector.delete(`/students/${s.id}`)).status).toBe(404);
  });

  it('confirms the course/year/section of a promoted student', async () => {
    const s = await prisma.student.create({
      data: {
        academicYearId: ay.id,
        studentNumber: '3001',
        firstName: 'Lia',
        lastName: 'Ramos',
        nameKey: 'liaramos',
        nameKeyLoose: 'liaramos',
        programId: bsit.id,
        yearLevel: 2,
        source: 'promoted',
        needsProfileConfirmation: true,
      },
    });
    expect((await collector.get('/students?flag=needs_confirmation')).body.items).toHaveLength(1);

    const res = expectStatus(await collector.post(`/students/${s.id}/confirm-profile`, { programId: bsit.id, yearLevel: 3, sectionId: sectionA.id }), 200);
    expect(res.body).toMatchObject({ needsProfileConfirmation: false, yearLevel: 3, profileConfirmedByName: 'Carlo Reyes' });
    expect((await collector.post(`/students/${s.id}/confirm-profile`, { programId: bsit.id, yearLevel: 3 })).body.error.code).toBe('ALREADY_CONFIRMED');
  });

  it('keeps other AYs’ students invisible', async () => {
    const other = await createAy(2027, { current: false });
    const p = await createProgram(other.ay.id, 'BSIT');
    const theirs = await prisma.student.create({
      data: { academicYearId: other.ay.id, studentNumber: '9', firstName: 'X', lastName: 'Y', nameKey: 'xy', nameKeyLoose: 'xy', programId: p.id, yearLevel: 1, source: 'manual' },
    });
    expect((await collector.get(`/students/${theirs.id}`)).status).toBe(404);
    expect((await collector.patch(`/students/${theirs.id}`, { yearLevel: 2 })).status).toBe(404);
  });
});

describe('self-enrollment by QR', () => {
  async function link(body: Record<string, unknown> = {}) {
    return expectStatus(await collector.post('/enrollment-links', body), 201).body as { id: string; token: string };
  }

  it('creates a pending record that staff approve, and notifies them', async () => {
    const { token } = await link({ label: 'BSIT orientation' });
    const anon = await Client.create();
    const info = expectStatus(await anon.get(`/public/enroll/${token}`), 200).body;
    expect(info).toMatchObject({ academicYear: '2026-2027', label: 'BSIT orientation' });
    expect(info.programs.map((p: { code: string }) => p.code)).toEqual(['BSIT']);

    const submitted = expectStatus(await anon.post(`/public/enroll/${token}`, { ...student(), consent: true }), 201);
    expect(submitted.body).toMatchObject({ ok: true, studentNumber: '1001' });

    const pending = await prisma.student.findFirstOrThrow({ where: { studentNumber: '1001' } });
    expect(pending).toMatchObject({ status: 'pending', source: 'self_enroll', consentVersion: '1' });
    expect(pending.consentGivenAt).not.toBeNull();
    expect(await prisma.studentQrToken.count({ where: { studentId: pending.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { type: 'student.self_enrolled' } })).toBe(2); // adviser + collector

    const approved = expectStatus(await collector.post(`/students/${pending.id}/approve`), 200);
    expect(approved.body).toMatchObject({ status: 'active', approvedByName: 'Carlo Reyes' });
    expect(await prisma.studentQrToken.count({ where: { studentId: pending.id } })).toBe(1);
  });

  it('requires consent and refuses a number that is already registered', async () => {
    const { token } = await link();
    const anon = await Client.create();
    expect((await anon.post(`/public/enroll/${token}`, { ...student(), consent: false })).status).toBe(400);
    expectStatus(await collector.post('/students', student()), 201);
    expect((await anon.post(`/public/enroll/${token}`, { ...student(), consent: true })).body.error.code).toBe('ALREADY_REGISTERED');
  });

  it('stops working when turned off or used up', async () => {
    const limited = await link({ maxUses: 1 });
    const anon = await Client.create();
    expectStatus(await anon.post(`/public/enroll/${limited.token}`, { ...student(), consent: true }), 201);
    expect((await anon.post(`/public/enroll/${limited.token}`, { ...student({ studentNumber: '1002', firstName: 'Ana', lastName: 'Cruz' }), consent: true })).status).toBe(410);

    const other = await link();
    expectStatus(await collector.post(`/enrollment-links/${other.id}/revoke`), 200);
    expect((await anon.get(`/public/enroll/${other.token}`)).status).toBe(410);
    expect((await anon.get('/public/enroll/not-a-real-token-at-all-123')).status).toBe(404);
  });

  it('applies the duplicate rules when approving, and keeps rejections on record', async () => {
    expectStatus(await collector.post('/students', student()), 201);
    const { token } = await link();
    const anon = await Client.create();
    expectStatus(await anon.post(`/public/enroll/${token}`, { ...student({ studentNumber: '1002' }), consent: true }), 201);
    const pending = await prisma.student.findFirstOrThrow({ where: { studentNumber: '1002' } });

    expect((await collector.post(`/students/${pending.id}/approve`)).body.error.details.canOverride).toBe(false);
    expect(expectStatus(await collector.post(`/students/${pending.id}/reject`, { comment: 'Duplicate of 1001' }), 200).body).toMatchObject({
      status: 'rejected',
      rejectionComment: 'Duplicate of 1001',
    });
    // a rejected self-enrollment doesn't block the number
    expectStatus(await collector.post('/students', student({ studentNumber: '1002', firstName: 'Ana', middleName: null, lastName: 'Cruz' })), 201);
  });
});
