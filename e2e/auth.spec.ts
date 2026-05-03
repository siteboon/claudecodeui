import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('loads the app without crashing', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/CloudCLI|Cloud/i);
  });

  test('shows login or main UI depending on auth mode', async ({ page }) => {
    await page.goto('/');
    // Either we see a login form OR the main app (platform mode)
    const loginForm = page.locator('form, [data-testid="login-form"], input[type="password"]');
    const mainApp = page.locator('[role="application"], .bg-background, [data-testid="main-content"]');
    const either = loginForm.or(mainApp);
    await expect(either.first()).toBeVisible({ timeout: 10_000 });
  });

  test('login page has username and password fields (if not platform mode)', async ({ page }) => {
    await page.goto('/');
    const passwordInput = page.locator('input[type="password"]');
    if (await passwordInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(page.locator('input[type="text"], input[name="username"]').first()).toBeVisible();
      await expect(passwordInput).toBeVisible();
      const submitBtn = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign")');
      await expect(submitBtn.first()).toBeVisible();
    }
  });

  test('registration flow works (if available)', async ({ page }) => {
    await page.goto('/');
    const registerLink = page.locator('a:has-text("Register"), button:has-text("Register"), a:has-text("Sign up")');
    if (await registerLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await registerLink.click();
      await expect(page.locator('input[type="password"]')).toBeVisible();
    }
  });

  test('can perform login with test credentials', async ({ page }) => {
    await page.goto('/');
    const passwordInput = page.locator('input[type="password"]');
    if (await passwordInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Try to register first, then login
      const registerLink = page.locator('a:has-text("Register"), button:has-text("Register"), button:has-text("Create")');
      if (await registerLink.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await registerLink.click();
        await page.waitForTimeout(500);
      }
      const usernameInput = page.locator('input[type="text"], input[name="username"], input[placeholder*="user"]').first();
      await usernameInput.fill('e2etest');
      await passwordInput.fill('e2etest123');
      const submitBtn = page.locator('button[type="submit"]').first();
      await submitBtn.click();
      await page.waitForTimeout(2_000);
    }
    // After login or in platform mode, we should see the main app
    const mainApp = page.locator('[role="application"], main, .flex.min-w-0');
    await expect(mainApp.first()).toBeVisible({ timeout: 10_000 });
  });
});
