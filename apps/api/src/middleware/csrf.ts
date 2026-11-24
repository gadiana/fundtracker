import type { RequestHandler } from 'express';
import { cookieSecure } from '../config';
import { randomToken, safeEqual } from '../lib/crypto';
import { forbidden } from '../lib/http';
import { COOKIES } from '../lib/session';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Double-submit cookie: state-changing requests must echo the csrf cookie in X-CSRF-Token. */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookie = req.cookies?.[COOKIES.csrf];
  const header = req.get('x-csrf-token');
  if (!cookie || !header || !safeEqual(cookie, header)) {
    throw forbidden('Security token missing or expired. Refresh the page and try again.', 'CSRF');
  }
  next();
};

export const issueCsrfToken: RequestHandler = (req, res) => {
  let token: string | undefined = req.cookies?.[COOKIES.csrf];
  if (!token) {
    token = randomToken(24);
    res.cookie(COOKIES.csrf, token, { httpOnly: false, sameSite: 'lax', secure: cookieSecure, path: '/' });
  }
  res.json({ csrfToken: token });
};
