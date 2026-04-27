/**
 * Smoke spec 04 — Send message → real WS round-trip → assistant reply
 *
 * Opens the first available session, types a short prompt ("ping"), submits
 * it, and waits for an assistant reply bubble to appear in the chat pane.
 *
 * Real WS, real `claude` subprocess — no mocks.
 * Assertions are DOM-only (assistant bubble appearing).  We never count WS
 * frames because the heartbeat (commit 85d371d) generates periodic pings
 * that would pollute frame counts.
 *
 * 30 s timeout on the assistant-reply assertion: `claude` subprocess latency
 * is the bottleneck.
 */

import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from '../fixtures.js';

test.setTimeout(60_000);

test('send "ping" and receive an assistant reply within 30 s', async ({ page }) => {
  await ensureLoggedIn(page);

  // Navigate to the first project → first session
  const railButtons = page.locator('.w-rail button');
  await railButtons.nth(1).click();

  const sessionButton = page.locator('button.flex.w-full').first();
  await sessionButton.waitFor({ state: 'visible', timeout: 5_000 });
  await sessionButton.click();

  // Wait for the chat textarea to be interactive
  const textarea = page.locator('textarea').first();
  await textarea.waitFor({ state: 'visible', timeout: 10_000 });

  // Count existing assistant messages before sending
  const beforeCount = await page.locator('.chat-message.assistant').count();

  // Type and submit
  await textarea.fill('ping');
  await textarea.press('Enter');

  // Assert a new assistant bubble appears (more than before)
  await expect
    .poll(
      async () => page.locator('.chat-message.assistant').count(),
      { timeout: 30_000, intervals: [500] },
    )
    .toBeGreaterThan(beforeCount);
});
