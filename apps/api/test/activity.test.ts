import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { describeDevice, touchVisit, visitEnd } from '../src/lib/presence';
import { createAy, expectStatus, registerAndLogin, resetDb, type Client } from './helpers';

let adviser: Client;
let ayId: string;

beforeEach(async () => {
  await resetDb();
  ayId = (await createAy()).ay.id;
  adviser = await registerAndLogin('adviser@test.ph', undefined, ['Ana', 'Adviser']);
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

  it('handles two requests at the same moment, even when one found a visit started a moment later', async () => {
    const session = await prisma.userSession.findFirstOrThrow({ where: { revokedAt: null } });
    const visit = await prisma.userVisit.findFirstOrThrow({ where: { sessionId: session.id } });
    // this request's clock reading is 3 ms before the visit another request just started
    await touchVisit(session.userId, session.id, new Date(visit.startedAt.getTime() - 3));
    const after = await prisma.userVisit.findUniqueOrThrow({ where: { id: visit.id } });
    expect(after.lastSeenAt).toEqual(visit.lastSeenAt);
    expect(await prisma.userVisit.count({ where: { sessionId: session.id } })).toBe(1);
  });

  it('ends the visit on logout', async () => {
    expectStatus(await adviser.post('/auth/logout'), 200);
    const visit = await prisma.userVisit.findFirstOrThrow();
    expect(visit.endedAt).not.toBeNull();
  });
});

describe('sign-in activity (adviser)', () => {
  it('shows who of the year is online, each visit and the hours spent, and nobody from other years', async () => {
    // someone who only belongs to another academic year
    await prisma.academicYear.update({ where: { id: ayId }, data: { isCurrent: false } });
    const other = await createAy(2027);
    await registerAndLogin('outsider@test.ph', other.ay.id, ['Olga', 'Outsider']);
    await prisma.academicYear.update({ where: { id: other.ay.id }, data: { isCurrent: false } });
    await prisma.academicYear.update({ where: { id: ayId }, data: { isCurrent: true } });

    const officer = await registerAndLogin('officer@test.ph', undefined, ['Carlo', 'Officer']);

    const res = expectStatus(await adviser.get('/audit/activity'), 200).body;
    expect(res.online.map((o: { name: string }) => o.name).sort()).toEqual(['Ana Adviser', 'Carlo Officer']);
    expect(res.people.find((p: { name: string }) => p.name === 'Ana Adviser')).toMatchObject({ role: 'Adviser', online: true, visits: 1 });
    expect(res.people.find((p: { name: string }) => p.name === 'Carlo Officer')).toMatchObject({ role: 'No access yet' });
    expect(JSON.stringify(res)).not.toContain('Outsider');
    expect(res.visits[0]).toMatchObject({ device: expect.any(String), online: true, endedAt: null });

    expectStatus(await officer.post('/auth/logout'), 200);
    const after = expectStatus(await adviser.get('/audit/activity'), 200).body;
    expect(after.online.map((o: { name: string }) => o.name)).toEqual(['Ana Adviser']);
    expect(after.visits.find((v: { name: string }) => v.name === 'Carlo Officer').endedAt).not.toBeNull();
  });

  it('is only for the adviser', async () => {
    const officer = await registerAndLogin('officer@test.ph');
    expect((await officer.get('/audit/activity')).status).toBe(403);
  });

  it('names the device from the browser', () => {
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')).toBe('Chrome on Windows');
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iPhone');
    expect(describeDevice('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 EdgA/130.0')).toBe('Chrome on Android');
    expect(describeDevice(null)).toBe('Unknown device');
  });
});
