import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  emailLayout,
  EVENTS_BY_KEY,
  formatPersonName,
  NOTIFICATION_EVENTS,
  notificationEventUpdateSchema,
  renderEvent,
  resolveChannels,
  resolveTemplate,
  testEmailSchema,
  unknownPlaceholders,
  type EventChannels,
  type EventTemplates,
} from '@sft/shared';
import { config } from '../../config';
import { prisma } from '../../db';
import { writeAudit } from '../../lib/audit';
import { badRequest, notFound, uuidParam } from '../../lib/http';
import { resend, sendMail, senderFor } from '../../lib/mailer';
import { requireOpenAy, ctxOf } from '../../middleware/ay';
import { emailLimiter } from '../../middleware/rate-limit';

/**
 * Settings → Email & notifications: which events send an in-app notice or an email, their
 * wording, a test email, and the log of sent emails. Mounted inside the adviser-only settings router.
 */
export const notificationSettingsRouter = Router();

const sameTemplate = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

notificationSettingsRouter.get('/notifications', async (req, res) => {
  const { ay } = ctxOf(req);
  const s = await prisma.aySetting.findUniqueOrThrow({ where: { academicYearId: ay.id } });
  const sender = await senderFor(ay.id);
  res.json({
    smtpConfigured: Boolean(config.SMTP_HOST),
    sender,
    events: NOTIFICATION_EVENTS.map((e) => {
      const template = resolveTemplate(s.emailTemplates, e.key);
      return {
        ...e,
        defaultTemplate: e.template,
        template,
        customized: !sameTemplate(template, e.template),
        ...resolveChannels(s.notificationEvents, e.key),
      };
    }),
  });
});

notificationSettingsRouter.put('/notifications/:key', requireOpenAy, async (req, res) => {
  const key = z.string().parse(req.params.key);
  const event = EVENTS_BY_KEY.get(key);
  if (!event) throw notFound('Unknown notification event.');
  const body = notificationEventUpdateSchema.parse(req.body);
  if (body.template) {
    const unknown = unknownPlaceholders(key, body.template);
    if (unknown.length) {
      throw badRequest('UNKNOWN_PLACEHOLDER', `This message can't use ${unknown.map((n) => `{{${n}}}`).join(', ')}. Use only the placeholders listed.`);
    }
  }
  const { ay, actor } = ctxOf(req);
  const s = await prisma.aySetting.findUniqueOrThrow({ where: { academicYearId: ay.id } });

  const channels = { ...((s.notificationEvents ?? {}) as EventChannels) };
  const templates = { ...((s.emailTemplates ?? {}) as EventTemplates) };
  const before = { ...resolveChannels(channels, key), template: resolveTemplate(templates, key) };
  // locked emails stay on; channels an event doesn't have stay off
  channels[key] = {
    inApp: event.channels.inApp && body.inApp,
    email: event.channels.email && (event.locked ? true : body.email),
  };
  // only differences from the default wording are stored
  if (!body.template || sameTemplate(body.template, event.template)) delete templates[key];
  else templates[key] = body.template;
  const after = { ...resolveChannels(channels, key), template: resolveTemplate(templates, key) };

  if (!sameTemplate(before, after)) {
    await prisma.$transaction(async (tx) => {
      await tx.aySetting.update({
        where: { academicYearId: ay.id },
        data: {
          notificationEvents: channels as Prisma.InputJsonValue,
          emailTemplates: templates as Prisma.InputJsonValue,
          updatedById: actor.id,
          updatedByName: actor.name,
        },
      });
      await writeAudit(tx, {
        ayId: ay.id,
        actor,
        action: 'settings_change',
        entityType: 'settings',
        entityId: ay.id,
        before: { [`notification:${key}`]: before },
        after: { [`notification:${key}`]: after },
        req,
      });
    });
  }
  res.json({ ...event, defaultTemplate: event.template, template: after.template, customized: !sameTemplate(after.template, event.template), inApp: after.inApp, email: after.email });
});

/** Sends a short email with the current sender details, to check the mail server. */
notificationSettingsRouter.post('/email/test', emailLimiter, async (req, res) => {
  const { to } = testEmailSchema.parse(req.body ?? {});
  const { ay, actor } = ctxOf(req);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  const recipient = to ?? me.email;
  const s = await prisma.aySetting.findUnique({ where: { academicYearId: ay.id } });
  const org = s?.orgName || 'Fund Tracker';
  const { html, text } = emailLayout(
    org,
    renderEvent(
      {
        subject: `Test email from ${org}`,
        notice: '',
        body: `Hi ${formatPersonName(me)},\n\nThis is a test email sent from Settings → Email & notifications for AY ${ay.label}. If you can read it, emails are working.`,
        button: '',
      },
      {},
    ),
  );
  const ok = await sendMail({ to: recipient, subject: `Test email from ${org}`, html, text, ayId: ay.id, templateKey: 'system.test', requestedBy: actor });
  const row = await prisma.emailOutbox.findFirst({ where: { academicYearId: ay.id, templateKey: 'system.test' }, orderBy: { createdAt: 'desc' } });
  res.json({ ok, to: recipient, error: ok ? null : row?.lastError ?? 'The email could not be sent.', smtpConfigured: Boolean(config.SMTP_HOST) });
});

const outboxQuery = z.object({
  status: z.enum(['queued', 'sending', 'sent', 'failed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const outboxRow = (r: Prisma.EmailOutboxGetPayload<object>) => ({
  id: r.id,
  to: r.toEmail,
  subject: r.subject,
  eventKey: r.templateKey,
  eventLabel: r.templateKey ? (EVENTS_BY_KEY.get(r.templateKey)?.label ?? (r.templateKey === 'system.test' ? 'Test email' : r.templateKey)) : null,
  status: r.status,
  attempts: r.attempts,
  retryable: r.retryable,
  lastError: r.lastError,
  nextTryAt: r.status === 'queued' ? r.scheduledAt : null,
  createdAt: r.createdAt,
  sentAt: r.sentAt,
  requestedByName: r.requestedByName,
});

/** The AY's sent emails, newest first, without their bodies. */
notificationSettingsRouter.get('/email/outbox', async (req, res) => {
  const q = outboxQuery.parse(req.query);
  const { ay } = ctxOf(req);
  const where: Prisma.EmailOutboxWhereInput = { academicYearId: ay.id, ...(q.status ? { status: q.status } : {}) };
  const [total, rows, byStatus] = await Promise.all([
    prisma.emailOutbox.count({ where }),
    prisma.emailOutbox.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.emailOutbox.groupBy({ by: ['status'], where: { academicYearId: ay.id }, _count: { _all: true } }),
  ]);
  res.json({
    total,
    page: q.page,
    pageSize: q.pageSize,
    counts: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
    items: rows.map(outboxRow),
  });
});

async function loadOutboxRow(ayId: string, id: string) {
  const row = await prisma.emailOutbox.findFirst({ where: { id, academicYearId: ayId } });
  if (!row) throw notFound('Email not found in this academic year.');
  return row;
}

/** One email with its text (one-time links were never stored). */
notificationSettingsRouter.get('/email/outbox/:id', async (req, res) => {
  const row = await loadOutboxRow(ctxOf(req).ay.id, uuidParam(req.params.id));
  res.json({ ...outboxRow(row), text: row.textBody });
});

notificationSettingsRouter.post('/email/outbox/:id/retry', requireOpenAy, async (req, res) => {
  const { ay, actor } = ctxOf(req);
  const row = await loadOutboxRow(ay.id, uuidParam(req.params.id));
  if (!row.retryable) throw badRequest('NOT_RETRYABLE', 'This email can’t be sent again from here: it held a one-time link or an attachment. Send it again from where it started.');
  if (row.status === 'sent' || row.status === 'sending') throw badRequest('NOT_FAILED', 'This email was already sent.');
  const ok = await resend(row.id);
  await writeAudit(prisma, { ayId: ay.id, actor, action: 'create', entityType: 'email_retry', entityId: row.id, after: { to: row.toEmail, subject: row.subject, ok }, req });
  res.json({ ok, email: outboxRow(await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } })) });
});
