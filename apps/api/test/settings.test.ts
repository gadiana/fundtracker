import { rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BRANDING } from '../src/branding';
import { prisma } from '../src/db';
import { applyBranding } from '../src/lib/branding';
import { createProgram, createStudent } from './fixtures';
import { Client, createAy, expectStatus, pngBuffer, registerAndLogin, resetDb, signupBody, type Client as ClientType } from './helpers';

let ayId: string;
let collectorId: string;
let adviser: ClientType;

beforeEach(async () => {
  await resetDb();
  const { ay, designations } = await createAy();
  ayId = ay.id;
  collectorId = designations.collector.id;
  adviser = await registerAndLogin('adviser@test.ph');
});

async function approvedStaff(email: string, designationId = collectorId) {
  const staff = await registerAndLogin(email);
  const pending = (await adviser.get('/members?status=pending')).body.items.find((m: { user: { email: string } }) => m.user.email === email);
  expectStatus(await adviser.post(`/members/${pending.id}/approve`, { designationId }), 200);
  return { staff, userId: pending.user.id as string };
}

describe('settings', () => {
  it('are adviser-only', async () => {
    const { staff } = await approvedStaff('staff@test.ph');
    expectStatus(await adviser.get('/settings'), 200);
    expect((await staff.get('/settings')).status).toBe(403);
    expect((await staff.patch('/settings', { orgName: 'Hacked' })).status).toBe(403);
  });

  it('saves changes and audits only the fields that changed', async () => {
    const res = expectStatus(await adviser.patch('/settings', { orgName: 'Sample Student Organization', receiptFooterText: 'Thank you!', allocationMode: 'staff_chooses' }), 200);
    expect(res.body).toMatchObject({ receiptFooterText: 'Thank you!', allocationMode: 'staff_chooses' });

    const log = await prisma.auditLog.findMany({ where: { action: 'settings_change' } });
    expect(log).toHaveLength(1);
    // orgName was already "Sample Student Organization", so it isn't part of the change
    expect(log[0]!.afterData).toEqual({ receiptFooterText: 'Thank you!', allocationMode: 'staff_chooses' });
    expect(log[0]!.beforeData).toEqual({ receiptFooterText: '', allocationMode: 'hybrid' });

    // saving the same values again records nothing
    expectStatus(await adviser.patch('/settings', { receiptFooterText: 'Thank you!' }), 200);
    expect(await prisma.auditLog.count({ where: { action: 'settings_change' } })).toBe(1);
  });

  it('leave the organization’s name and logos to the code', async () => {
    expect((await adviser.patch('/settings', { schoolAbbr: 'SSU' })).body.error.code).toBe('SET_IN_CODE');
    expect((await adviser.patch('/settings', { orgName: 'Another Name' })).body.error.code).toBe('SET_IN_CODE');
    // sending the current value along with other changes is fine
    expectStatus(await adviser.patch('/settings', { orgName: 'Sample Student Organization', receiptFooterText: 'Thanks' }), 200);
  });

  it('validates values and rejects unknown fields', async () => {
    expect((await adviser.patch('/settings', { orgName: '' })).status).toBe(400);
    expect((await adviser.patch('/settings', { timezone: 'Mars/Olympus' })).status).toBe(400);
    expect((await adviser.patch('/settings', { sessionTimeoutMinutes: 2 })).status).toBe(400);
    expect((await adviser.patch('/settings', { uploadAllowedMime: [] })).status).toBe(400);
    // overpayment is not a setting at all
    expect((await adviser.patch('/settings', { allowOverpayment: true })).status).toBe(400);
  });

  it('starts a new privacy-notice version when the text changes', async () => {
    const res = expectStatus(await adviser.patch('/settings', { privacyConsentText: 'A brand new privacy notice for this year.' }), 200);
    expect(res.body.privacyConsentVersion).toBe('2');
  });

  it('applies new password rules to signups right away', async () => {
    expectStatus(await adviser.patch('/settings', { passwordMinLength: 16 }), 200);
    const c = await Client.create();
    const res = await c.post('/auth/signup', signupBody('short@test.ph')); // 15-character password
    expect(res.body.error.code).toBe('WEAK_PASSWORD');
  });

  it('stores the public QR page extras on top of name and status', async () => {
    const res = expectStatus(await adviser.patch('/settings', { publicFields: ['courseYearSection'] }), 200);
    expect(res.body.publicFields).toEqual(['courseYearSection']);
    const row = await prisma.aySetting.findUniqueOrThrow({ where: { academicYearId: ayId } });
    expect(row.publicFields).toEqual(['name', 'status', 'courseYearSection']);
  });

  it('cannot remove year levels that students are in', async () => {
    const program = await createProgram(ayId, 'BSIT');
    await createStudent(ayId, { number: '1001', first: 'Ana', last: 'Cruz', programId: program.id, yearLevel: 4 });
    const res = await adviser.patch('/settings', { yearLevelCount: 3 });
    expect(res.body.error.code).toBe('YEAR_LEVEL_IN_USE');
    expectStatus(await adviser.patch('/settings', { yearLevelCount: 5 }), 200);
  });

  it('are read-only in a closed academic year', async () => {
    await prisma.academicYear.update({ where: { id: ayId }, data: { status: 'closed' } });
    expect((await adviser.patch('/settings', { orgAbbr: 'VP' })).body.error.code).toBe('AY_CLOSED');
    expectStatus(await adviser.get('/settings'), 200);
  });
});

describe('branding set in the code', () => {
  const dir = resolve(process.cwd(), 'branding');
  const saved = { ...BRANDING };
  afterEach(() => {
    Object.assign(BRANDING, saved);
    rmSync(join(dir, 'test-logo.png'), { force: true });
  });

  it('copies the names and logos from src/branding.ts into every year, storing a logo again only when it changes', async () => {
    const closed = (await createAy(2025, { current: false, closed: true })).ay.id;
    writeFileSync(join(dir, 'test-logo.png'), pngBuffer());
    Object.assign(BRANDING, { orgName: 'Code Org', orgAbbr: 'CO', schoolName: 'Code University', logo: 'test-logo.png', receiptLogo: '' });
    await applyBranding();

    for (const id of [ayId, closed]) {
      const s = await prisma.aySetting.findUniqueOrThrow({ where: { academicYearId: id }, include: { logoFile: true } });
      expect(s).toMatchObject({ orgName: 'Code Org', orgAbbr: 'CO', schoolName: 'Code University', receiptLogoFileId: null, updatedByName: 'System (branding)' });
      expect(s.logoFile).toMatchObject({ mimeType: 'image/png', academicYearId: id });
    }
    const info = (await (await Client.create()).get('/public/info')).body;
    expect(info.org).toMatchObject({ name: 'Code Org', logoUrl: expect.stringContaining('/logo') });

    // the same image is not stored again; a changed one is
    await applyBranding();
    expect(await prisma.storedFile.count()).toBe(2);
    writeFileSync(join(dir, 'test-logo.png'), pngBuffer(4096));
    await applyBranding(ayId);
    expect(await prisma.storedFile.count()).toBe(3);

    // no logo in the code: none in the app
    BRANDING.logo = '';
    await applyBranding();
    expect((await prisma.aySetting.findUniqueOrThrow({ where: { academicYearId: ayId } })).logoFileId).toBeNull();
  });
});

describe('programs, sections and positions', () => {
  it('manages programs: duplicates refused, used programs only deactivated', async () => {
    const created = expectStatus(await adviser.post('/programs', { code: 'bsit', name: 'Information Technology' }), 201).body;
    expect(created.code).toBe('BSIT');
    expect((await adviser.post('/programs', { code: 'BSIT', name: 'Again' })).body.error.code).toBe('DUPLICATE');

    await createStudent(ayId, { number: '2001', first: 'Ben', last: 'Reyes', programId: created.id, yearLevel: 1 });
    expect((await adviser.delete(`/programs/${created.id}`)).body.error.code).toBe('IN_USE');
    expect(expectStatus(await adviser.patch(`/programs/${created.id}`, { isActive: false }), 200).body.isActive).toBe(false);

    const unused = expectStatus(await adviser.post('/programs', { code: 'BSCS', name: 'Computer Science' }), 201).body;
    expectStatus(await adviser.delete(`/programs/${unused.id}`), 204);
  });

  it('manages sections per program and year level', async () => {
    const bsit = expectStatus(await adviser.post('/programs', { code: 'BSIT', name: 'Information Technology' }), 201).body;
    const bscs = expectStatus(await adviser.post('/programs', { code: 'BSCS', name: 'Computer Science' }), 201).body;
    const a = expectStatus(await adviser.post('/sections', { programId: bsit.id, yearLevel: 1, name: 'a' }), 201).body;
    expect(a).toMatchObject({ name: 'A', programId: bsit.id, yearLevel: 1 });
    expect((await adviser.post('/sections', { programId: bsit.id, yearLevel: 1, name: 'A' })).body.error.code).toBe('DUPLICATE');
    // the same name is fine in another year or another program
    expectStatus(await adviser.post('/sections', { programId: bsit.id, yearLevel: 2, name: 'A' }), 201);
    expectStatus(await adviser.post('/sections', { programId: bscs.id, yearLevel: 1, name: 'A' }), 201);
    expect((await adviser.post('/sections', { programId: bsit.id, yearLevel: 9, name: 'B' })).body.error.code).toBe('INVALID_YEAR_LEVEL');

    // a student's section must match their program and year level
    const res = await adviser.post('/students', { studentNumber: '1001', firstName: 'Ana', lastName: 'Cruz', programId: bscs.id, yearLevel: 1, sectionId: a.id });
    expect(res.body.error.code).toBe('INVALID_SECTION');

    // the log reads as a sentence
    const log = (await adviser.get('/audit?entityType=section')).body.items;
    expect(log.map((e: { summary: string }) => e.summary)).toContain('Test User added section A to BSIT 1st year');
    expect(JSON.stringify(log)).not.toContain(bsit.id);

    expectStatus(await adviser.delete(`/sections/${a.id}`), 204);
  });

  it("changes what a position may do, for everyone holding it", async () => {
    const { staff } = await approvedStaff('collector@test.ph');
    const perms = async () =>
      (await staff.get('/auth/me')).body.academicYears.find((a: { id: string }) => a.id === ayId).membership.permissions;
    expect(await perms()).toEqual(['collect', 'view_funds']);

    expectStatus(await adviser.patch(`/designations/${collectorId}`, { isConfidentialExempt: true }), 200);
    expect(await perms()).toEqual(['collect', 'view_confidential', 'view_funds']);
  });

  it('limits how many members may hold a position', async () => {
    const president = await prisma.designation.findFirstOrThrow({ where: { academicYearId: ayId, name: 'President' } });
    await prisma.designation.update({ where: { id: president.id }, data: { maxMembers: 1, seatsLocked: true } });

    // President: one person only, and that can't be changed
    await approvedStaff('first@test.ph', president.id);
    await expect(approvedStaff('second@test.ph', president.id)).rejects.toThrow(/POSITION_FULL/);
    expect((await adviser.patch(`/designations/${president.id}`, { maxMembers: 2 })).body.error.code).toBe('SEATS_FIXED');

    // other positions: the adviser sets the limit
    const secretary = expectStatus(await adviser.post('/designations', { name: 'Secretary', maxMembers: 2 }), 201).body;
    expect(secretary).toMatchObject({ maxMembers: 2, seatsLocked: false });
    const { userId: secretaryOne } = await approvedStaff('sec1@test.ph', secretary.id);
    await approvedStaff('sec2@test.ph', secretary.id);
    await expect(approvedStaff('sec3@test.ph', secretary.id)).rejects.toThrow(/POSITION_FULL/);
    expect((await adviser.patch(`/designations/${secretary.id}`, { maxMembers: 1 })).body.error.code).toBe('LIMIT_BELOW_HOLDERS');
    expectStatus(await adviser.patch(`/designations/${secretary.id}`, { maxMembers: null }), 200);
    expectStatus(await adviser.patch(`/designations/${secretary.id}`, { maxMembers: 3 }), 200);

    // moving someone into a full position is refused too; keeping their own position is fine
    const collectorMember = (await approvedStaff('col@test.ph')).userId;
    await adviser.patch(`/designations/${secretary.id}`, { maxMembers: 3 });
    const members = (await adviser.get('/members?status=active')).body.items as { id: string; user: { id: string } }[];
    const colMembership = members.find((m) => m.user.id === collectorMember)!;
    const secMembership = members.find((m) => m.user.id === secretaryOne)!;
    expect((await adviser.patch(`/members/${colMembership.id}`, { designationId: president.id })).body.error.code).toBe('POSITION_FULL');
    expectStatus(await adviser.patch(`/members/${secMembership.id}`, { designationId: secretary.id }), 200);
  });

  it('decides per position who may see the funds', async () => {
    const { staff } = await approvedStaff('collector@test.ph');
    expectStatus(await staff.get('/funds'), 200);
    expect(expectStatus(await staff.get('/dashboard'), 200).body.fundsHidden).toBe(false);

    expectStatus(await adviser.patch(`/designations/${collectorId}`, { canViewFunds: false }), 200);
    expect((await staff.get('/funds')).status).toBe(403);
    const dash = expectStatus(await staff.get('/dashboard'), 200).body;
    expect(dash).toMatchObject({ fundsHidden: true, funds: [], usageByFund: [], totals: { balance: 0, available: 0 } });
    // the adviser always sees them
    expectStatus(await adviser.get('/funds'), 200);
    expect(expectStatus(await adviser.get('/dashboard'), 200).body.fundsHidden).toBe(false);
  });

  it('protects positions that are in use', async () => {
    await approvedStaff('collector@test.ph');
    expect((await adviser.patch(`/designations/${collectorId}`, { isActive: false })).body.error.code).toBe('IN_USE');
    expect((await adviser.delete(`/designations/${collectorId}`)).body.error.code).toBe('IN_USE');

    const fresh = expectStatus(await adviser.post('/designations', { name: 'Auditor', canFileRequests: false }), 201).body;
    expectStatus(await adviser.delete(`/designations/${fresh.id}`), 204);
  });

  it('keeps one AY’s programs out of another', async () => {
    const other = await createAy(2027, { current: false });
    const theirs = await createProgram(other.ay.id, 'BSIT');
    expect((await adviser.patch(`/programs/${theirs.id}`, { name: 'Hijacked' })).status).toBe(404);
  });
});

describe('approvers', () => {
  it('adds active members only, and can remove them', async () => {
    const { userId } = await approvedStaff('treasurer@test.ph');
    const list = expectStatus(await adviser.get('/approvers'), 200).body;
    expect(list.candidates.map((c: { userId: string }) => c.userId)).toContain(userId);

    expectStatus(await adviser.put(`/approvers/${userId}`, { approvesFundRequests: true, approvesLiquidations: false }), 200);
    const after = expectStatus(await adviser.get('/approvers'), 200).body;
    expect(after.items).toEqual([expect.objectContaining({ userId, approvesFundRequests: true, approvesLiquidations: false })]);

    const outsider = await prisma.user.create({ data: { email: 'out@test.ph', passwordHash: 'x', firstName: 'O', lastName: 'S' } });
    expect((await adviser.put(`/approvers/${outsider.id}`, { approvesFundRequests: true, approvesLiquidations: true })).body.error.code).toBe(
      'NOT_A_MEMBER',
    );
    expect((await adviser.put(`/approvers/${userId}`, { approvesFundRequests: false, approvesLiquidations: false })).status).toBe(400);

    expectStatus(await adviser.delete(`/approvers/${userId}`), 204);
  });
});
