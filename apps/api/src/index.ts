import { createApp } from './app';
import { config, productionWarnings } from './config';
import { prisma } from './db';
import { applyBranding } from './lib/branding';
import { startMailWorker } from './lib/mailer';

const server = createApp().listen(config.API_PORT, () => {
  console.info(`API listening on http://localhost:${config.API_PORT}${config.SERVE_WEB ? ' (also serving the web app)' : ''}`);
  for (const w of productionWarnings()) console.warn(`[config] ${w}`);
});
// the organization's name and logos come from src/branding.ts
applyBranding().catch((err) => console.error('[branding] could not apply src/branding.ts:', err instanceof Error ? err.message : err));
// failed emails are retried from the outbox
startMailWorker();

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
