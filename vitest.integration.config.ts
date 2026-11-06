import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

config({ path: '.env' });
const testDatabase = process.env.TEST_DATABASE_URL;
if (!testDatabase || new URL(testDatabase).pathname !== '/foresttrace_test') {
  throw new Error('Integração exige TEST_DATABASE_URL para o banco isolado foresttrace_test.');
}
const applicationDatabase = new URL(testDatabase);
applicationDatabase.username = 'foresttrace_app';
applicationDatabase.password = process.env.POSTGRES_APP_PASSWORD ?? 'foresttrace_dev_app';

export default defineConfig({
  test: {
    include: ['apps/api/tests/integration/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    env: { DATABASE_URL: applicationDatabase.toString(), DIRECT_URL: testDatabase, DEMO_MODE: 'true' },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
