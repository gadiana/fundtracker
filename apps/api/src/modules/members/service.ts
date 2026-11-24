import type { Designation, Prisma, User } from '@prisma/client';
import { formatPersonName } from '@sft/shared';
import { prisma } from '../../db';
import { conflict } from '../../lib/http';
import type { MembershipWithDesignation } from '../../lib/audit';
import { avatarUrl } from '../../lib/avatar';
import { sendEvent } from '../../lib/events';
import { findActiveAdvisers } from '../../lib/notify';

/**
 * Adds a user to an academic year as "pending", to wait for an adviser's approval. Nobody
 * becomes adviser by signing up: advisers are added by the superadmin.
 */
export async function joinAcademicYear(tx: Prisma.TransactionClient, userId: string, academicYearId: string) {
  const data = {
    role: null,
    designationId: null,
    status: 'pending' as const,
    requestedAt: new Date(),
    decidedAt: null,
    decidedById: null,
    decidedByName: null,
    decisionNote: null,
  };

  const existing = await tx.userAyRole.findUnique({
    where: { academicYearId_userId: { academicYearId, userId } },
  });
  if (existing) return tx.userAyRole.update({ where: { id: existing.id }, data });
  return tx.userAyRole.create({ data: { academicYearId, userId, ...data } });
}

/** Tells the AY's advisers (in-app + email) that someone is waiting for approval. */
export async function notifyAdviserOfPending(academicYearId: string, applicant: User, membershipId: string) {
  const advisers = await findActiveAdvisers(academicYearId);
  if (!advisers.length) return;
  await sendEvent('membership.pending', {
    ayId: academicYearId,
    to: advisers.map((a) => ({ userId: a.userId, email: a.user.email, name: formatPersonName(a.user) })),
    vars: { applicantName: formatPersonName(applicant), applicantEmail: applicant.email },
    linkPath: '/users?tab=pending',
    entityType: 'user_ay_role',
    entityId: membershipId,
  });
}

export function serializeMember(m: MembershipWithDesignation & { user: User }, viewerId?: string) {
  return {
    id: m.id,
    status: m.status,
    role: m.role,
    designation: m.designation ? { id: m.designation.id, name: m.designation.name } : null,
    position: m.role === 'adviser' ? 'Adviser' : (m.designation?.name ?? null),
    requestedAt: m.requestedAt,
    decidedAt: m.decidedAt,
    decidedByName: m.decidedByName,
    decisionNote: m.decisionNote,
    deactivatedAt: m.deactivatedAt,
    deactivatedByName: m.deactivatedByName,
    isSelf: m.userId === viewerId,
    user: {
      id: m.user.id,
      name: formatPersonName(m.user),
      email: m.user.email,
      contactNo: m.user.contactNo,
      emailVerified: Boolean(m.user.emailVerifiedAt),
      avatarUrl: avatarUrl(m.user),
    },
  };
}

/** Audit-friendly snapshot of a membership row. */
export const membershipSnapshot = (m: MembershipWithDesignation) => ({
  status: m.status,
  role: m.role,
  designation: m.designation?.name ?? null,
  decidedByName: m.decidedByName,
  decisionNote: m.decisionNote,
});

/**
 * Refuses to give a position to one more person when it already has as many members as its
 * limit allows (President and Vice President: one). Locks the position row first, so two
 * approvals at the same moment can't both take the last place.
 */
/** Any client that can lock a row and count memberships (the AY-scoped one included). */
type SeatDb = {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  userAyRole: { count: (args: { where: Prisma.UserAyRoleWhereInput }) => Promise<number> };
};

export async function ensureSeat(tx: SeatDb, designation: Designation, exceptMembershipId?: string) {
  if (designation.maxMembers === null) return;
  await tx.$queryRaw`SELECT id FROM designations WHERE id = ${designation.id}::uuid FOR UPDATE`;
  const holders = await tx.userAyRole.count({
    where: { designationId: designation.id, status: 'active', ...(exceptMembershipId ? { id: { not: exceptMembershipId } } : {}) },
  });
  if (holders >= designation.maxMembers) {
    throw conflict(
      'POSITION_FULL',
      `${designation.name} already has ${holders} member${holders === 1 ? '' : 's'}, the most it allows. Move someone to another position first${designation.seatsLocked ? '' : ', or raise the limit in Settings → Positions'}.`,
    );
  }
}
