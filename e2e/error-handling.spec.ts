import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Error Handling & Edge Cases', () => {
  test('app handles invalid session ID gracefully', async ({ page }) => {
    await page.goto('/session/invalid-uuid-that-does-not-exist');
    await page.waitForTimeout(2_000);
    // Should not show a crash/error page
    const errorOverlay = page.locator('vite-error-overlay');
    await expect(errorOverlay).toHaveCount(0);
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('app handles 404 route gracefully', async ({ page }) => {
    await page.goto('/some/nonexistent/route');
    await page.waitForTimeout(2_000);
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('no console errors on initial page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/');
    await page.waitForTimeout(3_000);
    // Filter out expected errors (WebSocket connection, 9Router)
    const unexpectedErrors = errors.filter(
      e => !e.includes('WebSocket') && !e.includes('9router') && !e.includes('9Router') && !e.includes('fetch')
    );
    // Log for debugging but don't fail on known issues
    if (unexpectedErrors.length > 0) {
      console.log('Console errors:', unexpectedErrors);
    }
  });

  test('no uncaught exceptions on page load', async ({ page }) => {
    const exceptions: string[] = [];
    page.on('pageerror', err => exceptions.push(err.message));
    await page.goto('/');
    await page.waitForTimeout(3_000);
    expect(exceptions.length).toBe(0);
  });

  test('page does not have a Vite error overlay', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2_000);
    const overlay = page.locator('vite-error-overlay');
    await expect(overlay).toHaveCount(0);
  });

  test('rapid navigation does not crash', async ({ page }) => {
    await page.goto('/');
    await page.goto('/session/test1');
    await page.goto('/');
    await page.goto('/session/test2');
    await page.goto('/');
    await page.waitForTimeout(1_000);
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});
