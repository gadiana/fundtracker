import nodemailer from 'nodemailer';
import type { EmailOutbox } from '@prisma/client';
import { config, isProd, isTest } from '../config';
import { prisma } from '../db';
import type { Actor } from './audit';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  /** reference it in the HTML as <img src="cid:..."> */
  cid?: string;
  contentType?: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
  from?: string;
  replyTo?: string;
}

interface SendOptions extends Omit<MailMessage, 'from' | 'replyTo'> {
  ayId?: string | null;
  templateKey?: string;
  entityType?: string;
  entityId?: string;
  requestedBy?: Actor;
  /** Contains a one-time link: the body is not stored in the outbox. */
  sensitive?: boolean;
}

/** Messages "sent" while NODE_ENV=test, for assertions. */
export const sentMail: MailMessage[] = [];
/** Tests: make the next `failNext` deliveries fail (only those to `failTo`, when set). */
export const mailTestControls: { failNext: number; failTo?: string } = { failNext: 0 };

const transport = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    })
  : null;

const REDACTED_BODY = '[contains a one-time link; body not stored]';

/** Tries a failed email again after 1 min, 5 min, 30 min and 2 h; after that it stays failed. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

const addressOf = (from: string) => from.match(/<([^>]+)>/)?.[1] ?? from.trim();
const quoted = (name: string) => `"${name.replace(/["\\\r\n]/g, '')}"`;

/**
 * "Sender name <sender address>" from the AY's settings, falling back to MAIL_FROM. Many mail
 * servers only accept their own address as the sender; then leave the address empty and set
 * a reply-to instead.
 */
export async function senderFor(academicYearId: string | null | undefined) {
  const s = academicYearId ? await prisma.aySetting.findUnique({ where: { academicYearId } }) : null;
  const address = s?.emailSenderAddress || addressOf(config.MAIL_FROM);
  const name = s?.emailSenderName || s?.orgName || config.MAIL_FROM.match(/^(.*?)\s*</)?.[1]?.replace(/"/g, '') || '';
  return { from: name ? `${quoted(name)} <${address}>` : address, replyTo: s?.emailReplyTo || undefined };
}

async function deliver(msg: MailMessage) {
  if (isTest) {
    if (mailTestControls.failNext > 0 && (!mailTestControls.failTo || mailTestControls.failTo === msg.to)) {
      mailTestControls.failNext--;
      throw new Error('Simulated SMTP failure');
    }
    sentMail.push(msg);
  } else if (transport) {
    await transport.sendMail(msg);
  } else {
    // in production the text is never logged: it can hold one-time links and personal details
    console.info(
      isProd
        ? `[mail] not delivered (no SMTP_HOST): "${msg.subject}" to ${msg.to}`
        : `\n[mail] SMTP is not configured, so the email is printed here instead.\nFrom: ${msg.from}\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n`,
    );
    throw new NoMailServerError();
  }
}

/** Without SMTP_HOST nothing is delivered: the email is recorded as failed, never as sent. */
export class NoMailServerError extends Error {
  constructor() {
    super('Not delivered: no mail server is set up (SMTP_HOST in the server’s .env). The email was only printed in the server console.');
  }
}

/** One attempt for an outbox row; on failure it is queued for a later try, or marked failed. */
async function attempt(row: EmailOutbox, msg: MailMessage) {
  try {
    await deliver(msg);
    await prisma.emailOutbox.update({ where: { id: row.id }, data: { status: 'sent', sentAt: new Date(), lastError: null } });
    return true;
  } catch (err) {
    const noServer = err instanceof NoMailServerError;
    if (!noServer) console.error('[mail] send failed', err);
    // retrying is pointless until a mail server is set up; "Send now" works after that
    const retry = !noServer && row.retryable && row.attempts < MAX_ATTEMPTS;
    await prisma.emailOutbox.update({
      where: { id: row.id },
      data: {
        status: retry ? 'queued' : 'failed',
        lastError: (noServer ? (err as Error).message : String(err)).slice(0, 1000),
        ...(retry ? { scheduledAt: new Date(Date.now() + RETRY_DELAYS_MS[row.attempts - 1]!) } : {}),
      },
    });
    return false;
  }
}

/** Records the email in email_outbox and sends it right away. Never throws: returns false on failure. */
export async function sendMail(msg: SendOptions): Promise<boolean> {
  const sender = await senderFor(msg.ayId);
  const row = await prisma.emailOutbox.create({
    data: {
      academicYearId: msg.ayId ?? null,
      toEmail: msg.to,
      subject: msg.subject,
      htmlBody: msg.sensitive ? REDACTED_BODY : msg.html,
      textBody: msg.sensitive ? REDACTED_BODY : msg.text,
      templateKey: msg.templateKey ?? null,
      entityType: msg.entityType ?? null,
      entityId: msg.entityId ?? null,
      status: 'sending',
      attempts: 1,
      // the stored copy is only complete without one-time links and attachments
      retryable: !msg.sensitive && !msg.attachments?.length,
      requestedById: msg.requestedBy?.id ?? null,
      requestedByName: msg.requestedBy?.name ?? null,
    },
  });
  return attempt(row, { ...sender, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, attachments: msg.attachments });
}

/** Sends a stored email again (a retry). The row must be claimed first so two workers never send it twice. */
export async function resend(id: string) {
  const claimed = await prisma.emailOutbox.updateMany({
    where: { id, retryable: true, status: { in: ['queued', 'failed'] } },
    data: { status: 'sending', attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return false;
  const row = await prisma.emailOutbox.findUniqueOrThrow({ where: { id } });
  const sender = await senderFor(row.academicYearId);
  return attempt(row, { ...sender, to: row.toEmail, subject: row.subject, html: row.htmlBody, text: row.textBody ?? '' });
}

/** Sends every queued email whose retry time has come. */
export async function retryDueEmails(now = new Date()) {
  const due = await prisma.emailOutbox.findMany({
    where: { status: 'queued', retryable: true, scheduledAt: { lte: now } },
    orderBy: { scheduledAt: 'asc' },
    take: 25,
    select: { id: true },
  });
  let sent = 0;
  for (const { id } of due) if (await resend(id)) sent++;
  return { tried: due.length, sent };
}

/** Background retries while the API runs (not in tests). */
export function startMailWorker(everyMs = 30_000) {
  const timer = setInterval(() => {
    retryDueEmails().catch((err) => console.error('[mail] retry run failed', err));
  }, everyMs);
  timer.unref();
  return timer;
}
