import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5199';

export default defineConfig({
  testDir: './e2e',
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
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Only spin up dev:test automatically when not targeting a remote URL
  ...(process.env.PLAYWRIGHT_BASE_URL
    ? {}
    : {
        webServer: {
          command: 'npm run dev:test',
          url: 'http://localhost:5199',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            SERVER_PORT: '3099',
            VITE_PORT: '5199',
            DATABASE_PATH: './.e2e/test.db',
          },
        },
      }),
});
