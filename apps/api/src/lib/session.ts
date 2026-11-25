import type { CookieOptions, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config, cookieSecure } from '../config';
import { prisma } from '../db';
import { randomToken, sha256 } from './crypto';
import { endVisits, startVisit } from './presence';

export const COOKIES = {
  access: 'sft_at',
  refresh: 'sft_rt',
  csrf: 'sft_csrf',
} as const;

const REFRESH_PATH = '/api/auth';

const baseCookie: CookieOptions = { httpOnly: true, sameSite: 'lax', secure: cookieSecure };

interface AccessClaims {
  userId: string;
  sessionId: string;
}

export function signAccessToken({ userId, sessionId }: AccessClaims) {
  return jwt.sign({ sid: sessionId }, config.JWT_SECRET, {
    subject: userId,
    issuer: 'sft',
    expiresIn: `${config.ACCESS_TOKEN_TTL_MIN}m`,
  });
}

export type AccessCheck = { ok: true; claims: AccessClaims } | { ok: false; expired: boolean };

export function verifyAccessToken(token: string): AccessCheck {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { issuer: 'sft' }) as jwt.JwtPayload;
    if (!payload.sub || typeof payload.sid !== 'string') return { ok: false, expired: false };
    return { ok: true, claims: { userId: payload.sub, sessionId: payload.sid } };
  } catch (err) {
    return { ok: false, expired: err instanceof jwt.TokenExpiredError };
  }
}

/** How long a session lasts without being used; every refresh starts the count again. */
const sessionTtlMs = () => config.REFRESH_TOKEN_TTL_DAYS * 86_400_000;

/**
 * The access cookie outlives its token on purpose: the browser keeps sending it, so the server
 * answers TOKEN_EXPIRED and the app refreshes quietly instead of treating the person as signed out.
 */
function setAccessCookie(res: Response, claims: AccessClaims) {
  res.cookie(COOKIES.access, signAccessToken(claims), { ...baseCookie, path: '/', maxAge: sessionTtlMs() });
}

function setAuthCookies(res: Response, claims: AccessClaims, refreshToken: string) {
  setAccessCookie(res, claims);
  res.cookie(COOKIES.refresh, refreshToken, { ...baseCookie, path: REFRESH_PATH, maxAge: sessionTtlMs() });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(COOKIES.access, { ...baseCookie, path: '/' });
  res.clearCookie(COOKIES.refresh, { ...baseCookie, path: REFRESH_PATH });
}

/** Starts a server-side session (revocable) and sets the httpOnly cookies. */
export async function startSession(req: Request, res: Response, userId: string) {
  const refreshToken = randomToken();
  const session = await prisma.userSession.create({
    data: {
      userId,
      refreshTokenHash: sha256(refreshToken),
      userAgent: req.get('user-agent')?.slice(0, 500) ?? null,
      ipAddress: req.ip ?? null,
      expiresAt: new Date(Date.now() + sessionTtlMs()),
    },
  });
  setAuthCookies(res, { userId, sessionId: session.id }, refreshToken);
  await startVisit(userId, session.id, session.createdAt);
  return session;
}

/** A rotated-out refresh token still works this long, so two tabs refreshing at once both succeed. */
export const REFRESH_GRACE_MS = 30_000;

export type RefreshLookup =
  | { kind: 'current'; session: Awaited<ReturnType<typeof findSessionByRefresh>> & object }
  | { kind: 'grace'; session: Awaited<ReturnType<typeof findSessionByRefresh>> & object }
  | { kind: 'reused'; sessionId: string; userId: string }
  | { kind: 'unknown' };

const findSessionByRefresh = (hash: string) => prisma.userSession.findUnique({ where: { refreshTokenHash: hash }, include: { user: true } });

/**
 * Finds the session a refresh token belongs to. A token that was already replaced is accepted
 * for a few seconds (parallel requests); after that, seeing it again means someone copied it.
 */
export async function lookupRefreshToken(raw: string): Promise<RefreshLookup> {
  const hash = sha256(raw);
  const current = await findSessionByRefresh(hash);
  if (current) return { kind: 'current', session: current };
  const previous = await prisma.userSession.findUnique({ where: { previousRefreshTokenHash: hash }, include: { user: true } });
  if (!previous) return { kind: 'unknown' };
  if (previous.rotatedAt && Date.now() - previous.rotatedAt.getTime() < REFRESH_GRACE_MS) return { kind: 'grace', session: previous };
  return { kind: 'reused', sessionId: previous.id, userId: previous.userId };
}

/**
 * Replaces the session's refresh token (the old one becomes "previous") and sets the new cookie.
 * The session's end moves forward too, so someone who keeps using the system stays signed in.
 */
export async function rotateRefreshToken(res: Response, sessionId: string, oldRaw: string) {
  const next = randomToken();
  const done = await prisma.userSession.updateMany({
    where: { id: sessionId, refreshTokenHash: sha256(oldRaw), revokedAt: null },
    data: { previousRefreshTokenHash: sha256(oldRaw), refreshTokenHash: sha256(next), rotatedAt: new Date(), expiresAt: new Date(Date.now() + sessionTtlMs()) },
  });
  // another request rotated it a moment ago: keep that one
  if (done.count === 0) return false;
  res.cookie(COOKIES.refresh, next, { ...baseCookie, path: REFRESH_PATH, maxAge: sessionTtlMs() });
  return true;
}

/** Issues a fresh access token for an existing session. */
export function renewAccessCookie(res: Response, claims: AccessClaims) {
  setAccessCookie(res, claims);
}

export async function revokeSession(id: string) {
  const done = await prisma.userSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  await endVisits({ sessionId: id });
  return done;
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  const where = { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) };
  const ended = await prisma.userSession.findMany({ where, select: { id: true } });
  const done = await prisma.userSession.updateMany({ where, data: { revokedAt: new Date() } });
  await prisma.userVisit.updateMany({ where: { sessionId: { in: ended.map((s) => s.id) }, endedAt: null }, data: { endedAt: new Date() } });
  return done;
}
