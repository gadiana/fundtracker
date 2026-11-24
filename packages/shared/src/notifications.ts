import { z } from 'zod';

/**
 * Every message the app sends, in one catalog. Each AY's adviser decides which events send an
 * in-app notice and which send an email (Settings → Email & notifications) and can edit the
 * wording. The API renders with these same functions, so the settings preview is exact.
 */

export type EventGroup = 'Accounts' | 'Students' | 'Fund requests' | 'Liquidation receipts' | 'Payments';

export interface EventTemplate {
  /** email subject, also the title of the in-app notice */
  subject: string;
  /** short line shown under the title in the notifications list */
  notice: string;
  /** email text: paragraphs separated by a blank line */
  body: string;
  /** label of the email's button (only for events that link somewhere) */
  button: string;
}

export interface EventDefinition {
  key: string;
  group: EventGroup;
  label: string;
  /** who receives it */
  audience: string;
  /** channels this event can use */
  channels: { inApp: boolean; email: boolean };
  defaults: { inApp: boolean; email: boolean };
  /** security emails can't be turned off */
  locked?: boolean;
  /** what the email switch means, when it isn't simply "send an email" */
  emailSwitchLabel?: string;
  /** placeholders this event offers, with example values for the preview */
  variables: Record<string, string>;
  template: EventTemplate;
}

const COMMON_VARIABLES = {
  orgName: 'Sample Student Organization',
  ayLabel: '2026-2027',
  recipientName: 'Juan Dela Cruz',
};

const request = {
  requestNo: 'FR-0007',
  fundName: 'Student Fee',
  amount: '₱2,500.00',
  purpose: 'Printing of the October issue',
  requestorName: 'Paolo Lim',
  requestorDesignation: 'President',
};

const def = (d: Omit<EventDefinition, 'variables'> & { variables?: Record<string, string> }): EventDefinition => ({
  ...d,
  variables: { ...COMMON_VARIABLES, ...d.variables },
});

export const NOTIFICATION_EVENTS: EventDefinition[] = [
  def({
    key: 'auth.verify_email',
    group: 'Accounts',
    label: 'Email verification',
    audience: 'The person who signed up',
    channels: { inApp: false, email: true },
    defaults: { inApp: false, email: true },
    locked: true,
    template: {
      subject: 'Verify your email for {{orgName}}',
      notice: '',
      body: 'Hi {{recipientName}},\n\nConfirm your email address to finish setting up your account. This link expires in 24 hours.',
      button: 'Verify email',
    },
  }),
  def({
    key: 'auth.reset_password',
    group: 'Accounts',
    label: 'Password reset',
    audience: 'The person who asked for it',
    channels: { inApp: false, email: true },
    defaults: { inApp: false, email: true },
    locked: true,
    template: {
      subject: 'Reset your {{orgName}} password',
      notice: '',
      body: 'Hi {{recipientName}},\n\nSomeone asked to reset the password for this account. This link expires in 1 hour. If it wasn’t you, ignore this email.',
      button: 'Choose a new password',
    },
  }),
  def({
    key: 'membership.pending',
    group: 'Accounts',
    label: 'New account waiting for approval',
    audience: 'The adviser',
    channels: { inApp: true, email: true },
    defaults: { inApp: true, email: true },
    variables: { applicantName: 'Ana Cruz', applicantEmail: 'ana@example.com' },
    template: {
      subject: 'New account waiting for approval: {{applicantName}}',
      notice: '{{applicantEmail}} asked to join AY {{ayLabel}}.',
      body: '{{applicantName}} ({{applicantEmail}}) asked to join {{orgName}} for AY {{ayLabel}}.\n\nOpen User Management to approve them and assign their position, or reject the request.',
      button: 'Review pending accounts',
    },
  }),
  def({
    key: 'membership.approved',
    group: 'Accounts',
    label: 'Account approved',
    audience: 'The new member',
    channels: { inApp: true, email: true },
    defaults: { inApp: true, email: true },
    variables: { position: 'Treasurer' },
    template: {
      subject: 'Your {{orgName}} account was approved',
      notice: 'Your account for AY {{ayLabel}} is active. Your position: {{position}}.',
      body: 'Hi {{recipientName}},\n\nYour account for AY {{ayLabel}} was approved. Your position: {{position}}.',
      button: 'Log in',
    },
  }),
  def({
    key: 'membership.rejected',
    group: 'Accounts',
    label: 'Account request not approved',
    audience: 'The person who asked to join',
    channels: { inApp: true, email: true },
    defaults: { inApp: true, email: true },
    variables: { comment: 'Please sign up with your school email.' },
    template: {
      subject: 'Your {{orgName}} account request',
      notice: '{{comment}}',
      body: 'Hi {{recipientName}},\n\nYour request to join {{orgName}} for AY {{ayLabel}} was not approved.\n\nComment from the adviser: {{comment}}',
      button: '',
    },
  }),
  def({
    key: 'student.self_enrolled',
    group: 'Students',
    label: 'Student self-enrolled',
    audience: 'The adviser and collectors',
    channels: { inApp: true, email: true },
    defaults: { inApp: true, email: false },
    variables: { studentName: 'Maria Clara S. Dela Cruz', studentNumber: '2026-00123' },
    template: {
      subject: '{{studentName}} enrolled and is waiting for approval',
      notice: 'Student number {{studentNumber}}',
      body: '{{studentName}} (student number {{studentNumber}}) enrolled through the self-enrollment link for AY {{ayLabel}}.\n\nOpen the student’s record to approve or reject the enrollment.',
      button: 'Open the student',
    },
  }),
  def({
    key: 'fund_request.submitted',
    group: 'Fund requests',
    label: 'New fund request',
    audience: 'The approvers',
    channels: { inApp: true, email: true },
    defaults: { inApp: true, email: true },
    variables: request,
    template: {
      subject: 'New fund request {{requestNo}}',
      notice: '{{requestorName}} ({{requestorDesignation}}) requests {{amount}} from {{fundName}}: {{purpose}}',
      body: '{{requestorName}} ({{requestorDesignation}}) requests {{amount}} from {{fundName}}.\n\nPurpose: {{purpose}}',
      button: 'Review the request',
    },
  }),
  def({
    key: 'fund_request.approved',
    group: 'Fund requests',
    label: 'Fund request approved',
    audience: 'The requestor',
    channels: { inApp: true, email: true },
    defaults: { inApp: true, email: true },
    variables: { ...request, approverName: 'Maria Santos' },
    template: {
      subject: '{{requestNo}} was approved',
      notice: '{{amount}} from {{fundName}} was approved by {{approverName}}.',
      body: 'Hi {{recipientName}},\n\n{{requestNo}} ({{amount}} from {{fundName}}) was approved by {{approverName}}.\n\nUpload the liquidation receipt after you use the money.',
      button: 'Open the request',
    },
  }),
  def({
    key: 'fund_request.rejected',
    group: 'Fund requests',
    label: 'Fund request rejected',
    audience: 'The requestor',
    channels: { inApp: true, email: true },
    defaults: { inApp: true, email: true },
    variables: { ...request, approverName: 'Maria Santos', comment: 'Use the Books fund instead.' },
    template: {
      subject: '{{requestNo}} was rejected',
      notice: 'Rejected by {{approverName}}. {{comment}}',
      body: 'Hi {{recipientName}},\n\n{{requestNo}} ({{amount}} from {{fundName}}) was rejected by {{approverName}}.\n\nComment: {{comment}}',
      button: 'Open the request',
    },
  }),
  def({
    key: 'fund_request.canceled',
    group: 'Fund requests',
    label: 'Approved request canceled',
    audience: 'The requestor',
    channels: { inApp: true, email: true },
    defaults: { inApp: true, email: true },
    variables: { ...request, approverName: 'Maria Santos', reason: 'The event was moved.' },
    template: {
      subject: '{{requestNo}} was canceled',
      notice: 'Canceled by {{approverName}}. Reason: {{reason}}',
      body: 'Hi {{recipientName}},\n\n{{requestNo}} ({{amount}} from {{fundName}}) was canceled by {{approverName}}.\n\nReason: {{reason}}',
      button: 'Open the request',
    },
  }),
  def({
    key: 'liquidation.submitted',
    group: 'Liquidation receipts',
    label: 'Liquidation receipt submitted',
    audience: 'The approvers',
    channels: { inApp: true, email: true },
    defaults: { inApp: true, email: true },
    variables: { ...request, fundUsed: '₱2,350.60', approvedAmount: '₱2,500.00', overApproved: '' },
    template: {
      subject: 'Liquidation receipt for {{requestNo}}',
      notice: '{{requestorName}} used {{fundUsed}} of the {{approvedAmount}} approved. {{overApproved}}',
      body: '{{requestorName}} submitted the liquidation receipt for {{requestNo}}: {{fundUsed}} used of the {{approvedAmount}} approved.\n\n{{overApproved}}\n\nPlease review it.',
      button: 'Review the receipt',
    },
  }),
  def({
    key: 'liquidation.approved',
    group: 'Liquidation receipts',
    label: 'Receipt approved',
    audience: 'The requestor',
    channels: { inApp: true, email: true },
    defaults: { inApp: true, email: true },
    variables: { ...request, fundUsed: '₱2,350.60', approverName: 'Maria Santos', nextStep: 'Please return the change of ₱149.40 to the treasurer.' },
    template: {
      subject: 'Your receipt for {{requestNo}} was approved',
      notice: 'Your receipt for {{fundUsed}} was approved by {{approverName}}. {{nextStep}}',
      body: 'Hi {{recipientName}},\n\nYour receipt for {{fundUsed}} was approved by {{approverName}}, and it was deducted from {{fundName}}.\n\n{{nextStep}}',
      button: 'Open the request',
    },
  }),
  def({
    key: 'liquidation.settled',
    group: 'Liquidation receipts',
    label: 'Reimbursement or change recorded (request cleared)',
    audience: 'The requestor',
    channels: { inApp: true, email: true },
    defaults: { inApp: true, email: true },
    variables: { ...request, settlement: '₱350.00 was reimbursed to you', settledByName: 'Juan Dela Cruz' },
    template: {
      subject: '{{requestNo}} is cleared',
      notice: '{{settlement}}, recorded by {{settledByName}}. {{requestNo}} is cleared.',
      body: 'Hi {{recipientName}},\n\n{{settlement}}, recorded by {{settledByName}}. {{requestNo}} is cleared.',
      button: 'Open the request',
    },
  }),
  def({
    key: 'liquidation.revision_requested',
    group: 'Liquidation receipts',
    label: 'Receipt sent back for revision',
    audience: 'The requestor',
    channels: { inApp: true, email: true },
    defaults: { inApp: true, email: true },
    variables: { ...request, approverName: 'Maria Santos', message: 'The receipt photo is blurry.' },
    template: {
      subject: '{{requestNo}}: please revise your receipt',
      notice: '{{approverName}} sent it back. {{message}}',
      body: 'Hi {{recipientName}},\n\n{{approverName}} sent your liquidation receipt for {{requestNo}} back for revision.\n\nMessage: {{message}}',
      button: 'Revise the receipt',
    },
  }),
  def({
    key: 'payment.receipt',
    group: 'Payments',
    label: 'Digital receipt',
    audience: 'The student (staff can always email a receipt from the receipt page)',
    channels: { inApp: false, email: true },
    defaults: { inApp: false, email: false },
    emailSwitchLabel: 'Email it automatically after each payment (to students with an email on file)',
    variables: { studentName: 'Maria Clara S. Dela Cruz', transactionNo: '2026-11-12-0011', amount: '₱400.00' },
    template: {
      subject: 'Receipt {{transactionNo}} – {{orgName}}',
      notice: '',
      body: 'Hi {{studentName}},\n\nThank you for your payment of {{amount}}. Your digital receipt is below. Scan the QR code any time to check your status.',
      button: '',
    },
  }),
];

export const EVENTS_BY_KEY = new Map(NOTIFICATION_EVENTS.map((e) => [e.key, e]));
export const eventDefinition = (key: string) => {
  const e = EVENTS_BY_KEY.get(key);
  if (!e) throw new Error(`Unknown notification event: ${key}`);
  return e;
};

// ───────────── per-AY choices (stored as JSON in ay_settings) ─────────────

export type EventChannels = Record<string, { inApp: boolean; email: boolean }>;
export type EventTemplates = Record<string, Partial<EventTemplate>>;

/** The AY's on/off choices merged over the defaults; locked and unsupported channels are forced. */
export function resolveChannels(stored: unknown, key: string) {
  const e = eventDefinition(key);
  const saved = (stored && typeof stored === 'object' ? (stored as EventChannels)[key] : undefined) ?? e.defaults;
  return {
    inApp: e.channels.inApp && Boolean(saved.inApp),
    email: e.channels.email && (e.locked ? true : Boolean(saved.email)),
  };
}

/** The AY's edited wording merged over the default wording. */
export function resolveTemplate(stored: unknown, key: string): EventTemplate {
  const e = eventDefinition(key);
  const saved = (stored && typeof stored === 'object' ? (stored as EventTemplates)[key] : undefined) ?? {};
  return { ...e.template, ...Object.fromEntries(Object.entries(saved).filter(([, v]) => typeof v === 'string')) };
}

// ───────────── rendering ─────────────

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

export const placeholdersIn = (text: string) => [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!);

const fill = (text: string, vars: Record<string, string>) => text.replace(PLACEHOLDER, (_, name: string) => vars[name] ?? '');

/**
 * A paragraph (or the notice) whose placeholders are all empty is left out, so optional details
 * such as a comment don't leave a dangling "Comment:" behind.
 */
function keep(text: string, vars: Record<string, string>) {
  const names = placeholdersIn(text);
  return names.length === 0 || names.some((n) => (vars[n] ?? '').trim() !== '');
}

export interface RenderedEvent {
  subject: string;
  notice: string;
  paragraphs: string[];
  button: string;
}

export function renderEvent(template: EventTemplate, vars: Record<string, string>): RenderedEvent {
  const tidy = (s: string) => s.replace(/[ \t]+/g, ' ').trim();
  return {
    subject: tidy(fill(template.subject, vars)),
    notice: keep(template.notice, vars) ? tidy(fill(template.notice, vars)) : '',
    paragraphs: template.body
      .split(/\n\s*\n/)
      .filter((p) => p.trim() && keep(p, vars))
      .map((p) => fill(p, vars).trim()),
    button: tidy(fill(template.button, vars)),
  };
}

// ───────────── email layout ─────────────

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The HTML and plain-text email around a rendered message. `extraHtml` goes under the text (e.g. the receipt). */
export function emailLayout(org: string, msg: RenderedEvent, link?: string, extra?: { html: string; text: string }) {
  const body = msg.paragraphs.map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  const action =
    link && msg.button
      ? `<p style="margin:20px 0"><a href="${escapeHtml(link)}" style="background:#4338ca;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(msg.button)}</a></p>
       <p style="margin:0 0 12px;font-size:12px;color:#64748b">If the button doesn't work, open this link:<br>${escapeHtml(link)}</p>`
      : '';
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
    <p style="margin:0 0 4px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(org)}</p>
    <h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(msg.subject)}</h1>${body}${action}${extra?.html ?? ''}</div>`;
  const text = [
    msg.subject,
    '',
    ...msg.paragraphs.flatMap((p) => [p, '']),
    ...(link && msg.button ? [`${msg.button}: ${link}`, ''] : []),
    ...(extra ? [extra.text] : []),
  ]
    .join('\n')
    .trim();
  return { html, text };
}

// ───────────── what the adviser saves ─────────────

const templateField = (max: number) => z.string().max(max, `At most ${max} characters`);

export const eventTemplateSchema = z.object({
  subject: templateField(200).min(1, 'The subject can’t be empty'),
  notice: templateField(300),
  body: templateField(4000),
  button: templateField(40),
});

/** Saves one event: its switches and its wording (null wording = back to the default). */
export const notificationEventUpdateSchema = z.object({
  inApp: z.boolean(),
  email: z.boolean(),
  template: eventTemplateSchema.nullable(),
});

/** Placeholders a template uses that its event doesn't offer. */
export function unknownPlaceholders(key: string, template: EventTemplate) {
  const allowed = new Set(Object.keys(eventDefinition(key).variables));
  const used = [template.subject, template.notice, template.body, template.button].flatMap(placeholdersIn);
  return [...new Set(used.filter((n) => !allowed.has(n)))];
}

export const testEmailSchema = z.object({ to: z.string().trim().toLowerCase().email('Enter a valid email address').optional() });
