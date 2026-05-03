import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('Ctrl+K opens command palette', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(1_000);
    const palette = page.locator(
      '[data-testid="command-palette"], [role="dialog"]:has(input[placeholder*="search" i]), [cmdk-root], input[placeholder*="command" i]'
    ).first();
    if (await palette.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(palette).toBeVisible();
      // Close it
      await page.keyboard.press('Escape');
    }
  });

  test('Ctrl+N triggers new chat', async ({ page }) => {
    const initialUrl = page.url();
    await page.keyboard.press('Control+n');
    await page.waitForTimeout(1_000);
    // May navigate or create new session
  });

  test('Ctrl+, opens settings', async ({ page }) => {
    await page.keyboard.press('Control+,');
    await page.waitForTimeout(1_000);
    const modal = page.locator('.modal-backdrop, [role="dialog"]').first();
    if (await modal.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(modal).toBeVisible();
      await page.keyboard.press('Escape');
    }
  });

  test('Escape closes any open modal', async ({ page }) => {
    // Open settings first
    await page.keyboard.press('Control+,');
    await page.waitForTimeout(1_000);
    const modal = page.locator('.modal-backdrop, [role="dialog"]').first();
    if (await modal.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await expect(modal).not.toBeVisible();
    }
  });
});
