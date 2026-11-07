import request from 'supertest';
import type { Response } from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/db';
import { mailTestControls, sentMail } from '../src/lib/mailer';
import { invalidateSecurityCache } from '../src/lib/settings';

export const app = createApp();
export const PASSWORD = 'Sup3rSecretPass';

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // TRUNCATE does not fire the row-level append-only triggers
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  sentMail.length = 0;
  mailTestControls.failNext = 0;
  mailTestControls.failTo = undefined;
  invalidateSecurityCache();
}

export async function createAy(startYear = 2026, { current = true, closed = false } = {}) {
  const ay = await prisma.academicYear.create({
    data: {
      startYear,
      endYear: startYear + 1,
      label: `${startYear}-${startYear + 1}`,
      isCurrent: current,
      status: closed ? 'closed' : 'open',
    },
  });
  await prisma.aySetting.create({
    data: { academicYearId: ay.id, orgName: 'Sample Student Organization', orgAbbr: 'SSO', privacyConsentText: 'Test consent' },
  });
  const collector = await prisma.designation.create({
    data: { academicYearId: ay.id, name: 'Collector', canCollect: true, sortOrder: 1 },
  });
  const president = await prisma.designation.create({
    data: { academicYearId: ay.id, name: 'President', canFileRequests: true, sortOrder: 0 },
  });
  return { ay, designations: { collector, president } };
}

/** A brand-new AY, as created on the Academic years page: no settings, staff or data yet. */
export async function createEmptyAy(startYear: number) {
  const ay = await prisma.academicYear.create({
    data: { startYear, endYear: startYear + 1, label: `${startYear}-${startYear + 1}` },
  });
  await prisma.ayCounter.createMany({ data: ['receipt', 'fund_request'].map((counterKey) => ({ academicYearId: ay.id, counterKey })) });
  return ay;
}

/** A cookie-keeping client that sends the CSRF header and (optionally) an AY header. */
export class Client {
  private csrf = '';
  readonly agent = request.agent(app);
  ayId?: string;

  static async create(ayId?: string) {
    const c = new Client();
    const res = await c.agent.get('/api/auth/csrf');
    c.csrf = res.body.csrfToken;
    c.ayId = ayId;
    return c;
  }

  private headers(extra?: Record<string, string>) {
    return { 'X-CSRF-Token': this.csrf, ...(this.ayId ? { 'X-AY-Id': this.ayId } : {}), ...extra };
  }

  get(path: string) {
    return this.agent.get(`/api${path}`).set(this.headers());
  }
  post(path: string, body: object = {}) {
    return this.agent.post(`/api${path}`).set(this.headers()).send(body);
  }
  put(path: string, body: object = {}) {
    return this.agent.put(`/api${path}`).set(this.headers()).send(body);
  }
  patch(path: string, body: object = {}) {
    return this.agent.patch(`/api${path}`).set(this.headers()).send(body);
  }
  delete(path: string) {
    return this.agent.delete(`/api${path}`).set(this.headers());
  }
  upload(path: string, data: Buffer, filename: string) {
    return this.agent.post(`/api${path}`).set(this.headers()).attach('file', data, { filename });
  }
}

/** A buffer that starts like a real PNG (the server checks the first bytes). */
export function pngBuffer(size = 2048) {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([header, Buffer.alloc(Math.max(0, size - header.length), 1)]);
}

export function signupBody(email: string, firstName = 'Test', lastName = 'User') {
  return { firstName, lastName, email, password: PASSWORD, consent: true };
}

export function lastMailTo(email: string) {
  const mail = [...sentMail].reverse().find((m) => m.to === email);
  if (!mail) throw new Error(`No email sent to ${email}`);
  return mail;
}

export function tokenFromMail(email: string) {
  const match = lastMailTo(email).text.match(/token=([\w-]+)/);
  if (!match) throw new Error(`No token link in email to ${email}`);
  return match[1]!;
}

export function expectStatus(res: Response, status: number) {
  if (res.status !== status) {
    throw new Error(`Expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res;
}

/** Sign up, verify the email link, and log in. Returns a logged-in client. */
export async function registerAndLogin(email: string, ayId?: string, names: [string, string] = ['Test', 'User']) {
  const c = await Client.create(ayId);
  expectStatus(await c.post('/auth/signup', signupBody(email, ...names)), 201);
  expectStatus(await c.post('/auth/verify-email', { token: tokenFromMail(email) }), 200);
  expectStatus(await c.post('/auth/login', { email, password: PASSWORD }), 200);
  return c;
}
