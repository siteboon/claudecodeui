import { WebSocket } from 'ws';

import { browserUseService } from '@/modules/browser-use/index.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

// Frames are skipped (not queued) while the client is this far behind, so a slow link stays live.
const MAX_BUFFERED_BYTES = 1_000_000;

type BrowserUseClientMessage =
  | { type: 'click'; x: number; y: number; button: 'left' | 'right' | 'middle'; clickCount: number }
  | { type: 'scroll'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'text'; text: string }
  | { type: 'key'; key: string }
  | { type: 'copy' };

function parseClientMessage(raw: string): BrowserUseClientMessage | null {
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (body.type === 'click' && Number.isFinite(body.x) && Number.isFinite(body.y)) {
      const button = body.button === 'right' || body.button === 'middle' ? body.button : 'left';
      const clickCount = Number.isInteger(body.clickCount) ? Math.max(1, Math.min(3, Number(body.clickCount))) : 1;
      return { type: 'click', x: Number(body.x), y: Number(body.y), button, clickCount };
    }
    if (body.type === 'scroll' && Number.isFinite(body.x) && Number.isFinite(body.y)
      && Number.isFinite(body.deltaX) && Number.isFinite(body.deltaY)) {
      return {
        type: 'scroll',
        x: Number(body.x),
        y: Number(body.y),
        deltaX: Math.max(-5000, Math.min(5000, Number(body.deltaX))),
        deltaY: Math.max(-5000, Math.min(5000, Number(body.deltaY))),
      };
    }
    if (body.type === 'text' && typeof body.text === 'string' && body.text.length > 0 && body.text.length <= 2000) {
      return { type: 'text', text: body.text };
    }
    if (body.type === 'copy') {
      return { type: 'copy' };
    }
    if (body.type === 'key' && typeof body.key === 'string' && body.key.length > 0 && body.key.length <= 32) {
      return { type: 'key', key: body.key };
    }
  } catch {
    // Ignore malformed messages.
  }
  return null;
}

/**
 * Serves `/browser-use?sessionId=...`: pushes live JPEG frames of an agent Browser session as binary
 * messages and accepts click/text/key input as JSON. Used by the Browser panel for live viewing.
 */
export async function handleBrowserUseConnection(ws: WebSocket, request: AuthenticatedWebSocketRequest): Promise<void> {
  const sessionId = new URL(request.url ?? '/', 'http://localhost').searchParams.get('sessionId') ?? '';
  let stop: (() => Promise<void>) | null = null;
  let closed = false;

  const cleanup = () => {
    closed = true;
    const stopStream = stop;
    stop = null;
    void stopStream?.();
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);

  // Messages are handled one at a time so keystrokes (and a copy that precedes a cut) keep their order.
  let queue: Promise<void> = Promise.resolve();
  const sendError = (error: unknown) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Input failed.' }));
    }
  };

  ws.on('message', (data) => {
    const message = parseClientMessage(data.toString());
    if (!message) {
      return;
    }
    queue = queue.then(async () => {
      try {
        if (message.type === 'copy') {
          const text = await browserUseService.readSelectedText(sessionId);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'clipboard', text }));
          }
          return;
        }
        await browserUseService.userInput(sessionId, message, { refreshScreenshot: false });
      } catch (error) {
        sendError(error);
      }
    });
  });

  try {
    const stopStream = await browserUseService.startScreencast(sessionId, (frame) => {
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED_BYTES) {
        return;
      }
      ws.send(frame, { binary: true });
    });
    if (closed) {
      await stopStream();
      return;
    }
    stop = stopStream;
    ws.send(JSON.stringify({ type: 'ready' }));
  } catch (error) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Stream failed.' }));
      ws.close();
    }
  }
}
