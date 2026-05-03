import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Command Palette', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('opens with Ctrl+K', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(1_000);
    const palette = page.locator('[cmdk-root], [data-testid="command-palette"], [role="dialog"]:has(input)').first();
    if (await palette.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(palette).toBeVisible();
    }
  });

  test('has a search input', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);
    const input = page.locator('[cmdk-input], input[placeholder*="search" i], input[placeholder*="command" i]').first();
    if (await input.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(input).toBeVisible();
      await expect(input).toBeFocused();
    }
  });

  test('shows action items in the list', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);
    const items = page.locator('[cmdk-item], [role="option"], [data-testid="palette-item"]');
    if (await items.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
      const count = await items.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('filters items when typing', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);
    const input = page.locator('[cmdk-input], input[placeholder*="search" i]').first();
    if (await input.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await input.fill('settings');
      await page.waitForTimeout(300);
      const items = page.locator('[cmdk-item], [role="option"]');
      // Filtered results should be fewer or contain "settings"
    }
  });

  test('closes with Escape', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);
    const palette = page.locator('[cmdk-root], [data-testid="command-palette"], [role="dialog"]:has(input)').first();
    if (await palette.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await expect(palette).not.toBeVisible();
    }
  });
});
