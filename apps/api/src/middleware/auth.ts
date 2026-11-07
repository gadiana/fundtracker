import type { RequestHandler } from 'express';
import { prisma } from '../db';
import { forbidden, unauthorized } from '../lib/http';
import { COOKIES, isIdleExpired, revokeSession, verifyAccessToken } from '../lib/session';
import { getSecurity } from '../lib/settings';

const TOUCH_INTERVAL_MS = 60_000;

/**
 * Requires a valid access token AND a live server-side session.
 * Requests marked `X-Background: 1` (polling) don't count as activity for the idle timeout.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.[COOKIES.access];
  if (!token) throw unauthorized('UNAUTHENTICATED', 'Please log in.');

  const check = verifyAccessToken(token);
  if (!check.ok) {
    throw check.expired
      ? unauthorized('TOKEN_EXPIRED', 'Your access token expired.')
      : unauthorized('UNAUTHENTICATED', 'Please log in.');
  }

  const session = await prisma.userSession.findUnique({
    where: { id: check.claims.sessionId },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.userId !== check.claims.userId || session.expiresAt < new Date()) {
    throw unauthorized('SESSION_ENDED', 'Your session has ended. Please log in again.');
  }

  const { sessionTimeoutMinutes } = await getSecurity();
  if (isIdleExpired(session.lastSeenAt, sessionTimeoutMinutes)) {
    await revokeSession(session.id);
    throw unauthorized('SESSION_TIMEOUT', 'You were logged out after a period of inactivity.');
  }
  if (session.user.status !== 'active') throw forbidden('This account has been deactivated.', 'ACCOUNT_DEACTIVATED');

  const isBackground = req.get('x-background') === '1';
  if (!isBackground && Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.userSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }

  req.user = session.user;
  req.sessionId = session.id;
  next();
};
