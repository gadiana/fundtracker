import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { config, isProd } from './config';
import { apiNotFound, errorHandler } from './lib/http';
import { csrfProtection, issueCsrfToken } from './middleware/csrf';
import { apiLimiter } from './middleware/rate-limit';
import { auditRouter } from './modules/audit/routes';
import { authRouter } from './modules/auth/routes';
import { aysRouter } from './modules/ays/routes';
import { filesRouter, uploadsRouter } from './modules/files/routes';
import { fundRequestsRouter } from './modules/fund-requests/routes';
import { fundsRouter } from './modules/funds/routes';
import { membersRouter } from './modules/members/routes';
import { notificationsRouter } from './modules/notifications/routes';
import { dashboardRouter } from './modules/reports/dashboard';
import { historyRouter, reportsRouter } from './modules/reports/routes';
import { usersRouter } from './modules/profile/avatar';
import { profileRouter } from './modules/profile/routes';
import { paymentsRouter } from './modules/payments/routes';
import { publicRouter } from './modules/public/routes';
import { publicVerifyRouter } from './modules/public/verify';
import { settingsRouter } from './modules/settings/routes';
import { enrollmentLinksRouter, publicEnrollRouter } from './modules/students/enrollment';
import { importRouter } from './modules/students/import';
import { studentsRouter } from './modules/students/routes';
import { approversRouter, designationsRouter, programsRouter, sectionsRouter } from './modules/structure/routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY ? 1 : false);
  // money is BIGINT centavos; JSON has no bigint, and centavo values fit safely in a number
  app.set('json replacer', (_key: string, value: unknown) => (typeof value === 'bigint' ? Number(value) : value));

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // everything comes from this site; images may also be data: URLs (QR codes, rendered receipts)
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          workerSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          // only when the site itself is on https (a plain-http LAN setup would break otherwise)
          upgradeInsecureRequests: isProd && config.WEB_URL.startsWith('https://') ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  // the scanner page needs the camera; nothing needs the microphone, location or payment APIs
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api', apiLimiter);
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/auth/csrf', issueCsrfToken);
  app.use('/api', csrfProtection);

  app.use('/api/public/enroll', publicEnrollRouter);
  app.use('/api/public/verify', publicVerifyRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/me', profileRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/ays', aysRouter);
  app.use('/api/members', membersRouter);
  app.use('/api/designations', designationsRouter);
  app.use('/api/programs', programsRouter);
  app.use('/api/sections', sectionsRouter);
  app.use('/api/approvers', approversRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/uploads', uploadsRouter);
  app.use('/api/fund-requests', fundRequestsRouter);
  app.use('/api/funds', fundsRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/students/import', importRouter);
  app.use('/api/students', studentsRouter);
  app.use('/api/enrollment-links', enrollmentLinksRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/history', historyRouter);
  app.use('/api/reports', reportsRouter);

  app.use('/api', apiNotFound);
  if (config.SERVE_WEB) serveWebApp(app);
  app.use(errorHandler);
  return app;
}

/**
 * The built web app from the same origin as the API (production). Hashed assets are cached
 * for a year; index.html never is, so a new release shows up at once.
 */
function serveWebApp(app: express.Express) {
  const dist = resolve(process.cwd(), config.WEB_DIST);
  const index = join(dist, 'index.html');
  if (!existsSync(index)) {
    console.warn(`[web] SERVE_WEB is on but ${index} doesn't exist. Run "npm run build" first.`);
    return;
  }
  app.use('/assets', express.static(join(dist, 'assets'), { immutable: true, maxAge: '365d', index: false, fallthrough: false }));
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  // every page path is the single-page app
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}
