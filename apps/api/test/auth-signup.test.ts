import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { sentMail } from '../src/lib/mailer';
import {
  Client,
  createAy,
  expectStatus,
  PASSWORD,
  registerAndLogin,
  resetDb,
  signupBody,
  tokenFromMail,
} from './helpers';

let ayId: string;
let collectorId: string;

beforeEach(async () => {
  await resetDb();
  const { ay, designations } = await createAy();
  ayId = ay.id;
  collectorId = designations.collector.id;
});

describe('signup and approval', () => {
  it('makes the first sign-up the adviser, even when several sign up at once; everyone after waits for approval', async () => {
    const clients = await Promise.all(Array.from({ length: 6 }, () => Client.create()));
    (await Promise.all(clients.map((x, i) => x.post('/auth/signup', signupBody(`race${i}@test.ph`))))).forEach((r) => expectStatus(r, 201));
    expect(await prisma.userAyRole.count({ where: { academicYearId: ayId, role: 'adviser', status: 'active' } })).toBe(1);
    expect(await prisma.userAyRole.count({ where: { academicYearId: ayId, status: 'pending' } })).toBe(5);

    const late = expectStatus(await (await Client.create()).post('/auth/signup', signupBody('late@test.ph')), 201);
    expect(late.body).toMatchObject({ role: null, status: 'pending' });
  });

  it('creates the current academic year on a brand-new installation, with the first sign-up as its adviser', async () => {
    await resetDb();
    const c = await Client.create();
    const first = expectStatus(await c.post('/auth/signup', signupBody('first@test.ph')), 201).body;
    expect(first).toMatchObject({ role: 'adviser', status: 'active' });
    const ay = await prisma.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
    expect(first.academicYear).toBe(ay.label);
    expect(ay.endYear).toBe(ay.startYear + 1);
    expect(await prisma.ayCounter.count({ where: { academicYearId: ay.id } })).toBeGreaterThan(0);

    // they verify, sign in, and are asked to set the year up
    expectStatus(await c.post('/auth/verify-email', { token: tokenFromMail('first@test.ph') }), 200);
    expectStatus(await c.post('/auth/login', { email: 'first@test.ph', password: PASSWORD }), 200);
    const me = expectStatus(await c.get('/auth/me'), 200).body;
    expect(me.academicYears).toEqual([expect.objectContaining({ id: ay.id, needsSetup: true, membership: expect.objectContaining({ role: 'adviser' }) })]);

    // the second person waits for that adviser
    const second = expectStatus(await (await Client.create()).post('/auth/signup', signupBody('second@test.ph')), 201).body;
    expect(second).toMatchObject({ role: null, status: 'pending' });
    expect(await prisma.academicYear.count()).toBe(1);
  });

  it('rejects duplicate emails, weak passwords and missing consent', async () => {
    const c = await Client.create();
    expectStatus(await c.post('/auth/signup', signupBody('dup@test.ph')), 201);
    expect((await c.post('/auth/signup', signupBody('DUP@test.ph'))).body.error.code).toBe('EMAIL_TAKEN');
    expect((await c.post('/auth/signup', { ...signupBody('weak@test.ph'), password: 'short' })).body.error.code).toBe('WEAK_PASSWORD');
    expect((await c.post('/auth/signup', { ...signupBody('noconsent@test.ph'), consent: false })).status).toBe(400);
  });

  it('blocks login until the email is verified', async () => {
    const c = await Client.create();
    expectStatus(await c.post('/auth/signup', signupBody('verify@test.ph')), 201);

    const blocked = await c.post('/auth/login', { email: 'verify@test.ph', password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    expectStatus(await c.post('/auth/verify-email', { token: tokenFromMail('verify@test.ph') }), 200);
    const ok = expectStatus(await c.post('/auth/login', { email: 'verify@test.ph', password: PASSWORD }), 200);
    expect(ok.body.user.email).toBe('verify@test.ph');

    // a verification link works only once
    const reused = await c.post('/auth/verify-email', { token: tokenFromMail('verify@test.ph') });
    expect(reused.body.error.code).toBe('INVALID_TOKEN');
  });

  it('notifies the adviser in-app and by email when someone is pending', async () => {
    await registerAndLogin('adviser@test.ph');
    const c = await Client.create();
    expectStatus(await c.post('/auth/signup', signupBody('pending@test.ph', 'Jhon', 'Gadiana')), 201);

    const adviser = await prisma.user.findUniqueOrThrow({ where: { email: 'adviser@test.ph' } });
    const notes = await prisma.notification.findMany({ where: { userId: adviser.id, type: 'membership.pending' } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toContain('Jhon Gadiana');
    expect(sentMail.some((m) => m.to === 'adviser@test.ph' && m.subject.includes('Jhon Gadiana'))).toBe(true);
  });

  it('lets the adviser approve a pending account with a position', async () => {
    const adviser = await registerAndLogin('adviser@test.ph');
    const staff = await registerAndLogin('staff@test.ph');

    // pending users are logged in but have no access to the AY
    expect((await staff.get('/designations')).body.error.code).toBe('NO_AY_ACCESS');
    expect((await staff.get('/members')).status).toBe(403);

    const pending = expectStatus(await adviser.get('/members?status=pending'), 200).body.items;
    expect(pending).toHaveLength(1);

    const approved = expectStatus(await adviser.post(`/members/${pending[0].id}/approve`, { designationId: collectorId }), 200);
    expect(approved.body).toMatchObject({ status: 'active', role: 'member', position: 'Collector' });

    const me = expectStatus(await staff.get('/auth/me'), 200).body;
    const access = me.academicYears.find((a: { id: string }) => a.id === ayId).membership;
    expect(access.permissions).toEqual(['collect', 'view_funds']);

    // staff can't manage accounts, even once approved
    expect((await staff.get('/members')).status).toBe(403);

    // the decision snapshot keeps the adviser's name
    const row = await prisma.userAyRole.findUniqueOrThrow({ where: { id: pending[0].id } });
    expect(row.decidedByName).toBe('Test User');
  });

  it('rejects with an optional comment and records it', async () => {
    const adviser = await registerAndLogin('adviser@test.ph');
    const c = await Client.create();
    expectStatus(await c.post('/auth/signup', signupBody('nope@test.ph')), 201);
    const [pending] = (await adviser.get('/members?status=pending')).body.items;

    const res = expectStatus(await adviser.post(`/members/${pending.id}/reject`, { comment: 'Not an officer this year' }), 200);
    expect(res.body).toMatchObject({ status: 'rejected', decisionNote: 'Not an officer this year' });
  });

  it('never deactivates or removes your own account, and only removes never-approved accounts', async () => {
    const adviser = await registerAndLogin('adviser@test.ph');
    const staff = await registerAndLogin('staff@test.ph');
    const members = (await adviser.get('/members')).body.items as { id: string; isSelf: boolean; status: string }[];
    const self = members.find((m) => m.isSelf)!;
    const other = members.find((m) => !m.isSelf)!;

    expect((await adviser.post(`/members/${self.id}/deactivate`)).body.error.code).toBe('SELF_ACTION');
    expect((await adviser.delete(`/members/${self.id}`)).body.error.code).toBe('SELF_ACTION');

    expectStatus(await adviser.post(`/members/${other.id}/approve`, { designationId: collectorId }), 200);
    expect((await adviser.delete(`/members/${other.id}`)).body.error.code).toBe('HAS_HISTORY');
    expectStatus(await adviser.post(`/members/${other.id}/deactivate`, { reason: 'Term ended' }), 200);
    expect((await staff.get('/designations')).body.error.code).toBe('NO_AY_ACCESS');

    const c = await Client.create();
    expectStatus(await c.post('/auth/signup', signupBody('remove@test.ph')), 201);
    const pending = (await adviser.get('/members?status=pending')).body.items[0];
    expectStatus(await adviser.delete(`/members/${pending.id}`), 204);
    expect(await prisma.user.findUnique({ where: { email: 'remove@test.ph' } })).toBeNull();
  });
});

describe('sessions and security', () => {
  it('rejects state-changing requests without the CSRF token', async () => {
    const c = await Client.create();
    const res = await c.agent.post('/api/auth/signup').send(signupBody('csrf@test.ph'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF');
  });

  it('locks the account after 5 wrong passwords', async () => {
    const c = await registerAndLogin('lock@test.ph');
    for (let i = 0; i < 5; i++) {
      expect((await c.post('/auth/login', { email: 'lock@test.ph', password: 'Wrong-password1' })).status).toBe(401);
    }
    const locked = await c.post('/auth/login', { email: 'lock@test.ph', password: PASSWORD });
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('logs out and revokes the session', async () => {
    const c = await registerAndLogin('out@test.ph');
    expectStatus(await c.get('/auth/me'), 200);
    expectStatus(await c.post('/auth/logout'), 200);
    expect((await c.get('/auth/me')).status).toBe(401);
  });

  it('resets the password and signs out every session', async () => {
    const c = await registerAndLogin('reset@test.ph');
    const anon = await Client.create();
    expectStatus(await anon.post('/auth/forgot-password', { email: 'reset@test.ph' }), 200);
    const newPassword = 'An0ther-Strong-Pass';
    expectStatus(await anon.post('/auth/reset-password', { token: tokenFromMail('reset@test.ph'), password: newPassword }), 200);

    expect((await c.get('/auth/me')).body.error.code).toBe('SESSION_ENDED');
    expect((await anon.post('/auth/login', { email: 'reset@test.ph', password: PASSWORD })).status).toBe(401);
    expectStatus(await anon.post('/auth/login', { email: 'reset@test.ph', password: newPassword }), 200);
  });

  it('does not reveal whether an email exists on forgot-password', async () => {
    const anon = await Client.create();
    const res = expectStatus(await anon.post('/auth/forgot-password', { email: 'nobody@test.ph' }), 200);
    expect(res.body).toEqual({ ok: true });
    expect(sentMail).toHaveLength(0);
  });

  it('does not store one-time links in the email outbox', async () => {
    const c = await Client.create();
    expectStatus(await c.post('/auth/signup', signupBody('outbox@test.ph')), 201);
    const row = await prisma.emailOutbox.findFirstOrThrow({ where: { toEmail: 'outbox@test.ph' } });
    expect(row.textBody).not.toContain('token=');
    expect(row.status).toBe('sent');
  });
});
