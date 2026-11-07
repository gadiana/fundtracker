import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import type { User, UserTokenType } from '@prisma/client';
import {
  emailOnlySchema,
  formatPersonName,
  loginSchema,
  loginTwoFactorSchema,
  passwordIssues,
  resetPasswordSchema,
  signupSchema,
  tokenSchema,
} from '@sft/shared';
import { config } from '../../config';
import { prisma } from '../../db';
import { writeAudit } from '../../lib/audit';
import { hashPassword, randomToken, sha256, verifyDummyPassword, verifyPassword } from '../../lib/crypto';
import { sendEvent } from '../../lib/events';
import { decryptSecret, useRecoveryCode, verifyTotp } from '../../lib/totp';
import { badRequest, conflict, forbidden, HttpError, unauthorized } from '../../lib/http';
import {
  clearAuthCookies,
  COOKIES,
  isIdleExpired,
  lookupRefreshToken,
  renewAccessCookie,
  revokeAllSessions,
  rotateRefreshToken,
  revokeSession,
  startSession,
} from '../../lib/session';
import { getCurrentAy, getSecurity, getSettings, passwordPolicyFrom } from '../../lib/settings';
import { requireAuth } from '../../middleware/auth';
import { emailLimiter, loginLimiter, signupLimiter } from '../../middleware/rate-limit';
import { joinAcademicYear, notifyAdviserOfPending } from '../members/service';
import { buildMe } from './me';

export const authRouter = Router();

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const VERIFY_TTL_MS = 24 * 60 * 60_000;
const RESET_TTL_MS = 60 * 60_000;

// ───────────── one-time email tokens ─────────────

async function issueUserToken(userId: string, type: UserTokenType, ttlMs: number) {
  // only the newest link of each type works
  await prisma.userToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
  const raw = randomToken();
  await prisma.userToken.create({
    data: { userId, type, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlMs) },
  });
  return raw;
}

async function consumeUserToken(raw: string, type: UserTokenType) {
  const invalid = badRequest('INVALID_TOKEN', 'This link is invalid or has expired.');
  const token = await prisma.userToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!token || token.type !== type || token.usedAt || token.expiresAt < new Date()) throw invalid;
  const claimed = await prisma.userToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count === 0) throw invalid;
  return token;
}

async function sendVerificationEmail(user: User, ayId: string | null) {
  const raw = await issueUserToken(user.id, 'email_verify', VERIFY_TTL_MS);
  await sendEvent('auth.verify_email', {
    ayId,
    to: [{ email: user.email, name: formatPersonName(user) }],
    vars: {},
    linkUrl: `${config.WEB_URL}/verify-email?token=${raw}`,
    entityType: 'user',
    entityId: user.id,
    sensitive: true,
  });
}

const userSnapshot = (u: User) => ({
  email: u.email,
  name: formatPersonName(u),
  contactNo: u.contactNo,
  status: u.status,
});

// ───────────── signup ─────────────

authRouter.post('/signup', signupLimiter, async (req, res) => {
  const body = signupSchema.parse(req.body);

  const ay = await getCurrentAy();
  if (!ay) {
    throw new HttpError(503, 'NOT_INITIALIZED', 'No current academic year is set up yet. Run the database seed first.');
  }
  if (ay.status === 'closed') throw conflict('AY_CLOSED', `AY ${ay.label} is closed. Signups are not accepted.`);

  const settings = await getSettings(ay.id);
  const issues = passwordIssues(body.password, passwordPolicyFrom(settings));
  if (issues.length) throw badRequest('WEAK_PASSWORD', 'Your password does not meet the requirements.', { issues });

  if (await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } })) {
    throw conflict('EMAIL_TAKEN', 'An account with this email already exists. Log in instead.');
  }

  const passwordHash = await hashPassword(body.password);
  const { user, membership } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: body.email,
        passwordHash,
        firstName: body.firstName,
        middleName: body.middleName ?? null,
        lastName: body.lastName,
        suffix: body.suffix ?? null,
        contactNo: body.contactNo ?? null,
        privacyConsentAt: new Date(),
        privacyConsentVersion: settings?.privacyConsentVersion ?? '1',
      },
    });
    const membership = await joinAcademicYear(tx, user.id, ay.id);
    await writeAudit(tx, {
      ayId: ay.id,
      actor: { id: user.id, name: formatPersonName(user) },
      action: 'signup',
      entityType: 'user',
      entityId: user.id,
      after: { ...userSnapshot(user), membership: { role: membership.role, status: membership.status } },
      req,
    });
    return { user, membership };
  });

  await sendVerificationEmail(user, ay.id);
  if (membership.status === 'pending') await notifyAdviserOfPending(ay.id, user, membership.id);

  res.status(201).json({
    academicYear: ay.label,
    role: membership.role,
    status: membership.status,
    email: user.email,
  });
});

// ───────────── email verification ─────────────

authRouter.post('/verify-email', emailLimiter, async (req, res) => {
  const { token } = tokenSchema.parse(req.body);
  const used = await consumeUserToken(token, 'email_verify');
  const user = await prisma.user.update({ where: { id: used.userId }, data: { emailVerifiedAt: new Date() } });
  const ay = await getCurrentAy();
  await writeAudit(prisma, {
    ayId: ay?.id,
    actor: { id: user.id, name: formatPersonName(user) },
    action: 'verify_email',
    entityType: 'user',
    entityId: user.id,
    req,
  });
  res.json({ ok: true });
});

authRouter.post('/resend-verification', emailLimiter, async (req, res) => {
  const { email } = emailOnlySchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.emailVerifiedAt && user.status === 'active') {
    const ay = await getCurrentAy();
    await sendVerificationEmail(user, ay?.id ?? null);
  }
  // same answer either way, so this can't be used to discover accounts
  res.json({ ok: true });
});

// ───────────── login / session ─────────────

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const invalid = unauthorized('INVALID_CREDENTIALS', 'Incorrect email or password.');
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await verifyDummyPassword(password);
    throw invalid;
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new HttpError(429, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${minutes} minute(s).`);
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    await recordFailedLogin(req, user, 'password');
    throw invalid;
  }

  if (user.status !== 'active') throw forbidden('This account has been deactivated.', 'ACCOUNT_DEACTIVATED');
  if (!user.emailVerifiedAt) {
    throw forbidden('Verify your email first. Check your inbox for the link.', 'EMAIL_NOT_VERIFIED');
  }

  // with two-factor on, the password alone opens nothing: the code comes next
  if (user.totpEnabled) {
    const challenge = jwt.sign({ purpose: '2fa' }, config.JWT_SECRET, { subject: user.id, issuer: TWO_FACTOR_ISSUER, expiresIn: '5m' });
    res.json({ twoFactorRequired: true, challenge });
    return;
  }
  await completeLogin(req, res, user, 'password');
});

const TWO_FACTOR_ISSUER = 'sft-2fa';

/** Wrong passwords and wrong codes count toward the same lockout. */
async function recordFailedLogin(req: Request, user: User, step: 'password' | 'two_factor') {
  const failures = user.failedLoginCount + 1;
  const lock = failures >= MAX_FAILED_LOGINS;
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: lock ? 0 : failures,
      lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
    },
  });
  const ay = await getCurrentAy();
  await writeAudit(prisma, {
    ayId: ay?.id,
    actor: { id: user.id, name: formatPersonName(user) },
    action: 'login_failed',
    entityType: 'user',
    entityId: user.id,
    after: { locked: lock, step },
    req,
  });
}

async function completeLogin(req: Request, res: Response, user: User, method: 'password' | 'authenticator' | 'recovery_code') {
  const ay = await getCurrentAy();
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await startSession(req, res, user.id);
  await writeAudit(prisma, {
    ayId: ay?.id,
    actor: { id: user.id, name: formatPersonName(user) },
    action: 'login',
    entityType: 'user',
    entityId: user.id,
    ...(method !== 'password' ? { after: { twoFactor: method } } : {}),
    req,
  });
  res.json(await buildMe(user.id));
}

/** Second step: the code from the authenticator app, or a one-time recovery code. */
authRouter.post('/login/2fa', loginLimiter, async (req, res) => {
  const { challenge, code } = loginTwoFactorSchema.parse(req.body);
  const expired = unauthorized('TWO_FACTOR_EXPIRED', 'That took too long. Enter your email and password again.');
  let userId: string;
  try {
    const claims = jwt.verify(challenge, config.JWT_SECRET, { issuer: TWO_FACTOR_ISSUER }) as jwt.JwtPayload;
    if (claims.purpose !== '2fa' || !claims.sub) throw expired;
    userId = claims.sub;
  } catch {
    throw expired;
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== 'active' || !user.totpEnabled || !user.totpSecretEnc) throw expired;
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new HttpError(429, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${minutes} minute(s).`);
  }

  const step = verifyTotp(decryptSecret(user.totpSecretEnc), code, user.totpLastStep === null ? null : Number(user.totpLastStep));
  if (step !== null) {
    // the step is claimed atomically, so the same code can't open two sessions
    const claimed = await prisma.user.updateMany({
      where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: BigInt(step) } }] },
      data: { totpLastStep: BigInt(step) },
    });
    if (claimed.count === 1) return completeLogin(req, res, user, 'authenticator');
  } else {
    const left = useRecoveryCode(user.totpRecoveryHashes as string[], code);
    if (left) {
      await prisma.user.update({ where: { id: user.id }, data: { totpRecoveryHashes: left } });
      return completeLogin(req, res, user, 'recovery_code');
    }
  }
  await recordFailedLogin(req, user, 'two_factor');
  throw unauthorized('INVALID_CODE', 'That code is not right. Codes change every 30 seconds; use the newest one.');
});

/** Uses the refresh cookie to issue a new access token for the same session. */
authRouter.post('/refresh', async (req, res) => {
  const raw = req.cookies?.[COOKIES.refresh];
  if (!raw) throw unauthorized('UNAUTHENTICATED', 'Please log in.');

  const found = await lookupRefreshToken(raw);
  const ended = () => {
    clearAuthCookies(res);
    return unauthorized('SESSION_ENDED', 'Your session has ended. Please log in again.');
  };
  if (found.kind === 'reused') {
    // an old token came back after it was replaced: someone has a copy, so end the session for everyone
    await revokeSession(found.sessionId);
    const user = await prisma.user.findUnique({ where: { id: found.userId } });
    if (user) {
      await writeAudit(prisma, {
        actor: { id: user.id, name: formatPersonName(user) },
        action: 'logout',
        entityType: 'user_session',
        entityId: found.sessionId,
        after: { reason: 'A replaced sign-in token was used again; the session was ended to be safe.' },
        req,
      });
    }
    throw ended();
  }
  if (found.kind === 'unknown') throw ended();
  const session = found.session;
  if (session.revokedAt || session.expiresAt < new Date()) throw ended();

  const { sessionTimeoutMinutes } = await getSecurity();
  if (isIdleExpired(session.lastSeenAt, sessionTimeoutMinutes)) {
    await revokeSession(session.id);
    clearAuthCookies(res);
    throw unauthorized('SESSION_TIMEOUT', 'You were logged out after a period of inactivity.');
  }
  if (session.user.status !== 'active') throw ended();

  if (found.kind === 'current') await rotateRefreshToken(res, session.id, raw);
  renewAccessCookie(res, { userId: session.userId, sessionId: session.id });
  res.json({ ok: true });
});

authRouter.post('/logout', async (req, res) => {
  const raw = req.cookies?.[COOKIES.refresh];
  if (raw) {
    const session = await prisma.userSession.findUnique({ where: { refreshTokenHash: sha256(raw) }, include: { user: true } });
    if (session && !session.revokedAt) {
      await revokeSession(session.id);
      const ay = await getCurrentAy();
      await writeAudit(prisma, {
        ayId: ay?.id,
        actor: { id: session.userId, name: formatPersonName(session.user) },
        action: 'logout',
        entityType: 'user',
        entityId: session.userId,
        req,
      });
    }
  }
  clearAuthCookies(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json(await buildMe(req.user!.id));
});

// ───────────── password reset ─────────────

authRouter.post('/forgot-password', emailLimiter, async (req, res) => {
  const { email } = emailOnlySchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.status === 'active') {
    const raw = await issueUserToken(user.id, 'password_reset', RESET_TTL_MS);
    const ay = await getCurrentAy();
    await sendEvent('auth.reset_password', {
      ayId: ay?.id ?? null,
      to: [{ email: user.email, name: formatPersonName(user) }],
      vars: {},
      linkUrl: `${config.WEB_URL}/reset-password?token=${raw}`,
      entityType: 'user',
      entityId: user.id,
      sensitive: true,
    });
  }
  res.json({ ok: true });
});

authRouter.post('/reset-password', emailLimiter, async (req, res) => {
  const { token, password } = resetPasswordSchema.parse(req.body);
  const { passwordPolicy } = await getSecurity();
  const issues = passwordIssues(password, passwordPolicy);
  if (issues.length) throw badRequest('WEAK_PASSWORD', 'Your password does not meet the requirements.', { issues });

  const used = await consumeUserToken(token, 'password_reset');
  const existing = await prisma.user.findUniqueOrThrow({ where: { id: used.userId } });
  const user = await prisma.user.update({
    where: { id: existing.id },
    data: {
      passwordHash: await hashPassword(password),
      failedLoginCount: 0,
      lockedUntil: null,
      // the reset link proved they own the mailbox
      emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
    },
  });
  await revokeAllSessions(user.id);

  const ay = await getCurrentAy();
  await writeAudit(prisma, {
    ayId: ay?.id,
    actor: { id: user.id, name: formatPersonName(user) },
    action: 'password_reset',
    entityType: 'user',
    entityId: user.id,
    req,
  });
  res.json({ ok: true });
});
