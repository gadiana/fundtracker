import { beforeEach, describe, expect, it } from 'vitest';
import { CrossAyError, forAy, prisma } from '../src/db';
import { Client, createAy, expectStatus, registerAndLogin, resetDb, signupBody } from './helpers';

let ay1: Awaited<ReturnType<typeof createAy>>;
let ay2: Awaited<ReturnType<typeof createAy>>;

beforeEach(async () => {
  await resetDb();
  ay1 = await createAy(2026, { current: true });
  ay2 = await createAy(2027, { current: false });
});

describe('academic year isolation', () => {
  it('a scoped client only sees its own AY', async () => {
    const db1 = forAy(ay1.ay.id);
    const db2 = forAy(ay2.ay.id);

    const names1 = (await db1.designation.findMany()).map((d) => d.academicYearId);
    expect(new Set(names1)).toEqual(new Set([ay1.ay.id]));
    expect(await db2.designation.count()).toBe(2);

    // looking up another AY's row by its id finds nothing
    expect(await db1.designation.findUnique({ where: { id: ay2.designations.collector.id } })).toBeNull();
    expect(await db1.designation.findFirst({ where: { id: ay2.designations.collector.id } })).toBeNull();
  });

  it('a scoped client cannot update or delete another AY’s rows', async () => {
    const db1 = forAy(ay1.ay.id);
    const updated = await db1.designation.updateMany({
      where: { id: ay2.designations.collector.id },
      data: { name: 'Hacked' },
    });
    expect(updated.count).toBe(0);
    await expect(
      db1.designation.update({ where: { id: ay2.designations.collector.id }, data: { name: 'Hacked' } }),
    ).rejects.toThrow();
    const untouched = await prisma.designation.findUniqueOrThrow({ where: { id: ay2.designations.collector.id } });
    expect(untouched.name).toBe('Collector');
  });

  it('a scoped client refuses to create rows for another AY', async () => {
    const db1 = forAy(ay1.ay.id);
    await expect(db1.program.create({ data: { academicYearId: ay2.ay.id, code: 'BSIT', name: 'IT' } })).rejects.toThrow(CrossAyError);

    const created = await db1.program.create({ data: { code: 'BSIT', name: 'IT' } as never });
    expect(created.academicYearId).toBe(ay1.ay.id);
  });

  it('the database rejects a membership that points at another AY’s position', async () => {
    const user = await prisma.user.create({
      data: { email: 'x@test.ph', passwordHash: 'x', firstName: 'X', lastName: 'Y' },
    });
    await expect(
      prisma.userAyRole.create({
        data: {
          academicYearId: ay1.ay.id,
          userId: user.id,
          role: 'member',
          status: 'active',
          designationId: ay2.designations.collector.id, // belongs to AY 2027
        },
      }),
    ).rejects.toThrow();
  });

  it('access in one AY grants nothing in another', async () => {
    const adviser = await registerAndLogin('adviser@test.ph');
    expectStatus(await adviser.get('/members'), 200);

    adviser.ayId = ay2.ay.id;
    const res = await adviser.get('/members');
    expect(res.status).toBe(403);
    const designations = await adviser.get('/designations');
    expect(designations.body.error.code).toBe('NO_AY_ACCESS');
  });

  it('an existing user asking to join another AY waits for its advisers, even when it has none', async () => {
    await registerAndLogin('adviser@test.ph');
    const staff = await registerAndLogin('staff@test.ph'); // pending in AY 2026

    staff.ayId = ay2.ay.id;
    const res = expectStatus(await staff.post('/ays/request-access'), 200);
    expect(res.body).toMatchObject({ role: null, status: 'pending' });
    expect(await prisma.userAyRole.count({ where: { academicYearId: ay2.ay.id, role: 'adviser' } })).toBe(0);
  });

  it('a closed AY is read-only', async () => {
    const adviser = await registerAndLogin('adviser@test.ph');
    const c = await Client.create();
    expectStatus(await c.post('/auth/signup', signupBody('pending@test.ph')), 201);
    const [pending] = (await adviser.get('/members?status=pending')).body.items;

    await prisma.academicYear.update({ where: { id: ay1.ay.id }, data: { status: 'closed' } });
    const res = await adviser.post(`/members/${pending.id}/approve`, { designationId: ay1.designations.collector.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AY_CLOSED');
    // reading still works
    expectStatus(await adviser.get('/members'), 200);
  });
});
