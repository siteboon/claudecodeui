/**
 * Smoke spec 03 — Open session → history
 *
 * Clicks the first project in the rail, then clicks the first session in the
 * sidebar session list, and asserts that at least one historical message
 * renders in the chat pane.
 *
 * MessageComponent renders `.chat-message` elements for every message.
 * FlatSessionItem renders a `button.flex.w-full.items-center` per session.
 */

import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from '../fixtures.js';

test('first session shows historical messages in chat pane', async ({ page }) => {
  await ensureLoggedIn(page);

  // Click the first project item (index 1 skips the "All projects" button)
  const railButtons = page.locator('.w-rail button');
  await railButtons.nth(1).click();

  // FlatSessionItem renders a button with classes: flex w-full items-center gap-2.5 rounded-md
  // We find the first such button in the sidebar (outside the rail).
  // The sidebar panel sits beside the rail; session buttons are inside it.
  const sessionButton = page
    .locator('button.flex.w-full')
    .first();

  await sessionButton.waitFor({ state: 'visible', timeout: 5_000 });
  await sessionButton.click();

  // At least one .chat-message must render in the chat pane
  await expect(page.locator('.chat-message').first()).toBeVisible({ timeout: 10_000 });
});
