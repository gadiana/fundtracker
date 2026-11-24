import type { AuditLog, Prisma } from '@prisma/client';
import { formatPersonName } from '@sft/shared';
import { prisma } from '../../db';

/**
 * The adviser's activity log: only student and staff records, each entry as a plain sentence
 * ("Changed Juan Dela Cruz: section A → B"). No ids, IP addresses or raw data: the full audit
 * log is the superadmin's.
 */
export const ACTIVITY_WHERE = (academicYearId: string, kind?: 'student' | 'staff'): Prisma.AuditLogWhereInput => ({
  academicYearId,
  OR: [
    ...(kind !== 'staff' ? [{ entityType: { in: ['student', 'student_import', 'enrollment_link'] } }] : []),
    ...(kind !== 'student' ? [{ entityType: 'user_ay_role' }, { entityType: 'user', action: 'signup' }] : []),
  ],
});

type Data = Record<string, unknown> | null;
const obj = (v: Prisma.JsonValue | null): Data => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown) => (v === null || v === undefined || v === '' ? '(none)' : String(v));

const STUDENT_FIELDS: Record<string, string> = {
  studentNumber: 'Student number',
  name: 'Name',
  program: 'Program',
  yearLevel: 'Year level',
  section: 'Section',
  email: 'Email',
  contactNo: 'Contact number',
  status: 'Status',
};

/** "Section: A → B" for every field that changed. */
function changes(before: Data, after: Data, labels: Record<string, string>) {
  if (!before || !after) return [];
  return Object.entries(labels)
    .filter(([k]) => k in after && String(before[k] ?? '') !== String(after[k] ?? ''))
    .map(([k, label]) => `${label}: ${text(before[k])} → ${text(after[k])}`);
}

export interface ActivityEntry {
  id: string;
  createdAt: Date;
  actorName: string;
  actorDesignation: string | null;
  kind: 'student' | 'staff';
  summary: string;
  details: string[];
}

/** Names the log rows themselves don't carry (staff memberships, a student's QR change). */
async function namesFor(rows: AuditLog[]) {
  const memberIds = rows.filter((r) => r.entityType === 'user_ay_role' && r.entityId).map((r) => r.entityId!);
  const studentIds = rows.filter((r) => r.entityType === 'student' && r.entityId).map((r) => r.entityId!);
  const [members, students] = await Promise.all([
    memberIds.length ? prisma.userAyRole.findMany({ where: { id: { in: memberIds } }, include: { user: true } }) : [],
    studentIds.length ? prisma.student.findMany({ where: { id: { in: studentIds } } }) : [],
  ]);
  return new Map<string, string>([
    ...members.map((m) => [m.id, formatPersonName(m.user)] as [string, string]),
    ...students.map((s) => [s.id, formatPersonName(s)] as [string, string]),
  ]);
}

export async function describeActivity(rows: AuditLog[]): Promise<ActivityEntry[]> {
  const names = await namesFor(rows);
  return rows.map((r) => {
    const before = obj(r.beforeData);
    const after = obj(r.afterData);
    const who = String(after?.name ?? before?.name ?? (r.entityId && names.get(r.entityId)) ?? 'a student');
    const base = { id: r.id.toString(), createdAt: r.createdAt, actorName: r.actorName, actorDesignation: r.actorDesignation };
    const student = (summary: string, details: string[] = []): ActivityEntry => ({ ...base, kind: 'student', summary, details });
    const staff = (summary: string, details: string[] = []): ActivityEntry => ({ ...base, kind: 'staff', summary, details });

    if (r.entityType === 'student') {
      const placement = after ? `${after.program ?? ''} ${after.yearLevel ?? ''}${after.section ? `-${after.section}` : ''}`.trim() : '';
      switch (r.action) {
        case 'create':
          return after?.source === 'self_enroll'
            ? student(`${who} enrolled through the link "${text(after.link)}"`, ['Waiting for approval'])
            : student(`Added student ${who}`, [after?.studentNumber ? `Student number ${after.studentNumber}` : '', placement].filter(Boolean));
        case 'update':
          if (before && 'qr' in before) return student(`Issued a new status QR code for ${names.get(r.entityId ?? '') ?? 'a student'}`);
          return student(`Edited student ${who}`, changes(before, after, STUDENT_FIELDS));
        case 'approve':
          return student(`Approved student ${who}`);
        case 'reject':
          return student(`Rejected student ${who}`, after?.comment ? [`Comment: ${after.comment}`] : []);
        case 'deactivate':
          return student(`Made student ${who} inactive`, after?.reason ? [`Reason: ${after.reason}`] : []);
        case 'reactivate':
          return student(`Made student ${who} active again`);
        default:
          return student(`Changed student ${who}`);
      }
    }
    if (r.entityType === 'student_import') {
      const n = Number(after?.imported ?? 0);
      return student(`Imported ${n} student${n === 1 ? '' : 's'} from a CSV file`);
    }
    if (r.entityType === 'enrollment_link') {
      return r.action === 'create' ? student(`Created the enrollment link "${text(after?.label)}"`) : student('Turned off an enrollment link');
    }
    if (r.entityType === 'user') return staff(`${r.actorName} signed up`, ['Waiting for an adviser to approve']);

    // staff (memberships)
    const member = (r.entityId && names.get(r.entityId)) || 'a staff member';
    const position = (d: Data) => (d?.role === 'adviser' ? 'Adviser' : text(d?.designation));
    switch (r.action) {
      case 'create':
        return staff(`Added ${member} as ${position(after)}`);
      case 'approve':
        return staff(`Approved ${member} as ${position(after)}`);
      case 'reject':
        return staff(`Rejected ${member}'s request to join`);
      case 'update':
        return staff(`Changed ${member}'s position`, [`${position(before)} → ${position(after)}`]);
      case 'deactivate':
        return staff(`Deactivated ${member}`);
      case 'reactivate':
        return staff(`Reactivated ${member}`);
      case 'delete':
        return staff(`Removed ${member}'s account request`);
      case 'request_access':
        return staff(`${r.actorName} asked to join this academic year`);
      default:
        return staff(`Changed ${member}'s access`);
    }
  });
}
