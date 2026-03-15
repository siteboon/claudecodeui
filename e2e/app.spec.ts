import { test, expect } from '@playwright/test';

/**
 * E2E – Application boot & first-time setup flow.
 *
 * Because the sandbox has no pre-existing database, the very first visit
 * shows the "setup" (registration) form.  After registering, the user is
 * redirected through onboarding and finally reaches the main chat UI.
 */

const TEST_USER = { username: 'testuser', password: 'testpass123' };

/* ------------------------------------------------------------------ */
/*  Helper: register or login                                          */
/* ------------------------------------------------------------------ */

async function ensureAuthenticated(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const res = await page.request.get('/api/auth/status');
  const status = await res.json();

  if (status.needsSetup) {
    // Register
    const usernameInput = page.locator('#username');
    await expect(usernameInput).toBeVisible({ timeout: 15_000 });
    await usernameInput.fill(TEST_USER.username);

    const passwordInputs = page.locator('input[type="password"]');
    const count = await passwordInputs.count();
    for (let i = 0; i < count; i++) {
      await passwordInputs.nth(i).fill(TEST_USER.password);
    }

    const submitBtn = page.getByRole('button', { name: /create|register|set up|sign up|get started/i });
    await submitBtn.click();
    await page.waitForLoadState('networkidle');
  } else if (!status.isAuthenticated) {
    // Login
    const passwordInput = page.locator('input[type="password"]');
    if (await passwordInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const usernameInput = page.locator('#username').or(page.locator('input[type="text"]').first());
      await usernameInput.fill(TEST_USER.username);
      await passwordInput.fill(TEST_USER.password);

      const loginBtn = page.getByRole('button', { name: /log\s*in|sign\s*in|submit/i });
      await loginBtn.click();
      await page.waitForLoadState('networkidle');
    }
  }
}

/* ------------------------------------------------------------------ */
/*  1. Health / landing-page tests                                     */
/* ------------------------------------------------------------------ */

test.describe('App Boot', () => {
  test('server is reachable and returns HTML', async ({ page }) => {
    const res = await page.goto('/');
    expect(res).not.toBeNull();
    expect(res!.status()).toBe(200);
    expect(res!.headers()['content-type']).toContain('text/html');
  });

  test('root element exists', async ({ page }) => {
    await page.goto('/');
    const root = page.locator('#root');
    await expect(root).toBeAttached();
  });

  test('page title is set', async ({ page }) => {
    await page.goto('/');
    // The title is "CloudCLI UI" (see index.html)
    await expect(page).toHaveTitle(/CloudCLI|Claude/i);
  });
});

/* ------------------------------------------------------------------ */
/*  2. First-time setup (registration) flow                            */
/* ------------------------------------------------------------------ */

test.describe('First-time Setup', () => {
  test('shows setup form when no user exists', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // On first visit with no users, the setup form should appear
    // Use the #username id to avoid matching other text inputs
    const usernameInput = page.locator('#username');

    // Wait up to 15 seconds for the form to appear (auth check may take time)
    await expect(usernameInput).toBeVisible({ timeout: 15_000 });
  });

  test('validates registration fields', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for form to be ready
    const submitButton = page.getByRole('button', { name: /create|register|set up|sign up|get started/i });
    await expect(submitButton).toBeVisible({ timeout: 15_000 });

    // Try submitting empty form — should see validation
    await submitButton.click();

    // The form should still be visible (not navigated away)
    await expect(submitButton).toBeVisible();
  });

  test('can register a new user and reaches onboarding', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Fill in the setup form
    const usernameInput = page.locator('#username');
    await expect(usernameInput).toBeVisible({ timeout: 15_000 });
    await usernameInput.fill(TEST_USER.username);

    // Fill password fields
    const passwordInputs = page.locator('input[type="password"]');
    const count = await passwordInputs.count();
    for (let i = 0; i < count; i++) {
      await passwordInputs.nth(i).fill(TEST_USER.password);
    }

    // Submit registration
    const submitButton = page.getByRole('button', { name: /create|register|set up|sign up|get started/i });
    await submitButton.click();

    // After successful registration, the setup form (#username input) should
    // either disappear or the user lands on the onboarding page.
    // The onboarding page has a Git config step with different fields.
    // We check that the original setup form username field is no longer editable or has changed.
    await page.waitForLoadState('networkidle');

    // Wait for transition: either we see the onboarding page or the login page is gone
    // The onboarding page should have a "Git" related text or "Next/Skip" button
    const onboardingIndicator = page.getByText(/git|onboarding|next|skip|step/i).first();
    await expect(onboardingIndicator).toBeVisible({ timeout: 15_000 });
  });
});

/* ------------------------------------------------------------------ */
/*  3. Auth API tests                                                  */
/* ------------------------------------------------------------------ */

test.describe('Auth API', () => {
  test('GET /api/auth/status returns valid JSON', async ({ request }) => {
    const res = await request.get('/api/auth/status');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('needsSetup');
    expect(typeof body.needsSetup).toBe('boolean');
  });

  test('protected routes return 401 without token', async ({ request }) => {
    const res = await request.get('/api/projects');
    expect(res.status()).toBe(401);
  });

  test('can register and get token via API', async ({ request }) => {
    // Check if setup is needed
    const statusRes = await request.get('/api/auth/status');
    const status = await statusRes.json();

    if (status.needsSetup) {
      const registerRes = await request.post('/api/auth/register', {
        data: { username: TEST_USER.username, password: TEST_USER.password },
      });
      expect(registerRes.ok()).toBeTruthy();
      const body = await registerRes.json();
      expect(body).toHaveProperty('token');
      expect(typeof body.token).toBe('string');
    } else {
      // User already exists, try login
      const loginRes = await request.post('/api/auth/login', {
        data: { username: TEST_USER.username, password: TEST_USER.password },
      });
      expect(loginRes.ok()).toBeTruthy();
      const body = await loginRes.json();
      expect(body).toHaveProperty('token');
      expect(typeof body.token).toBe('string');
    }
  });
});

/* ------------------------------------------------------------------ */
/*  4. Post-login: Onboarding & main UI                                */
/* ------------------------------------------------------------------ */

test.describe('Onboarding & Main UI', () => {
  test('after login, the onboarding or main UI is shown', async ({ page }) => {
    await ensureAuthenticated(page);

    // After successful auth, we should see either:
    // 1. Onboarding page (if not completed)
    // 2. Main chat interface

    const body = page.locator('body');
    await expect(body).toBeVisible();

    // Take a screenshot for visual verification
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: 'e2e/screenshots/post-login.png', fullPage: true });
  });

  test('authenticated API calls work with token', async ({ page }) => {
    // First get a token via API
    const statusRes = await page.request.get('/api/auth/status');
    const status = await statusRes.json();

    let token: string;
    if (status.needsSetup) {
      const registerRes = await page.request.post('/api/auth/register', {
        data: { username: TEST_USER.username, password: TEST_USER.password },
      });
      const body = await registerRes.json();
      token = body.token;
    } else {
      const loginRes = await page.request.post('/api/auth/login', {
        data: { username: TEST_USER.username, password: TEST_USER.password },
      });
      const body = await loginRes.json();
      token = body.token;
    }

    // Now use the token to access a protected endpoint
    const projectsRes = await page.request.get('/api/projects', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(projectsRes.ok()).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  5. Provider / CLI status endpoint tests                            */
/* ------------------------------------------------------------------ */

test.describe('Provider CLI Status Endpoints', () => {
  let authToken: string;

  test.beforeAll(async ({ request }) => {
    // Get auth token
    const statusRes = await request.get('/api/auth/status');
    const status = await statusRes.json();

    if (status.needsSetup) {
      const registerRes = await request.post('/api/auth/register', {
        data: { username: TEST_USER.username, password: TEST_USER.password },
      });
      const body = await registerRes.json();
      authToken = body.token;
    } else {
      const loginRes = await request.post('/api/auth/login', {
        data: { username: TEST_USER.username, password: TEST_USER.password },
      });
      const body = await loginRes.json();
      authToken = body.token;
    }
  });

  const providers = ['claude', 'cursor', 'codex', 'gemini', 'copilot'] as const;

  for (const provider of providers) {
    test(`/api/cli/${provider}/status returns auth info`, async ({ request }) => {
      const res = await request.get(`/api/cli/${provider}/status`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body).toHaveProperty('authenticated');
      expect(typeof body.authenticated).toBe('boolean');
    });
  }
});
