import { Page, expect, request as pwRequest } from '@playwright/test';

const API = 'http://localhost:3099';
const TEST_USER = 'e2etest';
const TEST_PASS = 'e2etest123!';

let cachedToken: string | null = null;

/**
 * Get a JWT token via API (register if needed, then login).
 */
async function getAuthToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;

  const ctx = await pwRequest.newContext();
  try {
    // Try login first
    const loginRes = await ctx.post(`${API}/api/auth/login`, {
      data: { username: TEST_USER, password: TEST_PASS },
    });
    if (loginRes.ok()) {
      const body = await loginRes.json();
      cachedToken = body.token;
      return cachedToken;
    }

    // If login fails, try register
    const regRes = await ctx.post(`${API}/api/auth/register`, {
      data: { username: TEST_USER, password: TEST_PASS },
    });
    if (regRes.ok()) {
      const body = await regRes.json();
      cachedToken = body.token;
      return cachedToken;
    }
  } catch {
    // API may be rate limited or unreachable
  } finally {
    await ctx.dispose();
  }
  return null;
}

/**
 * Ensure we're past the auth gate and into the main app.
 */
export async function ensureLoggedIn(page: Page) {
  // Try getting token via API first
  const token = await getAuthToken();

  if (token) {
    // Set token in localStorage before navigating
    await page.goto('/');
    await page.evaluate((t) => {
      localStorage.setItem('auth-token', t);
    }, token);
    await page.goto('/');
    await page.waitForTimeout(1_000);
  } else {
    // Fallback: login via UI
    await page.goto('/');
    await page.waitForTimeout(1_000);
  }

  const passwordInput = page.locator('input[placeholder*="password" i]');
  const isLoginPage = await passwordInput.isVisible({ timeout: 3_000 }).catch(() => false);

  if (isLoginPage) {
    const usernameInput = page.locator('input[placeholder*="username" i]').first();
    await usernameInput.fill(TEST_USER);
    await passwordInput.fill(TEST_PASS);
    const signInBtn = page.locator('button:has-text("Sign In")').first();
    await signInBtn.click();
    await page.waitForTimeout(3_000);
  }

  // Verify we're in the main app — look for common app elements
  const appElement = page.locator('[role="application"], main, nav, .bg-background, [data-testid="app"]').first();
  await expect(appElement).toBeVisible({ timeout: 15_000 });
}

/**
 * Wait for sidebar to be visible.
 */
export async function waitForSidebar(page: Page) {
  const sidebar = page.locator('nav[aria-label="Sidebar"], nav').first();
  await expect(sidebar).toBeVisible({ timeout: 5_000 });
}
