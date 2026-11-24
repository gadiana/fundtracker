import type { Request, RequestHandler } from 'express';
import type { AcademicYear } from '@prisma/client';
import { permissionsFor, type Permission } from '@sft/shared';
import { forAy, prisma, type ScopedDb } from '../db';
import { actorFrom, type Actor, type MembershipWithDesignation } from '../lib/audit';
import { badRequest, conflict, forbidden, HttpError, unauthorized } from '../lib/http';
import { getCurrentAy, twoFactorModeFor } from '../lib/settings';

export interface AyContext {
  ay: AcademicYear;
  membership: MembershipWithDesignation | null;
  perms: Permission[];
  /** Prisma client that only sees this AY's rows. */
  db: ScopedDb;
  actor: Actor;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the academic year the request works in (X-AY-Id header, else the current AY)
 * and the user's membership in it. Every AY-scoped route sits behind this.
 */
export const ayContext: RequestHandler = async (req, _res, next) => {
  if (!req.user) throw unauthorized('UNAUTHENTICATED', 'Please log in.');

  const requested = req.get('x-ay-id');
  let ay: AcademicYear | null;
  if (requested) {
    if (!UUID_RE.test(requested)) throw badRequest('BAD_AY', 'Invalid academic year.');
    ay = await prisma.academicYear.findUnique({ where: { id: requested } });
  } else {
    ay = await getCurrentAy();
  }
  if (!ay) throw new HttpError(404, 'AY_NOT_FOUND', 'Academic year not found.');

  const membership = await prisma.userAyRole.findUnique({
    where: { academicYearId_userId: { academicYearId: ay.id, userId: req.user.id } },
    include: { designation: true },
  });
  // an AY that requires two-factor sign-in is closed to members who haven't set it up (Profile does that)
  if (membership && !req.user.totpEnabled && (await twoFactorModeFor(ay.id)) === 'required') {
    throw forbidden(`AY ${ay.label} requires two-factor sign-in. Set it up in your profile to continue.`, 'TWO_FACTOR_SETUP_REQUIRED');
  }

  req.ctx = {
    ay,
    membership,
    perms: permissionsFor(membership),
    db: forAy(ay.id),
    actor: actorFrom(req.user, membership),
  };
  next();
};

export function ctxOf(req: Request): AyContext {
  if (!req.ctx) throw new Error('ayContext middleware is missing on this route');
  return req.ctx;
}

/** Active member of the selected AY. */
export const requireMember: RequestHandler = (req, _res, next) => {
  const { membership } = ctxOf(req);
  if (membership?.status !== 'active') {
    throw forbidden('You do not have access to this academic year.', 'NO_AY_ACCESS');
  }
  next();
};

export const requirePermission =
  (permission: Permission): RequestHandler =>
  (req, _res, next) => {
    if (!ctxOf(req).perms.includes(permission)) throw forbidden();
    next();
  };

export const requireAdviser = requirePermission('manage');

/** A closed AY is read-only: put this on every mutating AY-scoped route. */
export const requireOpenAy: RequestHandler = (req, _res, next) => {
  const { ay } = ctxOf(req);
  if (ay.status === 'closed') {
    throw conflict('AY_CLOSED', `AY ${ay.label} is closed and read-only.`);
  }
  next();
};
