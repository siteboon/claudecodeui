import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/integration.test.ts'],
    testTimeout: 120_000,
  },
});
