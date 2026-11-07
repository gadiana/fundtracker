import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Public URL of the web app, used in email links */
  WEB_URL: z.string().url().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  TRUST_PROXY: bool,
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Fund Tracker <no-reply@localhost>'),
  UPLOAD_DIR: z.string().default('./storage'),
  /** Production: the API also serves the built web app (apps/web/dist), so one process is enough. */
  SERVE_WEB: bool,
  WEB_DIST: z.string().default('../web/dist'),
  /** Cookies are https-only in production. Only turn this off for a trusted network without https. */
  COOKIE_SECURE: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1')),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
export const cookieSecure = config.COOKIE_SECURE ?? isProd;

/** Settings that work but are risky in production; printed when the server starts. */
export function productionWarnings() {
  if (!isProd) return [];
  const w: string[] = [];
  if (!config.WEB_URL.startsWith('https://')) w.push('WEB_URL is not https: links in emails and the QR codes will use plain http, and the camera scanner needs https.');
  if (!cookieSecure) w.push('COOKIE_SECURE is off: sign-in cookies can travel over plain http.');
  if (!config.TRUST_PROXY) w.push('TRUST_PROXY is off: behind a reverse proxy, rate limits and the audit log will see the proxy’s address instead of each user’s.');
  if (!config.SMTP_HOST) w.push('SMTP_HOST is empty: no email will be delivered (verification, password resets, receipts).');
  if (/change[-_ ]?me|example|secret123/i.test(config.JWT_SECRET)) w.push('JWT_SECRET looks like a placeholder: set a long random value.');
  return w;
}
