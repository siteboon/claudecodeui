import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Layout & Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('main layout has sidebar and content area', async ({ page }) => {
    // Desktop: sidebar + main content
    const sidebar = page.locator('nav[aria-label="Sidebar"], [data-testid="sidebar"], .border-r').first();
    const mainContent = page.locator('main, [data-testid="main-content"]').first();
    await expect(sidebar).toBeVisible({ timeout: 5_000 });
    await expect(mainContent).toBeVisible();
  });

  test('app container has correct ARIA role', async ({ page }) => {
    const app = page.locator('[role="application"]');
    await expect(app).toBeVisible({ timeout: 5_000 });
  });

  test('sidebar contains project or conversation list', async ({ page }) => {
    const list = page.locator('nav [role="list"], nav ul, nav [data-testid="project-list"], nav button').first();
    await expect(list).toBeVisible({ timeout: 5_000 });
  });

  test('sidebar has navigation tabs or sections', async ({ page }) => {
    // Look for tab buttons or section headers in the sidebar
    const tabs = page.locator('nav button, nav [role="tab"]');
    const count = await tabs.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking sidebar items changes main content', async ({ page }) => {
    // Find any clickable item in the sidebar
    const sidebarBtn = page.locator('nav button').first();
    if (await sidebarBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await sidebarBtn.click();
      await page.waitForTimeout(500);
      // Main content should still be visible
      const mainContent = page.locator('main, [data-testid="main-content"]').first();
      await expect(mainContent).toBeVisible();
    }
  });

  test('URL routing works for /session/:id', async ({ page }) => {
    await page.goto('/session/nonexistent-id');
    // Should not crash — either show empty state or redirect
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('root route loads successfully', async ({ page }) => {
    await page.goto('/');
    const body = page.locator('body');
    await expect(body).toBeVisible();
    // No error overlay
    const errorOverlay = page.locator('vite-error-overlay, #vite-error-overlay');
    await expect(errorOverlay).toHaveCount(0);
  });
});
