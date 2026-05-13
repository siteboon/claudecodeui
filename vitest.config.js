import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Upstream's `server/modules/**/tests/*` and a few other suites use
    // node:test instead of vitest; excluding them keeps `npm test` clean.
    exclude: [
      'node_modules/**',
      'dist/**',
      'dist-server/**',
      'server/modules/**',
      'server/shared/**/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      // Server-side `@/...` imports map to server/*. The frontend's vite.config.js
      // maps the same prefix to src/ for the browser bundle; under vitest we
      // currently only run server- and util-level tests, so the server alias is
      // the one that needs to resolve.
      '@': fileURLToPath(new URL('./server', import.meta.url)),
    },
  },
});
