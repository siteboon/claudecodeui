import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./server', import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ['server/**/*.test.ts'],
    exclude: ['dist-server/**', 'node_modules/**'],
  },
});
