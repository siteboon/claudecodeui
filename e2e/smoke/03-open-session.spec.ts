/**
 * Smoke spec 03 — Open session → history
 *
 * After auth the sidebar already shows the flat session list.  We click the
 * first session button (which may be under any project) and assert that at
 * least one historical message renders in the chat pane.
 *
 * MessageComponent renders `.chat-message` elements for every message.
 * FlatSessionItem renders a button with text content matching
 * "<path> · <age> <summary>".
 */

import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from '../fixtures.js';

test('first session shows historical messages in chat pane', async ({ page }) => {
  await ensureLoggedIn(page);

  // Close any open modal/dialog first (e.g. Create New Project wizard)
  const backdrop = page.locator('.fixed.inset-0.z-\\[60\\], [class*="z-[60]"]').first();
  if (await backdrop.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // Session buttons are directly visible in the sidebar flat list.
  // FlatSessionItem renders: button.flex.w-full.items-center.gap-2.5
  // We pick the first one that has a non-empty text label (not a utility button).
  const sessionButtons = page.locator('button.flex.w-full');
  await sessionButtons.first().waitFor({ state: 'visible', timeout: 5_000 });

  // Click the first session
  await sessionButtons.first().click();

  // At least one .chat-message must render in the chat pane
  await expect(page.locator('.chat-message').first()).toBeVisible({ timeout: 10_000 });
});
