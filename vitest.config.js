import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
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
