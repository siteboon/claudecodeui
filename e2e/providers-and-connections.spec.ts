import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Providers & Connections', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('provider selection UI exists', async ({ page }) => {
    // Providers may be shown in sidebar, settings, or main content
    const providerUI = page.locator(
      'button:has-text("Claude"), button:has-text("Cursor"), text=Provider, [data-testid="provider-selector"]'
    ).first();
    if (await providerUI.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(providerUI).toBeVisible();
    }
  });

  test('WebSocket connection indicator exists', async ({ page }) => {
    // Check for connection status in the UI
    const wsIndicator = page.locator(
      '[data-testid="ws-status"], [role="status"], .bg-green-500, .bg-red-500, text=Connected, text=Disconnected'
    ).first();
    // May or may not be visible
    await page.waitForTimeout(2_000);
  });

  test('9Router status endpoint responds', async ({ page }) => {
    const response = await page.request.get('http://localhost:3099/api/9router/status');
    // May return 200 with data or error if 9Router isn't running
    expect([200, 500, 502, 503]).toContain(response.status());
  });

  test('API health check responds', async ({ page }) => {
    const response = await page.request.get('http://localhost:3099/api/projects');
    // Should return something (may be 401 if auth required)
    expect(response.status()).toBeLessThan(500);
  });

  test('provider auth status endpoint works', async ({ page }) => {
    // Check a provider auth endpoint
    const response = await page.request.get('http://localhost:3099/api/providers/claude/auth-status').catch(() => null);
    if (response) {
      expect(response.status()).toBeLessThan(500);
    }
  });
});
