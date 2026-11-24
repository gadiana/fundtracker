import { execSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';

/**
 * Brings the test database up to date with the migrations (creating it if needed).
 * Each test then empties the tables it uses (see resetDb in helpers.ts).
 */
export default function setup() {
  loadEnv({ path: '.env.test', override: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('apps/api/.env.test must define DATABASE_URL');

  // safety net: never wipe a non-test database
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run tests against "${dbName}". The test database name must contain "test".`);
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
