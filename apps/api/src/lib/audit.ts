import type { Request } from 'express';
import type { Designation, Prisma, User, UserAyRole } from '@prisma/client';
import { formatPersonName } from '@sft/shared';

export interface Actor {
  id: string | null;
  name: string;
  role?: string | null;
  designation?: string | null;
}

export type MembershipWithDesignation = UserAyRole & { designation: Designation | null };

/** Snapshot of who is acting, taken at the moment of the action. */
export function actorFrom(user: User, membership?: MembershipWithDesignation | null): Actor {
  const active = membership?.status === 'active' ? membership : null;
  return {
    id: user.id,
    name: formatPersonName(user),
    role: active?.role ?? null,
    designation: active?.role === 'adviser' ? 'Adviser' : (active?.designation?.name ?? null),
  };
}

export const SYSTEM_ACTOR: Actor = { id: null, name: 'System' };

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'approve'
  | 'reject'
  | 'void'
  | 'cancel'
  | 'archive'
  | 'unarchive'
  | 'deactivate'
  | 'reactivate'
  | 'settings_change'
  | 'signup'
  | 'request_access'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'verify_email'
  | 'password_reset'
  | 'password_change';

interface AuditEntry {
  ayId?: string | null;
  actor: Actor;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  req?: Request;
}

/** Anything with an auditLog delegate: the base client, a scoped client, or a transaction. */
interface AuditClient {
  auditLog: { create(args: { data: Prisma.AuditLogUncheckedCreateInput }): PromiseLike<unknown> };
}

const SENSITIVE_KEY = /password|token|secret|hash/i;

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[redacted]' : sanitize(v)]),
    );
  }
  return value;
}

const toJson = (value: unknown) =>
  value === undefined ? undefined : (sanitize(value) as Prisma.InputJsonValue);

export async function writeAudit(db: AuditClient, entry: AuditEntry) {
  await db.auditLog.create({
    data: {
      academicYearId: entry.ayId ?? null,
      actorUserId: entry.actor.id,
      actorName: entry.actor.name,
      actorRole: entry.actor.role ?? null,
      actorDesignation: entry.actor.designation ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      beforeData: toJson(entry.before),
      afterData: toJson(entry.after),
      ipAddress: entry.req?.ip ?? null,
      userAgent: entry.req?.get('user-agent')?.slice(0, 500) ?? null,
    },
  });
}
