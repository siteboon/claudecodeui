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

  // Close any open modal
  const backdrop = page.locator('.fixed.inset-0').filter({ has: page.locator('.bg-black\\/50') }).first();
  if (await backdrop.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // Click the first session in the flat list
  const sessionButtons = page.locator('button.flex.w-full');
  await sessionButtons.first().waitFor({ state: 'visible', timeout: 5_000 });
  await sessionButtons.first().click();

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
