import { prisma } from '../db';

/**
 * Sign-in activity for the adviser's Sign-in activity page.
 *
 * Every signed-in request (at most once a minute per session) moves the session's current
 * visit forward. When nothing has come from a session for OFFLINE_AFTER_MS, the person is
 * offline and their next request starts a new visit. The web app checks notifications every
 * minute while it is open, so an open tab counts as being in the system.
 */
export const OFFLINE_AFTER_MS = 5 * 60_000;
export const TOUCH_INTERVAL_MS = 60_000;

export async function startVisit(userId: string, sessionId: string, at = new Date()) {
  await prisma.userVisit.create({ data: { userId, sessionId, startedAt: at, lastSeenAt: at } });
}

/**
 * Records that the session is in use now: extends the current visit, or starts a new one after a gap.
 * Two requests at the same moment can find a visit the other just started a few milliseconds
 * later, so the time only ever moves forward.
 */
export async function touchVisit(userId: string, sessionId: string, at = new Date()) {
  const current = await prisma.userVisit.findFirst({ where: { sessionId }, orderBy: { startedAt: 'desc' } });
  if (current && !current.endedAt && at.getTime() - current.lastSeenAt.getTime() <= OFFLINE_AFTER_MS) {
    const lastSeenAt = new Date(Math.max(at.getTime(), current.startedAt.getTime(), current.lastSeenAt.getTime()));
    await prisma.userVisit.update({ where: { id: current.id }, data: { lastSeenAt } });
  } else {
    await startVisit(userId, sessionId, at);
  }
}

/** Logging out (or a session being ended) closes its open visit. */
export async function endVisits(where: { sessionId?: string; userId?: string }, at = new Date()) {
  await prisma.userVisit.updateMany({ where: { ...where, endedAt: null }, data: { endedAt: at } });
}

/** When a visit ended: at logout, or at its last request once the person went quiet. Null while online. */
export function visitEnd(v: { lastSeenAt: Date; endedAt: Date | null }, now = Date.now()) {
  if (v.endedAt) return v.endedAt;
  return now - v.lastSeenAt.getTime() > OFFLINE_AFTER_MS ? v.lastSeenAt : null;
}

/** "Chrome on Windows", "Safari on iPhone"… from the browser's user agent. */
export function describeDevice(userAgent: string | null | undefined) {
  if (!userAgent) return 'Unknown device';
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null;
  const system = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /CrOS/.test(ua)
              ? 'Chromebook'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;
  if (!browser && !system) return 'Unknown device';
  return [browser ?? 'Browser', system && `on ${system}`].filter(Boolean).join(' ');
}
