import type { Prisma, User } from '@prisma/client';
import { formatPersonName } from '@sft/shared';
import { prisma } from '../../db';
import type { MembershipWithDesignation } from '../../lib/audit';
import { sendEvent } from '../../lib/events';
import { findActiveAdviser } from '../../lib/notify';

export const FIRST_ADVISER_NOTE = 'System (first account in this academic year)';

/**
 * Adds a user to an academic year. The first person to join an AY that has no active
 * adviser becomes its adviser; everyone else waits as "pending" for the adviser.
 * The AY row is locked so two simultaneous signups can't both become adviser
 * (the ux_one_active_adviser index is the database-level backstop).
 */
export async function joinAcademicYear(tx: Prisma.TransactionClient, userId: string, academicYearId: string) {
  await tx.$queryRaw`SELECT id FROM academic_years WHERE id = ${academicYearId}::uuid FOR UPDATE`;

  const adviser = await tx.userAyRole.findFirst({
    where: { academicYearId, role: 'adviser', status: 'active' },
    select: { id: true },
  });
  const now = new Date();
  const data = adviser
    ? {
        role: null,
        designationId: null,
        status: 'pending' as const,
        requestedAt: now,
        decidedAt: null,
        decidedById: null,
        decidedByName: null,
        decisionNote: null,
      }
    : {
        role: 'adviser' as const,
        designationId: null,
        status: 'active' as const,
        requestedAt: now,
        decidedAt: now,
        decidedById: null,
        decidedByName: FIRST_ADVISER_NOTE,
        decisionNote: null,
      };

  const existing = await tx.userAyRole.findUnique({
    where: { academicYearId_userId: { academicYearId, userId } },
  });
  if (existing) return tx.userAyRole.update({ where: { id: existing.id }, data });
  return tx.userAyRole.create({ data: { academicYearId, userId, ...data } });
}

/** Tells the AY's adviser (in-app + email) that someone is waiting for approval. */
export async function notifyAdviserOfPending(academicYearId: string, applicant: User, membershipId: string) {
  const adviser = await findActiveAdviser(academicYearId);
  if (!adviser) return;
  await sendEvent('membership.pending', {
    ayId: academicYearId,
    to: [{ userId: adviser.userId, email: adviser.user.email, name: formatPersonName(adviser.user) }],
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
