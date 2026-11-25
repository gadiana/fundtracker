import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { Client, createAy, expectStatus, PASSWORD, registerAndLogin, resetDb, signupBody, tokenFromMail } from './helpers';

let ayId: string;
let collectorId: string;

beforeEach(async () => {
  await resetDb();
  const { ay, designations } = await createAy();
  ayId = ay.id;
  collectorId = designations.collector.id;
});

describe('audit log', () => {
  it('records signup, login and approval, shown to the adviser only as plain sentences', async () => {
    const adviser = await registerAndLogin('adviser@test.ph');
    const c = await Client.create();
    expectStatus(await c.post('/auth/signup', signupBody('staff@test.ph', 'Carla', 'Reyes')), 201);
    const staffToken = tokenFromMail('staff@test.ph');
    const [pending] = (await adviser.get('/members?status=pending')).body.items;
    expectStatus(await adviser.post(`/members/${pending.id}/approve`, { designationId: collectorId }), 200);

    const full = expectStatus(await adviser.get('/audit?pageSize=100'), 200).body;
    const actions = full.items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(expect.arrayContaining(['signup', 'verify_email', 'login', 'approve']));
    const approve = full.items.find((i: { action: string }) => i.action === 'approve');
    expect(approve.summary).toBe('Test User approved Carla Reyes as Collector');
    expect(approve).not.toHaveProperty('before');
    expect(approve).not.toHaveProperty('after');
    expect(approve.actorName).toBe('Test User');
    expect(approve.actorDesignation).toBe('Adviser');

    expect(approve).toMatchObject({ entityType: 'user_ay_role', ipAddress: expect.any(String) });
    expect(full.items.every((i: { device: string | null }) => i.device === null || typeof i.device === 'string')).toBe(true);

    const filters = expectStatus(await adviser.get('/audit/filters'), 200).body;
    expect(filters.actions).toEqual(expect.arrayContaining(['approve', 'login', 'signup']));
    expect(expectStatus(await adviser.get('/audit?action=approve'), 200).body.items).toHaveLength(1);

    // officers don't see the log
    expectStatus(await c.post('/auth/verify-email', { token: staffToken }), 200);
    expectStatus(await c.post('/auth/login', { email: 'staff@test.ph', password: PASSWORD }), 200);
    expect((await c.get('/audit')).status).toBe(403);
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
