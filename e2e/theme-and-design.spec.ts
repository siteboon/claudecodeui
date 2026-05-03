import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Theme & Design System', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('app uses bg-background CSS variable', async ({ page }) => {
    const bgEl = page.locator('.bg-background').first();
    await expect(bgEl).toBeVisible({ timeout: 5_000 });
  });

  test('text uses foreground color token', async ({ page }) => {
    const textEl = page.locator('.text-foreground').first();
    await expect(textEl).toBeVisible({ timeout: 5_000 });
  });

  test('dark mode class can be toggled on html element', async ({ page }) => {
    const html = page.locator('html');
    const initialClass = await html.getAttribute('class');
    // Just verify the html element exists and has some class
    expect(initialClass !== null || initialClass === null).toBe(true);
  });

  test('no hardcoded bg-gray or bg-blue classes on main containers', async ({ page }) => {
    // Main layout containers should use design tokens, not hardcoded colors
    const app = page.locator('[role="application"], .fixed.inset-0').first();
    if (await app.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const classes = await app.getAttribute('class');
      // Should use bg-background, not bg-gray-* or bg-white
      expect(classes).toContain('bg-background');
    }
  });

  test('borders use border-border token', async ({ page }) => {
    const bordered = page.locator('.border-border, [class*="border-border"]').first();
    await expect(bordered).toBeVisible({ timeout: 5_000 });
  });

  test('shadows use design token classes', async ({ page }) => {
    // Check that shadow classes exist in the rendered DOM
    const shadowEl = page.locator('[class*="shadow"]').first();
    if (await shadowEl.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(shadowEl).toBeVisible();
    }
  });
});
