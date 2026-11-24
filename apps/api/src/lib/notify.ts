import { formatPersonName } from '@sft/shared';
import { prisma } from '../db';

interface NotificationInput {
  ayId?: string | null;
  type: string;
  title: string;
  body?: string;
  linkPath?: string;
  entityType?: string;
  entityId?: string;
}

/** In-app notices. Events go through sendEvent (lib/events.ts), which applies the AY's choices. */
export async function notify(userIds: string[], n: NotificationInput) {
  if (userIds.length === 0) return;
  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      academicYearId: n.ayId ?? null,
      type: n.type,
      title: n.title,
      body: n.body ?? null,
      linkPath: n.linkPath ?? null,
      entityType: n.entityType ?? null,
      entityId: n.entityId ?? null,
    })),
  });
}

/** The adviser plus everyone whose position may collect (they handle student records). */
export async function collectorRecipients(academicYearId: string) {
  const rows = await prisma.userAyRole.findMany({
    where: {
      academicYearId,
      status: 'active',
      OR: [{ role: 'adviser' }, { designation: { canCollect: true, isActive: true } }],
    },
    include: { user: true },
  });
  return rows.map((r) => ({ userId: r.userId, email: r.user.email, name: formatPersonName(r.user) }));
}

/** An academic year can have more than one adviser (the superadmin adds them). */
export const findActiveAdvisers = (academicYearId: string) =>
  prisma.userAyRole.findMany({
    where: { academicYearId, role: 'adviser', status: 'active' },
    include: { user: true },
    orderBy: { decidedAt: 'asc' },
  });
