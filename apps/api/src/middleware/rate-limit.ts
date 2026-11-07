import { rateLimit } from 'express-rate-limit';
import { isTest } from '../config';

const limiter = (windowMs: number, limit: number) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => isTest,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } });
    },
  });

export const apiLimiter = limiter(60_000, 300);
export const loginLimiter = limiter(15 * 60_000, 20);
export const signupLimiter = limiter(60 * 60_000, 10);
export const emailLimiter = limiter(60 * 60_000, 10);
