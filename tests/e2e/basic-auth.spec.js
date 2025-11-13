// Basic authentication E2E tests
import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display login form', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByLabel(/username/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('should show validation error for empty credentials', async ({ page }) => {
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText(/please enter both username and password/i)).toBeVisible();
  });

  test('should handle login with valid credentials', async ({ page }) => {
    await page.getByLabel(/username/i).fill('testuser');
    await page.getByLabel(/password/i).fill('password123');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should redirect to main app after successful login
    await expect(page).toHaveURL(/\/dashboard|\/chat|\/projects/);

    // Should show some indication of successful login (this will depend on your app)
    await expect(page.locator('[data-testid="user-menu"], .user-info, nav')).toBeVisible();
  });

  test('should handle login with invalid credentials', async ({ page }) => {
    await page.getByLabel(/username/i).fill('wronguser');
    await page.getByLabel(/password/i).fill('wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText(/invalid credentials/i)).toBeVisible();
    await expect(page).toHaveURL('/');
  });

  test('should clear error when user starts typing after error', async ({ page }) => {
    await page.getByLabel(/username/i).fill('wronguser');
    await page.getByLabel(/password/i).fill('wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText(/invalid credentials/i)).toBeVisible();

    // Start typing again
    await page.getByLabel(/username/i).fill('');
    await page.getByLabel(/username/i).fill('newuser');

    // Error should be cleared
    await expect(page.getByText(/invalid credentials/i)).not.toBeVisible();
  });
});

test.describe('Loading States', () => {
  test('should show loading state during login', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel(/username/i).fill('testuser');
    await page.getByLabel(/password/i).fill('password123');

    // Click login
    await page.getByRole('button', { name: /sign in/i }).click();

    // Check for loading state (button should be disabled and show loading text)
    await expect(page.getByRole('button', { name: /signing in\.\.\./i })).toBeVisible();
    await expect(page.getByLabel(/username/i)).toBeDisabled();
    await expect(page.getByLabel(/password/i)).toBeDisabled();
  });
});

test.describe('Responsive Design', () => {
  test('should work on mobile devices', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone size
    await page.goto('/');

    // Form should still be usable on mobile
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByLabel(/username/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('should work on tablet devices', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 }); // iPad size
    await page.goto('/');

    // Form should still be usable on tablet
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByLabel(/username/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });
});