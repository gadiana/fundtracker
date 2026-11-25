import type { RequestHandler } from 'express';
import { prisma } from '../db';
import { forbidden, unauthorized } from '../lib/http';
import { TOUCH_INTERVAL_MS, touchVisit } from '../lib/presence';
import { COOKIES, verifyAccessToken } from '../lib/session';

/**
 * Requires a valid access token AND a live server-side session. There is no idle timeout:
 * a session lasts until logout, or until it goes unused for REFRESH_TOKEN_TTL_DAYS. Every request
 * also records that the person is in the system (see lib/presence.ts).
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
  if (session.user.status !== 'active') throw forbidden('This account has been deactivated.', 'ACCOUNT_DEACTIVATED');

  const now = new Date();
  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.userSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    await touchVisit(session.userId, session.id, now);
  }

  req.user = session.user;
  req.sessionId = session.id;
  next();
};
