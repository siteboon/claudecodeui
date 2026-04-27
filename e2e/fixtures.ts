/**
 * Shared Playwright fixtures for the smoke suite.
 *
 * authFixture: handles register-on-first-run OR login-on-subsequent-runs.
 * The dev:test server always starts with DATABASE_PATH=./.e2e/test.db.
 * If the DB is fresh, POST /api/auth/register creates the user and returns a
 * token.  If a user already exists, register returns 403 and we fall through
 * to POST /api/auth/login instead.
 */

import { test as base, expect } from '@playwright/test';

export const TEST_USERNAME = 'e2euser';
export const TEST_PASSWORD = 'e2epassword1';

/** Ensure the app is authenticated and the project rail is visible. */
export async function ensureLoggedIn(page: import('@playwright/test').Page) {
  // Per-spec timeout floor. The fixture's internal waitFors add up to ~90s
  // worst-case (45s for login form + 45s for rail after reload), but the
  // Playwright per-test default is 30s — so even if the locators are willing
  // to wait, the test times out mid-fixture. Specs 04/05 set this explicitly;
  // apply the same floor here so 01/02/03 don't flake on Vite cold-compile.
  base.info().setTimeout(Math.max(base.info().timeout, 60_000));

  // Navigate to root — this lands on login or setup depending on DB state.
  // Use 'commit' so we don't wait for every dev-mode HMR ping; Vite keeps
  // chatter on the network indefinitely in dev.
  await page.goto('/', { waitUntil: 'commit' });

  // Wait for either the login form or the setup form or the authenticated app
  const loginInput = page.locator('#username');
  const projectRail = page.locator('.w-rail');

  // If already authed (token in localStorage from a previous spec in the same
  // browser context), the project rail should appear quickly.
  const alreadyAuthed = await projectRail.isVisible().catch(() => false);
  if (alreadyAuthed) return;

  // Wait for the login input to appear. Race against the project rail in
  // case the app is already authenticated and skipped the login form.
  await Promise.race([
    loginInput.waitFor({ state: 'visible', timeout: 45_000 }),
    projectRail.waitFor({ state: 'visible', timeout: 45_000 }),
  ]);

  // If the rail came up first, we're done.
  if (await projectRail.isVisible().catch(() => false)) return;

  // Try register first (fresh DB)
  const registerRes = await page.request.post('/api/auth/register', {
    data: { username: TEST_USERNAME, password: TEST_PASSWORD },
  });

  let token: string;

  if (registerRes.ok()) {
    const body = await registerRes.json();
    token = body.token;
  } else {
    // User already exists — login instead
    const loginRes = await page.request.post('/api/auth/login', {
      data: { username: TEST_USERNAME, password: TEST_PASSWORD },
    });
    expect(loginRes.ok(), `login failed: ${await loginRes.text()}`).toBe(true);
    const body = await loginRes.json();
    token = body.token;
  }

  // Inject token into localStorage so React Auth context picks it up
  // Mark onboarding as complete so the wizard doesn't block the app on first run
  await page.request.post('/api/user/complete-onboarding', {
    headers: { Authorization: `Bearer ${token}` },
  });

  // AUTH_TOKEN_STORAGE_KEY = 'auth-token' (see src/components/auth/constants.ts)
  await page.evaluate((t) => {
    localStorage.setItem('auth-token', t);
  }, token);

  // Reload so the app re-initialises with the token
  await page.reload();

  // Wait for authenticated UI (allow longer for project data to load)
  await page.locator('.w-rail').waitFor({ state: 'visible', timeout: 45_000 });
}

export { expect };
export const test = base;
