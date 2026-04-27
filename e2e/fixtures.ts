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
  // Navigate to root — this lands on login or setup depending on DB state
  await page.goto('/');

  // Wait for either the login form or the setup form or the authenticated app
  const loginInput = page.locator('#username');
  const setupInput = page.locator('#username');
  const projectRail = page.locator('.w-rail');

  // If already authed (token in localStorage from a previous spec in the same
  // browser context), the project rail should appear quickly.
  const alreadyAuthed = await projectRail.isVisible().catch(() => false);
  if (alreadyAuthed) return;

  // Wait for an input to appear (either login or setup form)
  await loginInput.waitFor({ state: 'visible', timeout: 10_000 });

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
  // AUTH_TOKEN_STORAGE_KEY = 'auth-token' (see src/components/auth/constants.ts)
  await page.evaluate((t) => {
    localStorage.setItem('auth-token', t);
  }, token);

  // Reload so the app re-initialises with the token
  await page.reload();

  // Wait for authenticated UI
  await page.locator('.w-rail').waitFor({ state: 'visible', timeout: 15_000 });
}

export { expect };
export const test = base;
