import { Router, type Request } from 'express';
import type { User } from '@prisma/client';
import { formatPersonName, twoFactorCodeSchema, twoFactorPasswordSchema } from '@sft/shared';
import { z } from 'zod';
import { prisma } from '../../db';
import { writeAudit } from '../../lib/audit';
import { verifyPassword } from '../../lib/crypto';
import { badRequest, conflict, forbidden } from '../../lib/http';
import { getCurrentAy } from '../../lib/settings';
import { decryptSecret, encryptSecret, newRecoveryCodes, newTotpSecret, otpauthUrl, useRecoveryCode, verifyTotp } from '../../lib/totp';
import { loginLimiter } from '../../middleware/rate-limit';

/** Profile → Two-factor sign-in. Mounted under /api/me (signed in, not AY-scoped). */
export const twoFactorRouter = Router();

const passwordOnly = z.object({ password: z.string().min(1, 'Enter your password').max(200) });

async function requirePassword(user: User, password: string) {
  if (!(await verifyPassword(user.passwordHash, password))) throw badRequest('WRONG_PASSWORD', 'That password is not right.');
}

/** A code from the app (not reused) or an unused recovery code. Returns what to store when it's accepted. */
function checkCode(user: User, code: string) {
  const step = verifyTotp(decryptSecret(user.totpSecretEnc!), code, user.totpLastStep === null ? null : Number(user.totpLastStep));
  if (step !== null) return { totpLastStep: BigInt(step) };
  const left = useRecoveryCode(user.totpRecoveryHashes as string[], code);
  if (left) return { totpRecoveryHashes: left };
  throw badRequest('INVALID_CODE', 'That code is not right. Use the newest code from your authenticator app.');
}

async function audit(req: Request, user: User, action: 'update', after: Record<string, unknown>) {
  const ay = await getCurrentAy();
  await writeAudit(prisma, { ayId: ay?.id, actor: { id: user.id, name: formatPersonName(user) }, action, entityType: 'two_factor', entityId: user.id, after, req });
}

/** Academic years whose membership requires two-factor, so it can't be turned off. */
async function requiredBy(userId: string) {
  const rows = await prisma.userAyRole.findMany({
    where: { userId, status: { in: ['active', 'pending'] }, academicYear: { settings: { twofaMode: 'required' } } },
    include: { academicYear: true },
  });
  return rows.map((r) => r.academicYear.label);
}

twoFactorRouter.get('/two-factor', async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  res.json({
    enabled: user.totpEnabled,
    enabledAt: user.totpEnabledAt,
    recoveryCodesLeft: (user.totpRecoveryHashes as string[]).length,
    requiredBy: await requiredBy(user.id),
  });
});

/** Step 1: a new secret to scan. Nothing changes until it's confirmed with a code. */
twoFactorRouter.post('/two-factor/setup', loginLimiter, async (req, res) => {
  const { password } = passwordOnly.parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (user.totpEnabled) throw conflict('ALREADY_ENABLED', 'Two-factor sign-in is already on.');
  await requirePassword(user, password);
  const secret = newTotpSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpPendingSecretEnc: encryptSecret(secret) } });
  const ay = await getCurrentAy();
  const issuer = (ay && (await prisma.aySetting.findUnique({ where: { academicYearId: ay.id } }))?.orgName) || 'Fund Tracker';
  res.json({ secret, otpauthUrl: otpauthUrl(secret, user.email, issuer) });
});

/** Step 2: the first code proves the app has the secret; recovery codes are shown once. */
twoFactorRouter.post('/two-factor/enable', loginLimiter, async (req, res) => {
  const { code } = twoFactorCodeSchema.parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (user.totpEnabled) throw conflict('ALREADY_ENABLED', 'Two-factor sign-in is already on.');
  if (!user.totpPendingSecretEnc) throw badRequest('NO_SETUP', 'Start the setup again.');
  const secret = decryptSecret(user.totpPendingSecretEnc);
  const step = verifyTotp(secret, code, null);
  if (step === null) throw badRequest('INVALID_CODE', 'That code is not right. Check the time on your phone and use the newest code.');
  const recovery = newRecoveryCodes();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpSecretEnc: encryptSecret(secret),
      totpPendingSecretEnc: null,
      totpEnabled: true,
      totpEnabledAt: new Date(),
      totpLastStep: BigInt(step),
      totpRecoveryHashes: recovery.hashes,
    },
  });
  await audit(req, user, 'update', { twoFactor: 'enabled' });
  res.json({ enabled: true, recoveryCodes: recovery.codes });
});

/** Turning it off needs the password and a code, and isn't allowed where an AY requires it. */
twoFactorRouter.post('/two-factor/disable', loginLimiter, async (req, res) => {
  const { password, code } = twoFactorPasswordSchema.parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!user.totpEnabled) throw conflict('NOT_ENABLED', 'Two-factor sign-in is not on.');
  const required = await requiredBy(user.id);
  if (required.length) throw forbidden(`AY ${required.join(', ')} requires two-factor sign-in, so it can't be turned off.`, 'TWO_FACTOR_REQUIRED');
  await requirePassword(user, password);
  checkCode(user, code);
  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabled: false, totpSecretEnc: null, totpPendingSecretEnc: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryHashes: [] },
  });
  await audit(req, user, 'update', { twoFactor: 'disabled' });
  res.json({ enabled: false });
});

/** New recovery codes; the old ones stop working. */
twoFactorRouter.post('/two-factor/recovery-codes', loginLimiter, async (req, res) => {
  const { password, code } = twoFactorPasswordSchema.parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!user.totpEnabled) throw conflict('NOT_ENABLED', 'Two-factor sign-in is not on.');
  await requirePassword(user, password);
  const accepted = checkCode(user, code);
  const recovery = newRecoveryCodes();
  await prisma.user.update({ where: { id: user.id }, data: { ...accepted, totpRecoveryHashes: recovery.hashes } });
  await audit(req, user, 'update', { twoFactor: 'new recovery codes' });
  res.json({ recoveryCodes: recovery.codes });
});
