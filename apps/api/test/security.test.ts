import { beforeEach, describe, expect, it } from 'vitest';
import type { AcademicYear } from '@prisma/client';
import { reportCsv, type ReportDoc } from '@sft/shared';
import { prisma } from '../src/db';
import { REFRESH_GRACE_MS } from '../src/lib/session';
import { base32Encode, currentStep, decryptSecret, encryptSecret, totpCode, verifyTotp } from '../src/lib/totp';
import { app, Client, createAy, expectStatus, PASSWORD, registerAndLogin, resetDb } from './helpers';
import request from 'supertest';

let ay: AcademicYear;
let adviser: Client;

beforeEach(async () => {
  await resetDb();
  ay = (await createAy(2026)).ay;
  adviser = await registerAndLogin('adviser@test.ph', undefined, ['Maria', 'Santos']);
});

/** Turns two-factor on for a signed-in client and returns its secret. */
async function enableTwoFactor(c: Client) {
  const { secret } = expectStatus(await c.post('/me/two-factor/setup', { password: PASSWORD }), 200).body;
  const res = expectStatus(await c.post('/me/two-factor/enable', { code: totpCode(secret, currentStep()) }), 200).body;
  return { secret: secret as string, recoveryCodes: res.recoveryCodes as string[] };
}

async function passwordStep(email: string) {
  const c = await Client.create();
  const res = expectStatus(await c.post('/auth/login', { email, password: PASSWORD }), 200);
  return { c, challenge: res.body.challenge as string, body: res.body };
}

describe('authenticator codes (RFC 6238)', () => {
  it('matches the RFC test values and refuses reused or far-off codes', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(secret, Math.floor(2000000000 / 30))).toBe('279037');

    const now = 1111111109_000;
    const step = Math.floor(1111111109 / 30);
    expect(verifyTotp(secret, '081804', null, now)).toBe(step);
    expect(verifyTotp(secret, '081804', step, now)).toBeNull(); // already used
    expect(verifyTotp(secret, totpCode(secret, step + 1), null, now)).toBe(step + 1); // phone a little ahead
    expect(verifyTotp(secret, totpCode(secret, step + 3), null, now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', null, now)).toBeNull();
  });

  it('stores secrets encrypted, and refuses a tampered copy', () => {
    const stored = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(stored).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(stored)).toBe('JBSWY3DPEHPK3PXP');
    const parts = stored.split('.');
    parts[3] = Buffer.from('tampered!').toString('base64');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });
});

describe('two-factor sign-in', () => {
  it('asks for a code after the password, and never accepts the same code twice', async () => {
    expect((await adviser.post('/me/two-factor/setup', { password: 'wrong' })).body.error.code).toBe('WRONG_PASSWORD');
    const { secret: pending } = expectStatus(await adviser.post('/me/two-factor/setup', { password: PASSWORD }), 200).body;
    expect((await adviser.post('/me/two-factor/enable', { code: '000000' })).body.error.code).toBe('INVALID_CODE');
    const enabled = expectStatus(await adviser.post('/me/two-factor/enable', { code: totpCode(pending, currentStep()) }), 200).body;
    expect(enabled.recoveryCodes).toHaveLength(8);
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'adviser@test.ph' } });
    expect(stored.totpSecretEnc).not.toContain(pending);
    expect(JSON.stringify(stored.totpRecoveryHashes)).not.toContain(enabled.recoveryCodes[0]);

    const first = await passwordStep('adviser@test.ph');
    expect(first.body).toEqual({ twoFactorRequired: true, challenge: expect.any(String) });
    // no session yet
    expect((await first.c.get('/auth/me')).status).toBe(401);
    // the code used to turn it on can't be used again
    expect((await first.c.post('/auth/login/2fa', { challenge: first.challenge, code: totpCode(pending, currentStep()) })).body.error.code).toBe('INVALID_CODE');
    expectStatus(await first.c.post('/auth/login/2fa', { challenge: first.challenge, code: totpCode(pending, currentStep() + 1) }), 200);
    expectStatus(await first.c.get('/auth/me'), 200);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'login' }, orderBy: { id: 'desc' } })).afterData).toEqual({ twoFactor: 'authenticator' });
  });

  it('accepts each recovery code once', async () => {
    const { recoveryCodes } = await enableTwoFactor(adviser);
    const a = await passwordStep('adviser@test.ph');
    expectStatus(await a.c.post('/auth/login/2fa', { challenge: a.challenge, code: recoveryCodes[0]!.toUpperCase() }), 200);
    const b = await passwordStep('adviser@test.ph');
    expect((await b.c.post('/auth/login/2fa', { challenge: b.challenge, code: recoveryCodes[0] })).body.error.code).toBe('INVALID_CODE');
    expect(expectStatus(await adviser.get('/me/two-factor'), 200).body.recoveryCodesLeft).toBe(7);
  });

  it('locks the account after too many wrong codes, and refuses a forged or expired challenge', async () => {
    await enableTwoFactor(adviser);
    const { c, challenge } = await passwordStep('adviser@test.ph');
    for (let i = 0; i < 5; i++) await c.post('/auth/login/2fa', { challenge, code: '000000' });
    expect((await c.post('/auth/login/2fa', { challenge, code: '000000' })).body.error.code).toBe('ACCOUNT_LOCKED');
    expect((await c.post('/auth/login/2fa', { challenge: `${challenge}x`, code: '000000' })).body.error.code).toBe('TWO_FACTOR_EXPIRED');
  });

  it('can be required for an AY, but only by an adviser who has it, and then not turned off', async () => {
    expect((await adviser.patch('/settings', { twofaMode: 'required' })).body.error.code).toBe('TWO_FACTOR_NOT_SET_UP');
    const { secret } = await enableTwoFactor(adviser);
    expectStatus(await adviser.patch('/settings', { twofaMode: 'required' }), 200);

    const member = await registerAndLogin('member@test.ph', undefined, ['Carlo', 'Reyes']);
    const pending = (await adviser.get('/members?status=pending')).body.items[0];
    const collector = await prisma.designation.findFirstOrThrow({ where: { academicYearId: ay.id, name: 'Collector' } });
    expectStatus(await adviser.post(`/members/${pending.id}/approve`, { designationId: collector.id }), 200);
    expect((await member.get('/students')).body.error.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
    const me = expectStatus(await member.get('/auth/me'), 200).body;
    expect(me.academicYears[0]).toMatchObject({ twoFactorMode: 'required' });
    expect(me.user.twoFactorEnabled).toBe(false);
    await enableTwoFactor(member);
    expectStatus(await member.get('/students'), 200);

    const res = await adviser.post('/me/two-factor/disable', { password: PASSWORD, code: totpCode(secret, currentStep() + 1) });
    expect(res.body.error.code).toBe('TWO_FACTOR_REQUIRED');
  });

  it('turns off with the password and a code where it is optional', async () => {
    const { secret } = await enableTwoFactor(adviser);
    expect((await adviser.post('/me/two-factor/disable', { password: PASSWORD, code: '000000' })).body.error.code).toBe('INVALID_CODE');
    expectStatus(await adviser.post('/me/two-factor/disable', { password: PASSWORD, code: totpCode(secret, currentStep() + 1) }), 200);
    const c = await Client.create();
    expect(expectStatus(await c.post('/auth/login', { email: 'adviser@test.ph', password: PASSWORD }), 200).body.user.email).toBe('adviser@test.ph');
  });
});

describe('sign-in tokens', () => {
  const cookieValue = (res: request.Response, name: string) =>
    ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`))?.split(';')[0]?.split('=')[1];

  async function loginRaw() {
    const agent = request(app);
    const csrf = await agent.get('/api/auth/csrf');
    const token = csrf.body.csrfToken as string;
    const cookie = `sft_csrf=${token}`;
    const login = await agent.post('/api/auth/login').set({ 'X-CSRF-Token': token, Cookie: cookie }).send({ email: 'adviser@test.ph', password: PASSWORD });
    return { token, cookie, refresh: cookieValue(login, 'sft_rt')! };
  }
  const refresh = (s: { token: string; cookie: string }, rt: string) =>
    request(app).post('/api/auth/refresh').set({ 'X-CSRF-Token': s.token, Cookie: `${s.cookie}; sft_rt=${rt}` });

  it('replaces the refresh token each time, and ends the session when an old one comes back', async () => {
    const s = await loginRaw();
    const r1 = await refresh(s, s.refresh);
    expect(r1.status).toBe(200);
    const next = cookieValue(r1, 'sft_rt')!;
    expect(next).toBeTruthy();
    expect(next).not.toBe(s.refresh);
    // a second tab refreshing with the old token at the same moment still works
    expect((await refresh(s, s.refresh)).status).toBe(200);

    // later, the old token showing up again means someone copied it
    await prisma.userSession.updateMany({ data: { rotatedAt: new Date(Date.now() - REFRESH_GRACE_MS - 1000) } });
    const stolen = await refresh(s, s.refresh);
    expect(stolen.status).toBe(401);
    expect((await refresh(s, next)).body.error.code).toBe('SESSION_ENDED');
    expect(await prisma.userSession.count({ where: { revokedAt: null } })).toBe(1); // only the adviser's test client session
    expect(await prisma.auditLog.count({ where: { entityType: 'user_session', action: 'logout' } })).toBe(1);
  });
});

describe('headers and exports', () => {
  it('sends security headers on every response', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['permissions-policy']).toContain('camera=(self)');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('keeps spreadsheet formulas out of CSV exports', () => {
    const doc = {
      timezone: 'Asia/Manila',
      tables: [
        {
          title: 'Students',
          primary: true,
          columns: [
            { key: 'name', label: 'Name' },
            { key: 'amount', label: 'Amount', type: 'money' },
          ],
          rows: [
            { name: '=HYPERLINK("http://evil.example","Click")', amount: -12_345 },
            { name: '+63 917 000 0000', amount: 50_000 },
            { name: 'Juan Dela Cruz', amount: 0 },
          ],
        },
      ],
    } as unknown as ReportDoc;
    const lines = reportCsv(doc).replace('﻿', '').trim().split('\r\n');
    expect(lines).toEqual(['Name,Amount (PHP)', `"'=HYPERLINK(""http://evil.example"",""Click"")",-123.45`, "'+63 917 000 0000,500.00", 'Juan Dela Cruz,0.00']);
  });
});
