import { Router } from 'express';
import { changePasswordSchema, formatPersonName, passwordIssues, profileSchema } from '@sft/shared';
import { prisma } from '../../db';
import { writeAudit } from '../../lib/audit';
import { hashPassword, verifyPassword } from '../../lib/crypto';
import { badRequest } from '../../lib/http';
import { revokeAllSessions } from '../../lib/session';
import { getCurrentAy, getSecurity } from '../../lib/settings';
import { requireAuth } from '../../middleware/auth';
import { buildMe } from '../auth/me';
import { twoFactorRouter } from './two-factor';

/** The signed-in user's own account (not AY-scoped). */
export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.patch('/profile', async (req, res) => {
  const body = profileSchema.parse(req.body);
  const before = req.user!;
  const user = await prisma.user.update({
    where: { id: before.id },
    data: {
      firstName: body.firstName,
      middleName: body.middleName ?? null,
      lastName: body.lastName,
      suffix: body.suffix ?? null,
      contactNo: body.contactNo ?? null,
    },
  });
  const ay = await getCurrentAy();
  await writeAudit(prisma, {
    ayId: ay?.id,
    actor: { id: user.id, name: formatPersonName(user) },
    action: 'update',
    entityType: 'user',
    entityId: user.id,
    before: { name: formatPersonName(before), contactNo: before.contactNo },
    after: { name: formatPersonName(user), contactNo: user.contactNo },
    req,
  });
  res.json(await buildMe(user.id));
});

profileRouter.post('/password', async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const user = req.user!;
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw badRequest('WRONG_PASSWORD', 'Your current password is incorrect.');
  }
  const { passwordPolicy } = await getSecurity();
  const issues = passwordIssues(newPassword, passwordPolicy);
  if (issues.length) throw badRequest('WEAK_PASSWORD', 'Your new password does not meet the requirements.', { issues });

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } });
  // sign out every other device; this one stays signed in
  await revokeAllSessions(user.id, req.sessionId);

  const ay = await getCurrentAy();
  await writeAudit(prisma, {
    ayId: ay?.id,
    actor: { id: user.id, name: formatPersonName(user) },
    action: 'password_change',
    entityType: 'user',
    entityId: user.id,
    req,
  });
  res.json({ ok: true });
});

// Profile → Two-factor sign-in
profileRouter.use(twoFactorRouter);
