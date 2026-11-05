import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

config({ path: '.env' });
const testDatabase = process.env.TEST_DATABASE_URL;
if (!testDatabase || new URL(testDatabase).pathname !== '/foresttrace_test') {
  throw new Error('Integração exige TEST_DATABASE_URL para o banco isolado foresttrace_test.');
}

export default defineConfig({
  test: {
    include: ['apps/api/tests/integration/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    env: { DATABASE_URL: testDatabase, DIRECT_URL: testDatabase },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
