import type { AuditLog, Prisma } from '@prisma/client';
import { REPORT_TITLES, formatCentavos, formatPersonName } from '@sft/shared';
import { prisma } from '../../db';
import { defaultReportFormat } from '../reports/formats';

/**
 * Turns audit log rows into plain sentences for the adviser ("Juan Dela Cruz added section A
 * to BSIT 1st year"), with the changed fields as short lines ("Amount: ₱100.00 → ₱130.00").
 * No ids or raw data are shown.
 */
export interface Described {
  summary: string;
  details: string[];
}

type Data = Record<string, unknown>;
const obj = (v: Prisma.JsonValue | null): Data => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Data) : {});

// ───────────── values ─────────────

/** Fields that hold money in centavos. */
const MONEY = new Set(['amount', 'amountPerStudent', 'fundUsed', 'approvedAmount', 'balanceAfter', 'ledgerUsage', 'excessAbsorbedByRequestor']);
/** Fields never shown: ids, bookkeeping, and data that means nothing to a reader. */
const HIDDEN = /(^id$|Id$|Ids$|^ids$|^academicYearId$|^sortOrder$|^addedAt$|^addedByName$|^decidedByName$|Hash$|^charges$|^summary$|^options$|^waitingFor$|^allocations$)/;

const LABELS: Record<string, string> = {
  name: 'Name',
  code: 'Code',
  label: 'Label',
  status: 'Status',
  isActive: 'Active',
  amount: 'Amount',
  amountPerStudent: 'Amount per student',
  isMandatory: 'Mandatory',
  isConfidential: 'Confidential',
  yearLevels: 'Year levels',
  yearLevel: 'Year level',
  programs: 'Programs',
  program: 'Program',
  section: 'Section',
  notes: 'Notes',
  studentNumber: 'Student number',
  email: 'Email',
  contactNo: 'Contact number',
  designation: 'Position',
  role: 'Role',
  maxMembers: 'Member limit',
  canCollect: 'Can collect payments',
  canViewFunds: 'Can see funds',
  canFileRequests: 'Can file fund requests',
  isConfidentialExempt: 'Can see confidential funds',
  approvesFundRequests: 'Approves fund requests',
  approvesLiquidations: 'Approves liquidations',
  orgName: 'Organization name',
  orgAbbr: 'Organization abbreviation',
  schoolName: 'School name',
  schoolAbbr: 'School abbreviation',
  collegeName: 'College name',
  collegeAbbr: 'College abbreviation',
  programName: 'Program name',
  programAbbr: 'Program abbreviation',
  yearLevelCount: 'Number of year levels',
  allowPartialPayments: 'Allow partial payments',
  allocationMode: 'How payments are split',
  requestApprovalRule: 'Fund request approval',
  liquidationApprovalRule: 'Liquidation approval',
  requireRequestAttachment: 'Fund requests need an attachment',
  requireLiquidationAttachment: 'Liquidations need an attachment',
  publicFields: 'Shown on the public verify page',
  reportPaperSize: 'Report paper size',
  reportFormats: 'Report formats',
  passwordMinLength: 'Minimum password length',
  passwordRequireUpper: 'Passwords need upper and lower case',
  passwordRequireNumber: 'Passwords need a number',
  passwordRequireSymbol: 'Passwords need a symbol',
  twofaMode: 'Two-factor sign-in',
  uploadAllowedMime: 'Allowed file types',
  uploadMaxBytes: 'Largest upload',
  dateFormat: 'Date format',
  privacyConsentText: 'Data privacy notice',
  reason: 'Reason',
  comment: 'Comment',
  message: 'Message',
  purpose: 'Purpose',
  useAt: 'To be used on',
  fund: 'Fund',
  currentAy: 'Current academic year',
  expiresAt: 'Expires',
  maxUses: 'Most sign-ups',
};

/** "passwordMinLength" → "Password min length", for fields without a label. */
const words = (key: string) => {
  const s = key.replace(/^notification:/, '').replace(/[_:]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const labelOf = (key: string) => (key.startsWith('notification:') ? `Email "${words(key)}"` : (LABELS[key] ?? words(key)));

const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'];
const year = (n: unknown) => `${ORDINAL[Number(n)] ?? `${n}th`} year`;
const peso = (n: unknown) => formatCentavos(Number(n));

function show(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '(none)';
  if (MONEY.has(key) && typeof v === 'number') return peso(v);
  if (key === 'uploadMaxBytes' && typeof v === 'number') return `${Math.round(v / 1_048_576)} MB`;
  if (key === 'yearLevel') return year(v);
  if (key === 'yearLevels' && Array.isArray(v)) return v.map(year).join(', ');
  if (key === 'programs' && v === 'all') return 'All programs';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return new Date(v).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
  }
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x ? String((x as Data).label ?? (x as Data).name ?? '') : String(x))).filter(Boolean).join(', ') || '(none)';
  if (typeof v === 'object') return '(changed)';
  const text = String(v).replace(/_/g, ' ');
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/** "Amount: ₱100.00 → ₱130.00" for every shown field that changed. */
function changes(before: Data, after: Data) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !HIDDEN.test(k));
  return keys
    .filter((k) => k in after && JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
    .flatMap((k) =>
      // report formats are spelled out per report; other fields are one "Label: old → new" line
      k === 'reportFormats'
        ? reportFormatChanges(before[k], after[k])
        : k in before
          ? `${labelOf(k)}: ${show(k, before[k])} → ${show(k, after[k])}`
          : `${labelOf(k)}: ${show(k, after[k])}`,
    );
}

// ───────────── report formats (Settings → Reports) ─────────────

const PAPER: Record<string, string> = { A4: 'A4', LETTER: 'Letter', LEGAL: 'Legal' };
const ALIGN: Record<string, string> = { left: 'left', center: 'centered', right: 'right' };
const list = (v: unknown): Data[] => (Array.isArray(v) ? v.filter((x): x is Data => Boolean(x) && typeof x === 'object') : []);
const quote = (v: unknown) => `"${String(v ?? '')}"`;
const signatory = (s: Data) => `${String(s.label || '(no label)')}: ${s.name ? String(s.name) : 'whoever prints it'}${s.position ? ` (${String(s.position)})` : ''}`;
/** JSON with sorted keys: the database stores JSON objects with its own key order. */
const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Data)[k])}`).join(',')}}` : JSON.stringify(v ?? null);
const sameList = (a: unknown, b: unknown) => stable(a) === stable(b);

/** A header line's style changes: bold, size, alignment. */
function lineStyle(before: Data, after: Data) {
  const out: string[] = [];
  if (Boolean(before.bold) !== Boolean(after.bold)) out.push(after.bold ? 'made bold' : 'made not bold');
  if (before.size !== after.size) out.push(`size ${String(before.size)} pt → ${String(after.size)} pt`);
  if (before.align !== after.align) out.push(`${ALIGN[String(before.align)] ?? String(before.align)} → ${ALIGN[String(after.align)] ?? String(after.align)}`);
  return out;
}

function logoChanges(side: string, before: unknown, after: unknown) {
  const b = (Array.isArray(before) ? before : []).map(String);
  const a = (Array.isArray(after) ? after : []).map(String);
  if (sameList(a, b)) return [];
  const name = (l: string) => (l === 'org' ? 'the organization logo' : 'a logo');
  const out = [...a.filter((l) => !b.includes(l)).map((l) => `added ${name(l)} on the ${side}`), ...b.filter((l) => !a.includes(l)).map((l) => `removed ${name(l)} from the ${side}`)];
  if (!out.length) out.push(`changed the order of the logos on the ${side}`);
  return out;
}

function headerChanges(before: unknown, after: unknown) {
  const b = list(before);
  const a = list(after);
  if (sameList(a, b)) return [];
  const out: string[] = [];
  if (a.length === b.length) {
    // same number of lines: compare them one by one
    a.forEach((line, i) => {
      const old = b[i]!;
      if (old.text !== line.text) out.push(`header line ${i + 1}: ${quote(old.text)} → ${quote(line.text)}`);
      const style = lineStyle(old, line);
      if (style.length) out.push(`header line ${quote(line.text)}: ${style.join(', ')}`);
    });
    return out;
  }
  for (const line of a) {
    const old = b.find((x) => x.text === line.text);
    if (!old) out.push(`added header line ${quote(line.text)}`);
    else if (lineStyle(old, line).length) out.push(`header line ${quote(line.text)}: ${lineStyle(old, line).join(', ')}`);
  }
  for (const line of b) if (!a.some((x) => x.text === line.text)) out.push(`removed header line ${quote(line.text)}`);
  if (!out.length) out.push('changed the order of the header lines');
  return out;
}

function signatoryChanges(before: unknown, after: unknown) {
  const b = list(before);
  const a = list(after);
  if (sameList(a, b)) return [];
  const out: string[] = [];
  const shown = (s: Data, old: Data) => (Boolean(s.show) !== Boolean(old.show) ? [`${signatory(s)}: ${s.show ? 'now shown on the report' : 'hidden from the report'}`] : []);
  if (a.length === b.length) {
    a.forEach((s, i) => {
      const old = b[i]!;
      if (old.label !== s.label || old.name !== s.name || old.position !== s.position) out.push(`signatory ${signatory(old)} → ${signatory(s)}`);
      out.push(...shown(s, old));
    });
  } else {
    const key = (s: Data) => `${String(s.label)}|${String(s.name)}|${String(s.position)}`;
    for (const s of a) {
      const old = b.find((x) => key(x) === key(s));
      if (!old) out.push(`added signatory ${signatory(s)}${s.show ? '' : ' (hidden)'}`);
      else out.push(...shown(s, old));
    }
    for (const s of b) if (!a.some((x) => key(x) === key(s))) out.push(`removed signatory ${signatory(s)}`);
  }
  if (!out.length) out.push('changed the order of the signatories');
  return out;
}

/** One report's format in a few words, when there is nothing to compare it with. */
function formatSummary(f: Data) {
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  const lines = list(f.headerLines).filter((l) => l.text);
  const sigs = list(f.signatories);
  return [
    `paper size ${PAPER[String(f.paperSize)] ?? String(f.paperSize)}`,
    `logos: ${count(f.logosLeft)} on the left, ${count(f.logosRight)} on the right`,
    `header: ${lines.length ? lines.map((l) => quote(l.text)).join(', ') : 'none'}`,
    `signatories: ${sigs.length ? sigs.map((s) => `${signatory(s)}${s.show ? '' : ' (hidden)'}`).join('; ') : 'none'}`,
  ];
}

/** What changed in each report's format, as "Collection report: paper size A4 → Legal" lines. */
function reportFormatChanges(before: unknown, after: unknown): string[] {
  const b = obj(before as Prisma.JsonValue);
  const a = obj(after as Prisma.JsonValue);
  const out: string[] = [];
  for (const kind of Object.keys(a)) {
    const next = obj(a[kind] as Prisma.JsonValue);
    const name = REPORT_TITLES[kind as keyof typeof REPORT_TITLES] ?? words(kind);
    if (!(kind in b)) {
      // logged before the old format was recorded: show the new one
      out.push(...formatSummary(next).map((l) => `${name}: ${l}`));
      continue;
    }
    const prev = obj(b[kind] as Prisma.JsonValue);
    if (sameList(prev, next)) continue;
    const lines = [
      ...(prev.paperSize !== next.paperSize ? [`paper size ${PAPER[String(prev.paperSize)] ?? String(prev.paperSize)} → ${PAPER[String(next.paperSize)] ?? String(next.paperSize)}`] : []),
      ...logoChanges('left', prev.logosLeft, next.logosLeft),
      ...logoChanges('right', prev.logosRight, next.logosRight),
      ...(prev.logoSize !== next.logoSize ? [`logo size ${String(prev.logoSize)} pt → ${String(next.logoSize)} pt`] : []),
      ...headerChanges(prev.headerLines, next.headerLines),
      ...signatoryChanges(prev.signatories, next.signatories),
    ];
    out.push(...lines.map((l) => `${name}: ${l}`));
  }
  return out;
}
/** The shown fields of a new or removed record, as "Label: value" lines. */
function fields(data: Data, only?: string[]) {
  return Object.keys(data)
    .filter((k) => !HIDDEN.test(k) && (!only || only.includes(k)) && data[k] !== null && data[k] !== undefined && data[k] !== '')
    .map((k) => `${labelOf(k)}: ${show(k, data[k])}`);
}

// ───────────── names the rows don't carry ─────────────

async function lookups(rows: AuditLog[]) {
  const ids = (...types: string[]) => [...new Set(rows.filter((r) => types.includes(r.entityType) && r.entityId).map((r) => r.entityId!))];
  const uuid = (list: string[]) => list.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const [members, users, funds, requests, liquidations, payments, students] = await Promise.all([
    prisma.userAyRole.findMany({ where: { id: { in: uuid(ids('user_ay_role')) } }, include: { user: true } }),
    prisma.user.findMany({ where: { id: { in: uuid(ids('user', 'approver', 'two_factor')) } } }),
    prisma.fund.findMany({ where: { id: { in: uuid(ids('fund')) } }, select: { id: true, name: true } }),
    prisma.fundRequest.findMany({ where: { id: { in: uuid(ids('fund_request')) } }, select: { id: true, requestNo: true } }),
    prisma.liquidationReceipt.findMany({ where: { id: { in: uuid(ids('liquidation_receipt')) } }, select: { id: true, fundRequest: { select: { requestNo: true } } } }),
    prisma.payment.findMany({ where: { id: { in: uuid(ids('payment', 'receipt_email')) } }, select: { id: true, transactionNo: true } }),
    prisma.student.findMany({ where: { id: { in: uuid(ids('student')) } } }),
  ]);
  return new Map<string, string>([
    ...members.map((m) => [m.id, formatPersonName(m.user)] as const),
    ...users.map((u) => [u.id, formatPersonName(u)] as const),
    ...funds.map((f) => [f.id, f.name] as const),
    ...requests.map((r) => [r.id, r.requestNo] as const),
    ...liquidations.map((l) => [l.id, l.fundRequest.requestNo] as const),
    ...payments.map((p) => [p.id, p.transactionNo] as const),
    ...students.map((s) => [s.id, formatPersonName(s)] as const),
  ]);
}

// ───────────── sentences ─────────────

/**
 * Report format changes logged before the old format was recorded in full have an empty
 * "before" for reports that were never saved: those reports were using their default.
 */
async function withDefaultFormats(rows: AuditLog[]) {
  const needs = rows.filter((r) => r.entityType === 'settings' && r.academicYearId && 'reportFormats' in obj(r.afterData));
  if (!needs.length) return rows;
  const settings = await prisma.aySetting.findMany({ where: { academicYearId: { in: [...new Set(needs.map((r) => r.academicYearId!))] } } });
  const byAy = new Map(settings.map((s) => [s.academicYearId, s]));
  return rows.map((r) => {
    const s = r.academicYearId ? byAy.get(r.academicYearId) : undefined;
    if (!needs.includes(r) || !s) return r;
    const before = obj(r.beforeData);
    const formats = obj((before.reportFormats ?? null) as Prisma.JsonValue);
    const filled = Object.fromEntries(
      Object.keys(obj(obj(r.afterData).reportFormats as Prisma.JsonValue)).map((kind) => [kind, formats[kind] ?? defaultReportFormat(kind as never, s)]),
    );
    return { ...r, beforeData: { ...before, reportFormats: filled } as Prisma.JsonValue };
  });
}

export async function describeAudit(logged: AuditLog[]): Promise<Described[]> {
  const rows = await withDefaultFormats(logged);
  const names = await lookups(rows);
  return rows.map((r) => {
    try {
      return describeOne(r, names);
    } catch {
      return { summary: `${r.actorName} made a change (${words(r.entityType)})`, details: [] };
    }
  });
}

function describeOne(r: AuditLog, names: Map<string, string>): Described {
  const before = obj(r.beforeData);
  const after = obj(r.afterData);
  const who = r.actorName;
  const known = (r.entityId && names.get(r.entityId)) || '';
  const pick = (...keys: string[]) => {
    for (const k of keys) for (const d of [after, before]) if (d[k] !== undefined && d[k] !== null && d[k] !== '') return String(d[k]);
    return known;
  };
  const say = (summary: string, details: string[] = []): Described => ({ summary: `${who} ${summary}`, details });
  const by = (verb: Record<string, string>, thing: string, details: string[] = []) => say(`${verb[r.action] ?? 'changed'} ${thing}`, details);
  const VERBS = { create: 'added', update: 'edited', delete: 'removed', deactivate: 'deactivated', reactivate: 'reactivated', approve: 'approved', reject: 'rejected' };

  switch (r.entityType) {
    // ── people and sign-in ──
    case 'user':
      switch (r.action) {
        case 'signup':
          return { summary: `${who} signed up`, details: fields(after, ['email', 'contactNo']) };
        case 'login':
          return { summary: `${who} signed in`, details: after.twoFactor ? [`With two-factor sign-in (${show('', after.twoFactor)})`] : [] };
        case 'login_failed':
          return { summary: `Failed sign-in for ${who}`, details: [after.step === 'two_factor' ? 'Wrong two-factor code' : 'Wrong password', ...(after.locked ? ['The account was locked for a while'] : [])] };
        case 'logout':
          return say('signed out');
        case 'verify_email':
          return say('confirmed their email address');
        case 'password_reset':
          return say('reset their password');
        case 'password_change':
          return say('changed their password');
        case 'create':
          return say(`created an account for ${pick('email')}`);
        case 'delete':
          return say(`removed the account request of ${pick('name')}`);
        default:
          if (after.picture) return say(after.picture === 'removed' ? 'removed their profile picture' : 'changed their profile picture');
          return say('updated their profile', changes(before, after));
      }
    case 'user_session':
      return { summary: `A sign-in of ${known || 'a user'} was ended for safety`, details: after.reason ? [String(after.reason)] : [] };
    case 'two_factor':
      return say(after.twoFactor === 'enabled' ? 'turned on two-factor sign-in' : after.twoFactor === 'disabled' ? 'turned off two-factor sign-in' : 'made new two-factor recovery codes');
    case 'user_ay_role': {
      const member = known || 'a member';
      const position = (d: Data) => (d.role === 'adviser' ? 'Adviser' : show('designation', d.designation));
      switch (r.action) {
        case 'approve':
          return say(`approved ${member} as ${position(after)}`);
        case 'reject':
          return say(`rejected ${member}'s request to join`, after.decisionNote ? [`Note: ${show('', after.decisionNote)}`] : []);
        case 'update':
          return say(`changed ${member}'s position`, [`${position(before)} → ${position(after)}`]);
        case 'deactivate':
          return say(`deactivated ${member}'s access`);
        case 'reactivate':
          return say(`gave ${member} access again`);
        case 'request_access':
          return say('asked to join this academic year');
        default:
          return say(`changed ${member}'s access`);
      }
    }
    case 'approver': {
      const person = known || 'a member';
      if (r.action === 'delete') return say(`removed ${person} from the approvers`);
      const roles = [after.approvesFundRequests && 'fund requests', after.approvesLiquidations && 'liquidations'].filter(Boolean).join(' and ');
      return r.action === 'create' ? say(`made ${person} an approver of ${roles || 'nothing yet'}`) : say(`changed what ${person} approves`, changes(before, after));
    }

    // ── structure ──
    case 'program':
      return by(VERBS, `program ${pick('code')}${pick('name') && pick('name') !== pick('code') ? ` (${pick('name')})` : ''}`, r.action === 'update' ? changes(before, after) : []);
    case 'section': {
      const d = r.action === 'delete' ? before : after;
      const where = d.program ? ` ${r.action === 'delete' ? 'from' : 'to'} ${d.program} ${year(d.yearLevel)}` : '';
      if (r.action === 'create') return say(`added section ${pick('name')}${where}`);
      if (r.action === 'delete') return say(`removed section ${pick('name')}${where}`);
      return say(`edited section ${pick('name')}${d.program ? ` of ${d.program} ${year(d.yearLevel)}` : ''}`, changes(before, after));
    }
    case 'designation':
      return by(VERBS, `the position "${pick('name')}"`, r.action === 'update' ? changes(before, after) : []);
    case 'designation_order':
      return say('changed the order of the positions');
    case 'settings':
      return say('changed the settings', changes(before, after));
    case 'academic_year':
      if (r.action === 'create') return say(`created academic year ${pick('label')}`);
      if ('currentAy' in after) return say(`made AY ${show('', after.currentAy)} the current academic year`);
      return say(after.status === 'closed' ? 'closed this academic year' : 'reopened this academic year');
    case 'ay_setup':
      return say(after.source ? `set up this academic year, copying from AY ${show('', after.source)}` : 'set up this academic year');

    // ── students ──
    case 'student': {
      const student = pick('name') || 'a student';
      switch (r.action) {
        case 'create':
          return after.source === 'self_enroll'
            ? { summary: `${student} enrolled through the link "${show('', after.link)}"`, details: ['Waiting for approval'] }
            : say(`added student ${student}`, fields(after, ['studentNumber', 'program', 'yearLevel', 'section']));
        case 'approve':
          return say(`approved student ${student}`);
        case 'reject':
          return say(`rejected student ${student}`, after.comment ? [`Comment: ${show('', after.comment)}`] : []);
        case 'deactivate':
          return say(`made student ${student} inactive`, after.reason ? [`Reason: ${show('', after.reason)}`] : []);
        case 'reactivate':
          return say(`made student ${student} active again`);
        default:
          if ('qr' in before || 'qr' in after) return say(`issued a new QR code for ${student}`);
          return say(`edited student ${student}`, changes(before, after));
      }
    }
    case 'student_import': {
      const n = Number(after.imported ?? 0);
      return say(`imported ${n} student${n === 1 ? '' : 's'} from a file`);
    }
    case 'enrollment_link':
      return r.action === 'create' ? say(`created the enrollment link "${pick('label')}"`, fields(after, ['expiresAt', 'maxUses'])) : say('turned off an enrollment link');

    // ── money ──
    case 'fund': {
      const fund = pick('name') || 'a fund';
      if (r.action === 'create') return say(`added the fund ${fund}`, fields(after, ['amountPerStudent', 'yearLevels', 'programs', 'isMandatory']));
      if (r.action === 'deactivate') return say(`deactivated the fund ${fund}`);
      if (r.action === 'reactivate') return say(`reactivated the fund ${fund}`);
      return say(`edited the fund ${fund}`, changes(before, after));
    }
    case 'fund_priority':
      return say('changed the order funds are paid in', [`${show('', before.order)} → ${show('', after.order)}`]);
    case 'fund_adjustment':
      return say(`${Number(after.amount) < 0 ? `took ${peso(-Number(after.amount))} out of` : `added ${peso(after.amount)} to`} the balance of ${pick('fund')}`, after.reason ? [`Reason: ${show('', after.reason)}`] : []);
    case 'payment':
      if (r.action === 'void') return say(`voided payment ${pick('transactionNo')}`, [`Amount: ${peso(before.amount)}`, ...(after.reason ? [`Reason: ${show('', after.reason)}`] : [])]);
      return say(
        `received ${peso(after.amount)} from ${show('', after.student)}`,
        [
          `Transaction ${show('', after.transactionNo)}`,
          ...(Array.isArray(after.allocations) ? (after.allocations as Data[]).map((a) => `${show('', a.fund)}: ${peso(a.amount)}`) : []),
          ...(after.balanceAfter !== undefined ? [`Balance left: ${peso(after.balanceAfter)}`] : []),
        ],
      );
    case 'receipt_email':
      return say(`emailed the receipt of ${pick('transactionNo')}`, after.to ? [`To: ${show('', after.to)}`] : []);
    case 'email_retry':
      return say(`sent an email again${after.ok === false ? ' (it failed again)' : ''}`, fields(after, ['to', 'subject']));
    case 'fund_request': {
      const no = pick('requestNo') || 'a fund request';
      switch (r.action) {
        case 'create':
          return say(`filed fund request ${no}: ${peso(after.amount)} from ${show('', after.fund)}`, fields(after, ['purpose', 'useAt']));
        case 'approve':
          return say(
            after.status === 'approved' ? `approved fund request ${no}` : `approved fund request ${no} (waiting for other approvers)`,
            Array.isArray(after.waitingFor) && after.waitingFor.length ? [`Still waiting for: ${after.waitingFor.join(', ')}`] : [],
          );
        case 'reject':
          return say(`rejected fund request ${no}`, after.comment ? [`Comment: ${show('', after.comment)}`] : []);
        case 'cancel':
          return say(`canceled fund request ${no}`, after.reason ? [`Reason: ${show('', after.reason)}`] : []);
        case 'archive':
          return say(`archived fund request ${no}`);
        case 'unarchive':
          return say(`brought back fund request ${no} from the archive`);
        default:
          return say(`changed fund request ${no}`);
      }
    }
    case 'liquidation_receipt': {
      const no = pick('requestNo') || 'a fund request';
      switch (r.action) {
        case 'create':
          return say(`submitted the liquidation of ${no}`, [`Spent: ${peso(after.fundUsed)} of ${peso(after.approvedAmount)}`]);
        case 'approve':
          return say(after.status === 'approved' ? `approved the liquidation of ${no}` : `approved the liquidation of ${no} (waiting for other approvers)`, [
            `Spent: ${peso(after.fundUsed)}`,
          ]);
        case 'reject':
          return say(`asked for changes to the liquidation of ${no}`, after.message ? [`Message: ${show('', after.message)}`] : []);
        default:
          if (after.status === 'cleared') {
            return say(`settled the liquidation of ${no}`, [`${after.settlement === 'reimburse' ? 'Reimbursed' : 'Returned'}: ${peso(after.amount)}`, ...(after.note ? [`Note: ${show('', after.note)}`] : [])]);
          }
          return say(`changed the liquidation of ${no}`);
      }
    }
    default:
      return say(`${VERBS[r.action as keyof typeof VERBS] ?? 'changed'} ${words(r.entityType).toLowerCase()}`, changes(before, after));
  }
}
