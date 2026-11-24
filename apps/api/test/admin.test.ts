import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { describeDevice, visitEnd } from '../src/lib/presence';
import { createAy, expectStatus, registerAndLogin, resetDb, superadminClient, type Client } from './helpers';

let adviser: Client;

beforeEach(async () => {
  await resetDb();
  await createAy();
  adviser = await registerAndLogin('adviser@test.ph');
});

describe('sessions without an idle timeout', () => {
  it('keeps working after hours without a request, and starts a new visit after the gap', async () => {
    const session = await prisma.userSession.findFirstOrThrow({ where: { revokedAt: null } });
    const hoursAgo = new Date(Date.now() - 3 * 3_600_000);
    await prisma.userSession.update({ where: { id: session.id }, data: { lastSeenAt: hoursAgo } });
    await prisma.userVisit.updateMany({ where: { sessionId: session.id }, data: { startedAt: new Date(hoursAgo.getTime() - 60_000), lastSeenAt: hoursAgo } });

    expectStatus(await adviser.get('/auth/me'), 200);
    const visits = await prisma.userVisit.findMany({ where: { sessionId: session.id }, orderBy: { startedAt: 'asc' } });
    expect(visits).toHaveLength(2);
    // the earlier visit ended when they went quiet; the new one is open
    expect(visitEnd(visits[0]!)).toEqual(hoursAgo);
    expect(visitEnd(visits[1]!)).toBeNull();
  });

  it('ends the visit on logout', async () => {
    expectStatus(await adviser.post('/auth/logout'), 200);
    const visit = await prisma.userVisit.findFirstOrThrow();
    expect(visit.endedAt).not.toBeNull();
  });
});

describe('superadmin activity page', () => {
  it('shows who is online, each visit and the hours spent', async () => {
    const superadmin = await superadminClient();
    const res = expectStatus(await superadmin.get('/admin/activity'), 200).body;
    expect(res.online.map((o: { name: string }) => o.name).sort()).toEqual(['Sofia Super', 'Test User']);
    const adviserRow = res.people.find((p: { name: string }) => p.name === 'Test User');
    expect(adviserRow).toMatchObject({ role: 'Adviser', online: true, visits: 1 });
    expect(res.visits[0]).toMatchObject({ device: expect.any(String), online: true, endedAt: null });

    expectStatus(await adviser.post('/auth/logout'), 200);
    const after = expectStatus(await superadmin.get('/admin/activity'), 200).body;
    expect(after.online.map((o: { name: string }) => o.name)).toEqual(['Sofia Super']);
    expect(after.visits.find((v: { name: string }) => v.name === 'Test User').endedAt).not.toBeNull();

    expect((await adviser.get('/admin/activity')).status).toBe(401);
  });

  it('names the device from the browser', () => {
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')).toBe('Chrome on Windows');
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iPhone');
    expect(describeDevice('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 EdgA/130.0')).toBe('Chrome on Android');
    expect(describeDevice(null)).toBe('Unknown device');
  });
});
