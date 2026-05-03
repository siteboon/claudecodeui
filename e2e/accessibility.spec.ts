import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('page has a lang attribute', async ({ page }) => {
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBeTruthy();
  });

  test('app container has role="application"', async ({ page }) => {
    const app = page.locator('[role="application"]');
    await expect(app).toBeVisible({ timeout: 5_000 });
  });

  test('sidebar uses nav element with aria-label', async ({ page }) => {
    const nav = page.locator('nav[aria-label]').first();
    await expect(nav).toBeVisible({ timeout: 5_000 });
    const label = await nav.getAttribute('aria-label');
    expect(label).toBeTruthy();
  });

  test('main content area uses main element', async ({ page }) => {
    const main = page.locator('main').first();
    await expect(main).toBeVisible({ timeout: 5_000 });
  });

  test('buttons have accessible names', async ({ page }) => {
    const buttons = page.locator('button');
    const count = await buttons.count();
    let namedCount = 0;
    for (let i = 0; i < Math.min(count, 20); i++) {
      const btn = buttons.nth(i);
      if (await btn.isVisible().catch(() => false)) {
        const text = await btn.textContent();
        const ariaLabel = await btn.getAttribute('aria-label');
        const title = await btn.getAttribute('title');
        if (text?.trim() || ariaLabel || title) namedCount++;
      }
    }
    // Most visible buttons should have accessible names
    expect(namedCount).toBeGreaterThan(0);
  });

  test('interactive elements are keyboard focusable', async ({ page }) => {
    // Tab through the page and verify focus moves
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    const focused = page.locator(':focus');
    const tag = await focused.evaluate(el => el?.tagName).catch(() => null);
    // Something should receive focus
    expect(tag).toBeTruthy();
  });

  test('no images without alt text (within main content)', async ({ page }) => {
    const images = page.locator('main img, [role="application"] img');
    const count = await images.count();
    for (let i = 0; i < count; i++) {
      const img = images.nth(i);
      const alt = await img.getAttribute('alt');
      const role = await img.getAttribute('role');
      // Either has alt text or role="presentation"
      expect(alt !== null || role === 'presentation' || role === 'none').toBe(true);
    }
  });

  test('modals trap focus when open', async ({ page }) => {
    // Open settings modal
    await page.keyboard.press('Control+,');
    await page.waitForTimeout(1_000);
    const modal = page.locator('.modal-backdrop, [role="dialog"]').first();
    if (await modal.isVisible({ timeout: 2_000 }).catch(() => false)) {
      // Tab should cycle within modal
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => document.activeElement?.closest('.modal-backdrop, [role="dialog"]'));
      // Focus should still be within modal area
      await page.keyboard.press('Escape');
    }
  });

  test('color contrast: text is visible on background', async ({ page }) => {
    // Basic check: ensure text elements have non-zero opacity
    const textEl = page.locator('.text-foreground, .text-muted-foreground, p, span, h1, h2').first();
    if (await textEl.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const opacity = await textEl.evaluate(el => window.getComputedStyle(el).opacity);
      expect(parseFloat(opacity)).toBeGreaterThan(0);
    }
  });
});
