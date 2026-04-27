/**
 * Global setup for the Playwright smoke suite.
 *
 * Cold-start flake fix: `npm run dev:test` boots Vite + tsx server. Playwright's
 * `webServer.url` health check hits the Node server (port 3099), which responds
 * 200 long before Vite has compiled the client module graph. The first
 * `page.goto('/')` then triggers Vite to compile hundreds of files inline,
 * which can blow past the per-test 30s timeout while the auth fixture is
 * still waiting for `.w-rail` to mount.
 *
 * This globalSetup runs once before any test, after webServer is ready, and
 * launches a real browser to navigate to the app. That forces Vite to
 * transform the full module graph on demand (index.html -> /src/main.jsx ->
 * everything else). By the time the first spec runs, Vite's transform cache
 * is warm and `.w-rail` shows up in <5s.
 */

import { chromium, type FullConfig } from '@playwright/test';

const VITE_URL = 'http://localhost:5199/';
const PREWARM_TIMEOUT_MS = 120_000;

export default async function globalSetup(_config: FullConfig) {
  const start = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[global-setup] pre-warming Vite at ${VITE_URL} ...`);

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch(
    executablePath ? { executablePath } : undefined,
  );

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    // Wait for `networkidle` so Vite has finished transforming the on-demand
    // module graph triggered by the SPA bootstrapping.
    await page.goto(VITE_URL, {
      waitUntil: 'networkidle',
      timeout: PREWARM_TIMEOUT_MS,
    });
    const elapsed = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(`[global-setup] Vite module graph warm in ${elapsed}ms`);
    await context.close();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[global-setup] Vite pre-warm failed:`, err);
    // Don't throw — let the tests run and surface the real failure mode.
  } finally {
    await browser.close();
  }
}
