import { config as loadEnv } from 'dotenv';

// must run before src/config.ts is imported
loadEnv({ path: '.env.test', override: true });
process.env.NODE_ENV = 'test';
