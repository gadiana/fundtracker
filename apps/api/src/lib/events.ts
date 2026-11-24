import { emailLayout, renderEvent, resolveChannels, resolveTemplate, type RenderedEvent } from '@sft/shared';
import { config } from '../config';
import { prisma } from '../db';
import type { Actor } from './audit';
import { sendMail, type MailAttachment } from './mailer';
import { notify } from './notify';

export interface Recipient {
  /** in-app notices need an account; email-only recipients (students) have none */
  userId?: string | null;
  email?: string | null;
  name?: string;
}

interface EventOptions {
  ayId: string | null;
  to: Recipient[];
  vars: Record<string, string | null | undefined>;
  /** where the notice and the email's button lead (app path) */
  linkPath?: string;
  /** a full URL for the button instead, e.g. a one-time link */
  linkUrl?: string;
  entityType?: string;
  entityId?: string;
  requestedBy?: Actor;
  sensitive?: boolean;
  attachments?: MailAttachment[];
  /** extra HTML/text under the message (the receipt) */
  extra?: (msg: RenderedEvent) => { html: string; text: string };
  /** send the email even when the event's email switch is off (staff asked for it) */
  forceEmail?: boolean;
}

/**
 * Sends one event to its recipients: an in-app notice and/or an email, as the AY's settings say,
 * worded with the AY's template. Returns how many emails went out.
 */
export async function sendEvent(key: string, o: EventOptions) {
  const settings = o.ayId ? await prisma.aySetting.findUnique({ where: { academicYearId: o.ayId } }) : null;
  const ay = o.ayId ? await prisma.academicYear.findUnique({ where: { id: o.ayId } }) : null;
  const channels = resolveChannels(settings?.notificationEvents, key);
  const template = resolveTemplate(settings?.emailTemplates, key);
  const orgName = settings?.orgName || 'Fund Tracker';
  const link = o.linkUrl ?? (o.linkPath ? `${config.WEB_URL}${o.linkPath}` : undefined);

  const base: Record<string, string> = { orgName, ayLabel: ay?.label ?? '' };
  for (const [k, v] of Object.entries(o.vars)) base[k] = v ?? '';

  let emailed = 0;
  const inAppUsers: { userId: string; msg: RenderedEvent }[] = [];
  for (const r of o.to) {
    const msg = renderEvent(template, { ...base, recipientName: r.name ?? base.recipientName ?? '' });
    if (channels.inApp && r.userId) inAppUsers.push({ userId: r.userId, msg });
    if ((channels.email || o.forceEmail) && r.email) {
      const { html, text } = emailLayout(orgName, msg, link, o.extra?.(msg));
      const ok = await sendMail({
        to: r.email,
        subject: msg.subject,
        html,
        text,
        attachments: o.attachments,
        ayId: o.ayId,
        templateKey: key,
        entityType: o.entityType,
        entityId: o.entityId,
        requestedBy: o.requestedBy,
        sensitive: o.sensitive,
      });
      if (ok) emailed++;
    }
  }
  for (const { userId, msg } of inAppUsers) {
    await notify([userId], {
      ayId: o.ayId,
      type: key,
      title: msg.subject,
      body: msg.notice || undefined,
      linkPath: o.linkPath,
      entityType: o.entityType,
      entityId: o.entityId,
    });
  }
  return { emailed, channels };
}
