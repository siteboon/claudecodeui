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
  // Patch WebSocket at init so we can capture and close the app socket later
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

  // Assert: either the textarea still holds the value (send was queued but
  // value not cleared by the app before reconnect), OR the textarea is now
  // empty meaning the message was accepted into the outbound queue.
  // Either outcome is acceptable — what we DON'T want is the input
  // vanishing silently with no visible indicator and no queue entry.
  //
  // Check the outbound-queue: the context's pendingSendQueueRef stores the
  // payload.  We can't inspect React refs from outside, so we verify the
  // user-visible state instead: if textarea was cleared, a user message
  // bubble should appear in the chat pane (even if assistant reply hasn't
  // come yet).
  const textareaValueAfter = await textarea.inputValue();
  const userBubbleCount = await page.locator('.chat-message.user').count();

  const inputPreservedOrQueued = textareaValueAfter === prompt || userBubbleCount > 0;

  expect(
    inputPreservedOrQueued,
    'Input was silently dropped: textarea empty AND no user bubble in chat pane',
  ).toBe(true);
});
