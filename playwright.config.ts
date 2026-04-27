import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5199';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // On NixOS the bundled Playwright Chromium can't find system libs.
        // Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to a system chromium binary
        // (e.g. the Nix store path) to override.  No-op on standard Linux/macOS.
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? {
              channel: undefined,
              launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
            }
          : {}),
      },
    },
  ],
  // Only spin up dev:test automatically when not targeting a remote URL
  ...(process.env.PLAYWRIGHT_BASE_URL
    ? {}
    : {
        webServer: {
          command: 'npm run dev:test',
          url: 'http://localhost:3099/api/auth/status',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            SERVER_PORT: '3099',
            VITE_PORT: '5199',
            DATABASE_PATH: './.e2e/test.db',
            // Clear BASE_PATH so the app serves at / — prevents the Pluto
            // per-user prefix (e.g. /jorge/) from bleeding into dev:test runs.
            BASE_PATH: '',
          },
        },
      }),
});
