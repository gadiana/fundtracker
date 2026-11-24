import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { Client, createAy, expectStatus, registerAndLogin, resetDb, signupBody, superadminClient } from './helpers';

let ayId: string;
let collectorId: string;

beforeEach(async () => {
  await resetDb();
  const { ay, designations } = await createAy();
  ayId = ay.id;
  collectorId = designations.collector.id;
});

describe('audit log', () => {
  it('records signup, login and approval with before/after snapshots, shown in full only to the superadmin', async () => {
    const adviser = await registerAndLogin('adviser@test.ph');
    const c = await Client.create();
    expectStatus(await c.post('/auth/signup', signupBody('staff@test.ph', 'Carla', 'Reyes')), 201);
    const [pending] = (await adviser.get('/members?status=pending')).body.items;
    expectStatus(await adviser.post(`/members/${pending.id}/approve`, { designationId: collectorId }), 200);

    const superadmin = await superadminClient();
    const full = expectStatus(await superadmin.get(`/admin/audit?pageSize=100&ayId=${ayId}`), 200).body;
    const actions = full.items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(expect.arrayContaining(['signup', 'verify_email', 'login', 'approve']));
    const approve = full.items.find((i: { action: string }) => i.action === 'approve');
    expect(approve.before).toMatchObject({ status: 'pending' });
    expect(approve.after).toMatchObject({ status: 'active', designation: 'Collector' });
    expect(approve.actorName).toBe('Test User');
    expect(approve.actorDesignation).toBe('Adviser');

    // the adviser sees only staff and student activity, in words, with no codes
    const simple = expectStatus(await adviser.get('/audit?pageSize=100'), 200).body;
    expect(simple.items.map((i: { summary: string }) => i.summary)).toEqual(['Approved Carla Reyes as Collector', 'Carla Reyes signed up', 'Test User signed up']);
    expect(JSON.stringify(simple)).not.toMatch(/"before"|"after"|ipAddress|"action"|login/);
    expect((await adviser.get('/admin/audit')).body.error.code).toBe('SUPERADMIN_ONLY');
  });

  it('never stores passwords or tokens', async () => {
    await registerAndLogin('adviser@test.ph');
    const rows = await prisma.auditLog.findMany();
    const dump = JSON.stringify(rows.map((r) => [r.beforeData, r.afterData]));
    expect(dump).not.toMatch(/argon2|\$argon/);
  });

  it('is append-only at the database level', async () => {
    await registerAndLogin('adviser@test.ph');
    const row = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  it('is visible to the adviser only', async () => {
    const adviser = await registerAndLogin('adviser@test.ph');
    const staff = await registerAndLogin('staff@test.ph');
    const [pending] = (await adviser.get('/members?status=pending')).body.items;
    expectStatus(await adviser.post(`/members/${pending.id}/approve`, { designationId: collectorId }), 200);

    expect((await staff.get('/audit')).status).toBe(403);
  });
});

describe('database guards from the approved schema', () => {
  it('allows only one current AY, and more than one adviser per AY', async () => {
    await expect(
      prisma.academicYear.create({ data: { startYear: 2030, endYear: 2031, label: '2030-2031', isCurrent: true } }),
    ).rejects.toThrow();

    const users = await Promise.all(
      ['a', 'b'].map((n) => prisma.user.create({ data: { email: `${n}@test.ph`, passwordHash: 'x', firstName: n, lastName: n } })),
    );
    await prisma.userAyRole.create({ data: { academicYearId: ayId, userId: users[0]!.id, role: 'adviser', status: 'active' } });
    await prisma.userAyRole.create({ data: { academicYearId: ayId, userId: users[1]!.id, role: 'adviser', status: 'active' } });
    expect(await prisma.userAyRole.count({ where: { academicYearId: ayId, role: 'adviser' } })).toBe(2);
  });

  it('requires a position for active members', async () => {
    const user = await prisma.user.create({ data: { email: 'm@test.ph', passwordHash: 'x', firstName: 'M', lastName: 'M' } });
    await expect(
      prisma.userAyRole.create({ data: { academicYearId: ayId, userId: user.id, role: 'member', status: 'active' } }),
    ).rejects.toThrow(/ck_membership_role/);
  });

  it('rejects malformed academic years', async () => {
    await expect(
      prisma.academicYear.create({ data: { startYear: 2031, endYear: 2033, label: '2031-2033' } }),
    ).rejects.toThrow(/ck_ay_end_year/);
  });
});
