import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { Client, createAy, expectStatus, registerAndLogin, resetDb } from './helpers';

/**
 * A sweep over EVERY route in the code (found by reading the route files, so a new route is
 * covered automatically): without a session nothing but the public pages answers, and a
 * member whose position has no permissions is refused everything that needs one.
 */

const SRC = join(__dirname, '..', 'src');

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? filesIn(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Router variable → URL prefix, from app.ts and the routers mounted inside other routers. */
function mounts() {
  const prefix = new Map<string, string>();
  for (const m of readFileSync(join(SRC, 'app.ts'), 'utf8').matchAll(/app\.use\('(\/api[^']*)', (\w+Router)\)/g)) prefix.set(m[2]!, m[1]!);
  for (const file of filesIn(join(SRC, 'modules'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(/(\w+Router)\.use\((\w+Router)\)/g)) {
      if (prefix.has(m[1]!)) prefix.set(m[2]!, prefix.get(m[1]!)!);
    }
  }
  return prefix;
}

function allRoutes() {
  const prefix = mounts();
  const routes: { method: string; path: string }[] = [];
  for (const file of filesIn(join(SRC, 'modules'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(\w+Router)\.(get|post|put|patch|delete)\(\s*['`]([^'`]+)['`]/g)) {
      const base = prefix.get(m[1]!);
      if (!base) throw new Error(`${m[1]} in ${file} is not mounted`);
      // routes registered in a loop: `/:id/${path}` for archive and unarchive
      const paths = m[3]!.includes('${path}') ? ['archive', 'unarchive'].map((p) => m[3]!.replace('${path}', p)) : [m[3]!];
      for (const p of paths) routes.push({ method: m[2]!, path: `${base}${p === '/' ? '' : p}` });
    }
  }
  return routes;
}

/** Answer without a session on purpose: sign-in steps, the QR status page, self-enrollment, logos. */
const PUBLIC = [
  'post /api/auth/login',
  'post /api/auth/login/2fa',
  'post /api/auth/signup',
  'post /api/auth/verify-email',
  'post /api/auth/resend-verification',
  'post /api/auth/forgot-password',
  'post /api/auth/reset-password',
  'post /api/auth/refresh',
  'post /api/auth/logout',
  'get /api/public/info',
  'get /api/public/ays/:ayId/logo',
  'get /api/public/verify/:token',
  'get /api/public/enroll/:token',
  'post /api/public/enroll/:token',
];

const ZERO = '00000000-0000-4000-8000-000000000000';
const fill = (path: string, ayId = ZERO) =>
  path
    // academic-year routes look the year up first, so they get a real one
    .replace(/^\/api\/ays\/:id/, `/api/ays/${ayId}`)
    .replace(':kind', 'collections')
    .replace(':key', 'membership.pending')
    .replace(/:\w+/g, ZERO);

const call = (c: Client, method: string, path: string) => {
  const p = path.replace(/^\/api/, '');
  if (method === 'get') return c.get(p);
  if (method === 'post') return c.post(p, {});
  if (method === 'put') return c.put(p, {});
  if (method === 'patch') return c.patch(p, {});
  return c.delete(p);
};

beforeEach(async () => {
  await resetDb();
});

describe('every route', () => {
  it('finds the routes it checks', () => {
    const routes = allRoutes();
    expect(routes.length).toBeGreaterThan(100);
    for (const p of PUBLIC) expect(routes.map((r) => `${r.method} ${r.path}`)).toContain(p);
  });

  it('refuses everything but the public pages without a session', async () => {
    await createAy(2026);
    const anonymous = await Client.create();
    const answered: string[] = [];
    for (const r of allRoutes()) {
      if (PUBLIC.includes(`${r.method} ${r.path}`)) continue;
      const res = await call(anonymous, r.method, fill(r.path));
      if (res.status !== 401) answered.push(`${r.method.toUpperCase()} ${r.path} → ${res.status}`);
    }
    expect(answered).toEqual([]);
  });

  it('refuses state changes without the CSRF token, even when signed in', async () => {
    const { ay } = await createAy(2026);
    const adviser = await registerAndLogin('adviser@test.ph', ay.id);
    const res = await adviser.agent.post('/api/funds').set('X-AY-Id', ay.id).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF');
  });
});

describe('a member whose position has no permissions', () => {
  /** Areas only the adviser or a permitted position may use (paths as in the code). */
  const NEEDS_PERMISSION = [
    /^\/api\/settings/,
    /^\/api\/audit/,
    /^\/api\/members/,
    /^\/api\/approvers/,
    /^\/api\/students/,
    /^\/api\/payments/,
    /^\/api\/enrollment-links/,
    /^\/api\/uploads/,
    /^\/api\/history\/collections/,
    // (who may run the setup wizard is covered by the Copy Wizard tests)
    /^\/api\/ays\/:id\/(close|reopen|make-current)$/,
    /^\/api\/(programs|sections|designations)(\/|$)/,
    /^\/api\/funds\/(reorder|:id\/(adjustments|deactivate|reactivate))$/,
  ];

  it('is refused every route that needs a permission', async () => {
    const { ay } = await createAy(2026);
    const adviser = await registerAndLogin('adviser@test.ph', ay.id, ['Maria', 'Santos']);
    const plain = await prisma.designation.create({ data: { academicYearId: ay.id, name: 'Member', sortOrder: 9 } });
    const member = await registerAndLogin('member@test.ph', ay.id, ['Ana', 'Cruz']);
    const pending = (await adviser.get('/members?status=pending')).body.items[0];
    expectStatus(await adviser.post(`/members/${pending.id}/approve`, { designationId: plain.id }), 200);

    const allowed: string[] = [];
    for (const r of allRoutes()) {
      if (!NEEDS_PERMISSION.some((re) => re.test(r.path))) continue;
      // reading the structure lists is fine for every member
      if (r.method === 'get' && /^\/api\/(programs|sections|designations)$/.test(r.path)) continue;
      const res = await call(member, r.method, fill(r.path, ay.id));
      if (res.status !== 403) allowed.push(`${r.method.toUpperCase()} ${r.path} → ${res.status}`);
    }
    expect(allowed).toEqual([]);
  });
});
