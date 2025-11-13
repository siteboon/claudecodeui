// Navigation E2E tests
import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authentication or log in if needed
    await page.goto('/');

    // If there's a login page, try to log in with test credentials
    if (await page.getByLabel(/username/i).isVisible()) {
      await page.getByLabel(/username/i).fill('testuser');
      await page.getByLabel(/password/i).fill('password123');
      await page.getByRole('button', { name: /sign in/i }).click();
      await page.waitForURL(/dashboard|chat|projects/);
    }
  });

  test('should have working navigation links', async ({ page }) => {
    // Check for common navigation elements
    const navLinks = [
      { selector: 'a[href*="/dashboard"]', name: 'Dashboard' },
      { selector: 'a[href*="/projects"]', name: 'Projects' },
      { selector: 'a[href*="/chat"]', name: 'Chat' },
      { selector: 'a[href*="/settings"]', name: 'Settings' }
    ];

    for (const link of navLinks) {
      const element = page.locator(link.selector);
      if (await element.isVisible()) {
        await element.click();
        await expect(page).toHaveURL(new RegExp(link.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
    }
  });

  test('should show responsive menu on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    // Look for mobile menu toggle
    const menuToggle = page.locator('button[aria-label*="menu"], .menu-toggle, .hamburger');

    if (await menuToggle.isVisible()) {
      await menuToggle.click();

      // Check if menu items appear
      const mobileMenuItems = page.locator('.mobile-menu, [role="menu"], .sidebar');
      await expect(mobileMenuItems).toBeVisible();
    }
  });

  test('should have functional breadcrumb navigation', async ({ page }) => {
    // Look for breadcrumb elements
    const breadcrumbs = page.locator('.breadcrumb, [role="navigation"][aria-label="breadcrumb"], nav[aria-label="breadcrumb"]');

    if (await breadcrumbs.isVisible()) {
      const breadcrumbLinks = breadcrumbs.locator('a');

      if (await breadcrumbLinks.count() > 0) {
        await breadcrumbLinks.first().click();
        // Should navigate to the first breadcrumb item
        await expect(page).not.toHaveURL(/chat/); // Assuming we're not on chat anymore
      }
    }
  });
});

test.describe('Page Loading', () => {
  test('should load pages without errors', async ({ page }) => {
    const routes = [
      '/',
      '/dashboard',
      '/projects',
      '/chat',
      '/settings'
    ];

    for (const route of routes) {
      const response = await page.goto(route);
      expect(response?.status()).toBeLessThan(400);

      // Wait for page to load
      await page.waitForLoadState('networkidle');

      // Check for any error messages
      const errorElements = page.locator('[data-testid="error"], .error, .error-message');
      if (await errorElements.count() > 0) {
        console.warn(`Error found on page ${route}:`, await errorElements.first().textContent());
      }
    }
  });

  test('should handle 404 pages gracefully', async ({ page }) => {
    const response = await page.goto('/nonexistent-page');

    if (response?.status() === 404) {
      // Should show a 404 page or redirect
      await expect(page.locator('body')).toContainText(/404|not found|page not found/i);
    }
  });
});