/**
 * Smoke spec 05 — No-forget on input during WS disconnect
 *
 * Types a prompt into the chat composer, programmatically closes the
 * underlying WebSocket, then submits the message.  Asserts that the
 * typed text is preserved in the textarea (or queued) — i.e. not
 * silently dropped.
 *
 * The WebSocketContext queues outbound sends while the socket is closed
 * (pendingSendQueueRef) and flushes them on reconnect.  This spec verifies
 * that the input survives the gap.
 *
 * Mechanism to close the socket from the page:
 *   At page initialisation we patch `window.WebSocket` to capture every
 *   created socket onto `window.__wsList`.  After auth and page load, we
 *   call `ws.close()` on the captured app socket from the test.
 *
 * If the code DROPS the input today, the spec asserts the bug —
 * that's acceptable for a smoke test, not a fix.
 */

import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from '../fixtures.js';

test.setTimeout(60_000);

test('input is preserved after WS disconnect', async ({ page }) => {
  // Patch WebSocket at init so we can capture and close the app socket later.
  // The patch is scoped to this page's JavaScript context and is automatically
  // torn down when the page is closed — no cross-spec leakage.
  await page.addInitScript(() => {
    (window as any).__wsList = [];
    const OriginalWebSocket = window.WebSocket;
    // @ts-ignore
    window.WebSocket = function (url: string, protocols?: string | string[]) {
      const ws = new OriginalWebSocket(url, protocols);
      (window as any).__wsList.push(ws);
      return ws;
    };
    // @ts-ignore
    window.WebSocket.prototype = OriginalWebSocket.prototype;
    Object.assign(window.WebSocket, OriginalWebSocket);
    // Expose a restore handle so the test can undo the patch before navigation
    (window as any).__restoreWebSocket = () => {
      window.WebSocket = OriginalWebSocket;
    };
  });

  await ensureLoggedIn(page);

  // Close any open modal
  if (await page.locator('.bg-black\\/50').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // Click the first session in the flat list
  const sessionButtons = page.locator('button.flex.w-full');
  await sessionButtons.first().waitFor({ state: 'visible', timeout: 5_000 });
  await sessionButtons.first().click();

  const textarea = page.locator('textarea').first();
  await textarea.waitFor({ state: 'visible', timeout: 10_000 });

  const prompt = 'hello from disconnected state';

  // Snapshot bubble count before we do anything so the delta is spec-local
  // (prevents false-pass from bubbles left by earlier specs in the same run).
  const bubblesBefore = await page.locator('.chat-message.user').count();

  // Type the prompt into the composer
  await textarea.fill(prompt);

  // Verify it's there before the disconnect
  await expect(textarea).toHaveValue(prompt);

  // Close all captured WebSockets to simulate a disconnect
  await page.evaluate(() => {
    const sockets: WebSocket[] = (window as any).__wsList ?? [];
    for (const ws of sockets) {
      try { ws.close(); } catch { /* ignore */ }
    }
  });

  // Small pause so the React onclose handler fires (sets isConnected=false)
  await page.waitForTimeout(200);

  // Submit the message while disconnected — the context should queue it
  await textarea.press('Enter');

  // Restore the WebSocket prototype so subsequent specs or navigation within
  // this page are not affected by the wrapper.
  await page.evaluate(() => {
    if (typeof (window as any).__restoreWebSocket === 'function') {
      (window as any).__restoreWebSocket();
    }
  });

  // Assert: the queued-message feature must demonstrably work for THIS
  // specific prompt text.  We accept three distinct evidence forms:
  //
  //   (a) textarea still holds the exact prompt — WS send was queued and the
  //       app is waiting to flush; OR
  //   (b) a data-pending-send indicator is present — the app acknowledged the
  //       queue visually; OR
  //   (c) after reconnect, a user bubble containing the exact prompt text
  //       appears within 10s — the message was flushed and rendered.
  //
  // Accepting "any bubble" (bubblesAfter >= 1) would pass even if the feature
  // is completely broken as long as earlier specs left a bubble behind.

  const textareaValueAfter = await textarea.inputValue();

  // Check (a)
  if (textareaValueAfter === prompt) {
    // Input preserved — queue mechanism held the text.
    return;
  }

  // Check (b) — give React up to 1s to flush the pendingSendCount state update
  // and re-render the indicator. An immediate .isVisible() races with the render.
  const pendingSendIndicator = page.locator('[data-pending-send="true"]');
  const indicatorAppeared = await pendingSendIndicator
    .waitFor({ state: 'visible', timeout: 1000 })
    .then(() => true)
    .catch(() => false);
  if (indicatorAppeared) {
    return;
  }

  // Check (c) — wait up to 10s for the specific prompt to appear as a user bubble
  const specificBubble = page.locator('.chat-message.user', { hasText: prompt });
  await expect(specificBubble, `queued message "${prompt}" never appeared after reconnect`).toBeVisible({ timeout: 10_000 });
});
