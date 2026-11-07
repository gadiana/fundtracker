import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AcademicYear } from '@prisma/client';
import { NOTIFICATION_EVENTS, renderEvent, unknownPlaceholders } from '@sft/shared';
import { prisma } from '../src/db';
import { MAX_ATTEMPTS, mailTestControls, retryDueEmails, sentMail } from '../src/lib/mailer';
import { createProgram } from './fixtures';
import { Client, createAy, expectStatus, registerAndLogin, resetDb, signupBody, tokenFromMail } from './helpers';

let ay: AcademicYear;
let adviser: Client;
let collectorDesignationId: string;

beforeEach(async () => {
  await resetDb();
  const created = await createAy(2026);
  ay = created.ay;
  collectorDesignationId = created.designations.collector.id;
  adviser = await registerAndLogin('adviser@test.ph', undefined, ['Maria', 'Santos']);
  sentMail.length = 0;
});

/** Someone signs up and verifies: the adviser gets the "waiting for approval" event. */
async function newSignup(email = 'ana@test.ph') {
  const c = await Client.create();
  expectStatus(await c.post('/auth/signup', signupBody(email, 'Ana', 'Cruz')), 201);
  expectStatus(await c.post('/auth/verify-email', { token: tokenFromMail(email) }), 200);
  return c;
}

const toAdviser = () => sentMail.filter((m) => m.to === 'adviser@test.ph');
const adviserNotices = () => prisma.notification.findMany({ where: { type: 'membership.pending' } });

const event = async (key: string) =>
  expectStatus(await adviser.get('/settings/notifications'), 200).body.events.find((e: { key: string }) => e.key === key);

describe('templates', () => {
  it('fills placeholders and leaves out paragraphs whose details are empty', () => {
    const t = { subject: '{{requestNo}} was rejected', notice: 'By {{approverName}}. {{comment}}', body: 'Hi {{recipientName}},\n\nComment: {{comment}}\n\nBye', button: 'Open' };
    expect(renderEvent(t, { requestNo: 'FR-0001', approverName: 'Maria', recipientName: 'Paolo', comment: '' })).toEqual({
      subject: 'FR-0001 was rejected',
      notice: 'By Maria.',
      paragraphs: ['Hi Paolo,', 'Bye'],
      button: 'Open',
    });
    // a greeting without a name is left out too
    expect(renderEvent(t, { requestNo: 'FR-0001', comment: 'Use Books' }).paragraphs).toEqual(['Comment: Use Books', 'Bye']);
  });

  it('knows which placeholders each event offers', () => {
    for (const e of NOTIFICATION_EVENTS) expect(unknownPlaceholders(e.key, e.template)).toEqual([]);
    expect(unknownPlaceholders('membership.pending', { subject: '{{requestNo}}', notice: '', body: '{{applicantName}}', button: '' })).toEqual(['requestNo']);
  });
});

describe('which events notify', () => {
  it('sends in-app and email by default, and each can be turned off', async () => {
    await newSignup('one@test.ph');
    expect(toAdviser()).toHaveLength(1);
    expect(await adviserNotices()).toHaveLength(1);

    const off = { inApp: true, email: false, template: null };
    expectStatus(await adviser.put('/settings/notifications/membership.pending', off), 200);
    sentMail.length = 0;
    await newSignup('two@test.ph');
    expect(toAdviser()).toHaveLength(0);
    expect(await adviserNotices()).toHaveLength(2);

    expectStatus(await adviser.put('/settings/notifications/membership.pending', { inApp: false, email: false, template: null }), 200);
    await newSignup('three@test.ph');
    expect(await adviserNotices()).toHaveLength(2);
    expect(await event('membership.pending')).toMatchObject({ inApp: false, email: false });
  });

  it('never turns off verification and password-reset emails', async () => {
    const res = expectStatus(await adviser.put('/settings/notifications/auth.verify_email', { inApp: true, email: false, template: null }), 200).body;
    expect(res).toMatchObject({ inApp: false, email: true, locked: true });
    await newSignup('four@test.ph'); // would throw if no verification email came
  });

  it('is adviser-only, and every change is audited', async () => {
    const ana = await newSignup();
    const pending = (await adviser.get('/members?status=pending')).body.items[0];
    expectStatus(await adviser.post(`/members/${pending.id}/approve`, { designationId: collectorDesignationId }), 200);
    expectStatus(await ana.post('/auth/login', { email: 'ana@test.ph', password: 'Sup3rSecretPass' }), 200);
    expect((await ana.get('/settings/notifications')).status).toBe(403);
    expect((await ana.put('/settings/notifications/membership.pending', { inApp: false, email: false, template: null })).status).toBe(403);

    expectStatus(await adviser.put('/settings/notifications/membership.pending', { inApp: true, email: false, template: null }), 200);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'settings_change' }, orderBy: { id: 'desc' } });
    expect(audit.afterData).toMatchObject({ 'notification:membership.pending': { email: false, inApp: true } });
    expect(audit.beforeData).toMatchObject({ 'notification:membership.pending': { email: true } });
  });
});

describe('editable wording', () => {
  const custom = {
    subject: 'Bagong account: {{applicantName}}',
    notice: 'Galing kay {{applicantEmail}}',
    body: 'Magandang araw {{recipientName}}!\n\n{{applicantName}} wants to join {{orgName}}.',
    button: 'Tingnan',
  };

  it('uses the AY’s wording for the email and the in-app notice', async () => {
    expectStatus(await adviser.put('/settings/notifications/membership.pending', { inApp: true, email: true, template: custom }), 200);
    await newSignup();
    const mail = toAdviser()[0]!;
    expect(mail.subject).toBe('Bagong account: Ana Cruz');
    expect(mail.text).toContain('Magandang araw Maria Santos!');
    expect(mail.text).toContain('Ana Cruz wants to join Sample Student Organization.');
    expect(mail.html).toContain('>Tingnan</a>');
    const [notice] = await adviserNotices();
    expect(notice).toMatchObject({ title: 'Bagong account: Ana Cruz', body: 'Galing kay ana@test.ph' });
    expect(await event('membership.pending')).toMatchObject({ customized: true, template: custom });
  });

  it('escapes what people type, refuses unknown placeholders, and resets to the default', async () => {
    const res = await adviser.put('/settings/notifications/membership.pending', { inApp: true, email: true, template: { ...custom, body: 'Hi {{studentNumber}}' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_PLACEHOLDER');

    // a name with HTML in it can't inject markup into the email
    const c = await Client.create();
    expectStatus(await c.post('/auth/signup', signupBody('x@test.ph', '<b>Bold</b>', 'Name')), 201);
    expectStatus(await c.post('/auth/verify-email', { token: tokenFromMail('x@test.ph') }), 200);
    expect(toAdviser()[0]!.html).not.toContain('<b>Bold</b>');
    expect(toAdviser()[0]!.html).toContain('&lt;b&gt;Bold&lt;/b&gt;');

    expectStatus(await adviser.put('/settings/notifications/membership.pending', { inApp: true, email: true, template: custom }), 200);
    expectStatus(await adviser.put('/settings/notifications/membership.pending', { inApp: true, email: true, template: null }), 200);
    const s = await prisma.aySetting.findUniqueOrThrow({ where: { academicYearId: ay.id } });
    expect(s.emailTemplates).toEqual({});
    expect(await event('membership.pending')).toMatchObject({ customized: false });
  });

  it('sends from the AY’s sender name and address, with its reply-to', async () => {
    expectStatus(await adviser.patch('/settings', { emailSenderName: 'Org Treasury', emailSenderAddress: 'treasury@sample-org.ph', emailReplyTo: 'adviser@sample-org.ph' }), 200);
    await newSignup();
    expect(toAdviser()[0]).toMatchObject({ from: '"Org Treasury" <treasury@sample-org.ph>', replyTo: 'adviser@sample-org.ph' });
  });
});

describe('delivery and the outbox', () => {
  it('retries a failed email later and records every attempt', async () => {
    Object.assign(mailTestControls, { failNext: 1, failTo: 'adviser@test.ph' });
    await newSignup();
    const row = await prisma.emailOutbox.findFirstOrThrow({ where: { templateKey: 'membership.pending' } });
    expect(row).toMatchObject({ status: 'queued', attempts: 1, retryable: true });
    expect(row.lastError).toContain('Simulated');
    expect(row.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 50_000);

    expect(await retryDueEmails()).toEqual({ tried: 0, sent: 0 }); // not due yet
    expect(await retryDueEmails(new Date(Date.now() + 2 * 60_000))).toEqual({ tried: 1, sent: 1 });
    expect(await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'sent', attempts: 2, lastError: null });
    expect(toAdviser()).toHaveLength(1);
  });

  it('gives up after the last attempt', async () => {
    Object.assign(mailTestControls, { failNext: MAX_ATTEMPTS, failTo: 'adviser@test.ph' });
    await newSignup();
    const later = new Date(Date.now() + 24 * 3_600_000);
    for (let i = 1; i < MAX_ATTEMPTS; i++) await retryDueEmails(later);
    expect(await prisma.emailOutbox.findFirstOrThrow({ where: { templateKey: 'membership.pending' } })).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
  });

  it('never stores or re-sends one-time links', async () => {
    mailTestControls.failNext = 1;
    const c = await Client.create();
    expectStatus(await c.post('/auth/signup', signupBody('ben@test.ph')), 201);
    const row = await prisma.emailOutbox.findFirstOrThrow({ where: { templateKey: 'auth.verify_email', toEmail: 'ben@test.ph' } });
    expect(row).toMatchObject({ status: 'failed', retryable: false });
    expect(row.htmlBody).not.toContain('token=');
    const res = await adviser.post(`/settings/email/outbox/${row.id}/retry`);
    expect(res.body.error.code).toBe('NOT_RETRYABLE');
  });

  it('lists the AY’s emails for the adviser, who can retry a failed one', async () => {
    Object.assign(mailTestControls, { failNext: 1, failTo: 'adviser@test.ph' });
    await newSignup();
    const list = expectStatus(await adviser.get('/settings/email/outbox'), 200).body;
    const failed = list.items.find((i: { eventKey: string }) => i.eventKey === 'membership.pending');
    expect(failed).toMatchObject({ status: 'queued', eventLabel: 'New account waiting for approval', to: 'adviser@test.ph' });
    expect(list.items[0]).not.toHaveProperty('text');
    expect(list.counts.queued).toBe(1);

    const retried = expectStatus(await adviser.post(`/settings/email/outbox/${failed.id}/retry`), 200).body;
    expect(retried).toMatchObject({ ok: true, email: { status: 'sent' } });
    expect(expectStatus(await adviser.get(`/settings/email/outbox/${failed.id}`), 200).body.text).toContain('Ana Cruz');
    expect((await adviser.post(`/settings/email/outbox/${failed.id}/retry`)).body.error.code).toBe('NOT_FAILED');
  });

  it('sends a test email to the adviser', async () => {
    const res = expectStatus(await adviser.post('/settings/email/test'), 200).body;
    expect(res).toMatchObject({ ok: true, to: 'adviser@test.ph' });
    expect(toAdviser()[0]!.subject).toBe('Test email from Sample Student Organization');
    mailTestControls.failNext = 1;
    expect(expectStatus(await adviser.post('/settings/email/test', { to: 'other@test.ph' }), 200).body).toMatchObject({ ok: false, error: expect.stringContaining('Simulated') });
  });
});

describe('receipts by email', () => {
  async function payment() {
    const program = await createProgram(ay.id, 'BSIT');
    expectStatus(await adviser.post('/funds', { name: 'Student Fee', amountPerStudent: 50_000, isMandatory: true, isConfidential: false, yearLevels: [1], allPrograms: true }), 201);
    const s = expectStatus(await adviser.post('/students', { studentNumber: '1001', firstName: 'Juan', lastName: 'Dela Cruz', programId: program.id, yearLevel: 1, email: 'juan@student.ph' }), 201).body;
    return expectStatus(await adviser.post('/payments', { idempotencyKey: randomUUID(), studentId: s.id, amount: 20_000 }), 201).body;
  }

  it('emails the receipt after each payment only when the AY turns that on', async () => {
    const first = await payment();
    expect(first.emailedTo).toBeNull();
    expect(sentMail.filter((m) => m.to === 'juan@student.ph')).toHaveLength(0);
    // staff can still send it on request
    expectStatus(await adviser.post(`/payments/${first.receipt.id}/email`, {}), 200);
    expect(sentMail.filter((m) => m.to === 'juan@student.ph')).toHaveLength(1);

    expectStatus(await adviser.put('/settings/notifications/payment.receipt', { inApp: false, email: true, template: null }), 200);
    const student = await prisma.student.findFirstOrThrow();
    const second = expectStatus(await adviser.post('/payments', { idempotencyKey: randomUUID(), studentId: student.id, amount: 10_000 }), 201).body;
    expect(second.emailedTo).toBe('juan@student.ph');
    const mail = sentMail.filter((m) => m.to === 'juan@student.ph').at(-1)!;
    expect(mail.subject).toBe(`Receipt ${second.receipt.transactionNo} – Sample Student Organization`);
    expect(mail.text).toContain('Thank you for your payment of ₱100.00');
    expect(mail.attachments?.[0]?.cid).toBe('status-qr');
  });
});

describe('the notification center', () => {
  it('pages through notices sent at the same moment without skipping any, and filters unread', async () => {
    const me = await prisma.user.findUniqueOrThrow({ where: { email: 'adviser@test.ph' } });
    const at = new Date();
    await prisma.notification.createMany({
      data: Array.from({ length: 35 }, (_, i) => ({ userId: me.id, academicYearId: ay.id, type: 'test', title: `Notice ${i}`, createdAt: at })),
    });
    const first = expectStatus(await adviser.get('/notifications?limit=30'), 200).body;
    expect(first.items).toHaveLength(30);
    const second = expectStatus(await adviser.get(`/notifications?limit=30&before=${encodeURIComponent(first.nextCursor)}`), 200).body;
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const ids = new Set([...first.items, ...second.items].map((n: { id: string }) => n.id));
    expect(ids.size).toBe(35);

    const one = first.items[0].id;
    expectStatus(await adviser.post(`/notifications/${one}/read`), 200);
    expect(expectStatus(await adviser.get('/notifications?filter=unread&limit=100'), 200).body.items).toHaveLength(34);
    expectStatus(await adviser.post(`/notifications/${one}/unread`), 200);
    expect(expectStatus(await adviser.get('/notifications/unread-count'), 200).body.count).toBe(35);
  });
});
