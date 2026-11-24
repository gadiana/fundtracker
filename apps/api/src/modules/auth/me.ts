import { formatPersonName, permissionsFor } from '@sft/shared';
import { avatarUrl } from '../../lib/avatar';
import { prisma } from '../../db';
import { logoUrl } from '../settings/service';

/** Everything the web app needs after login: the user, every AY, and their access in each. */
export async function buildMe(userId: string) {
  const [user, memberships, academicYears, advisers] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.userAyRole.findMany({ where: { userId }, include: { designation: true } }),
    prisma.academicYear.findMany({
      orderBy: { startYear: 'desc' },
      include: { settings: { select: { orgName: true, orgAbbr: true, logoFileId: true, twofaMode: true } } },
    }),
    prisma.userAyRole.findMany({ where: { role: 'adviser', status: 'active' }, select: { academicYearId: true } }),
  ]);
  const withAdviser = new Set(advisers.map((a) => a.academicYearId));
  const byAy = new Map(memberships.map((m) => [m.academicYearId, m]));

  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      suffix: user.suffix,
      contactNo: user.contactNo,
      name: formatPersonName(user),
      emailVerified: Boolean(user.emailVerifiedAt),
      twoFactorEnabled: user.totpEnabled,
      avatarUrl: avatarUrl(user),
    },
    currentAyId: academicYears.find((ay) => ay.isCurrent)?.id ?? null,
    academicYears: academicYears.map((ay) => {
      const m = byAy.get(ay.id);
      return {
        id: ay.id,
        label: ay.label,
        status: ay.status,
        isCurrent: ay.isCurrent,
        orgName: ay.settings?.orgName ?? '',
        orgAbbr: ay.settings?.orgAbbr ?? '',
        logoUrl: ay.settings?.logoFileId ? logoUrl(ay.id, 'org', ay.settings.logoFileId) : null,
        /** No settings yet: the setup wizard (Copy Wizard) has not run. */
        needsSetup: !ay.settings,
        /** off | optional | required: when required and the user has no two-factor yet, the app asks them to set it up */
        twoFactorMode: ay.settings?.twofaMode ?? 'off',
        hasAdviser: withAdviser.has(ay.id),
        membership: m
          ? {
              id: m.id,
              role: m.role,
              status: m.status,
              position: m.role === 'adviser' ? 'Adviser' : (m.designation?.name ?? null),
              permissions: permissionsFor(m),
            }
          : null,
      };
    }),
  };
}
