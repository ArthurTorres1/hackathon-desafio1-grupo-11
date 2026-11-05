import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/api/tests/domain/**/*.test.ts', 'packages/contracts/tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
});
