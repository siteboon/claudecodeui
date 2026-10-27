import { WebSocket, type RawData } from 'ws';

import { parseIncomingJsonObject } from '@/shared/utils.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

import { browserViewService, createTokenBucket } from './browser-view.service.js';

/**
 * Connection handler for the `/browser-view` WebSocket path: signaling and
 * viewer input for the live browser view. Frames flow as binary messages from
 * the view service; this handler only owns the JSON control protocol, per-
 * message re-authentication, and connection cleanup.
 */

/** Rejects any inbound control message above this size; view frames only travel server → client. */
const MAX_MESSAGE_BYTES = 16 * 1024;
/** Caps the aggregate control-message rate per connection (subscribe floods, malformed JSON floods). */
const MAX_MESSAGES_PER_SECOND = 60;

type BrowserViewAuthDependencies = {
  isPlatform: boolean;
  authenticateWebSocket: (token: string | null) => {
    id?: string | number;
    userId?: string | number;
    username?: string;
    [key: string]: unknown;
  } | null;
};

type BrowserViewConnectionState = {
  token: string | null;
  activeSubscriptionId: number | null;
  messageBucket: ReturnType<typeof createTokenBucket>;
};

function sendJson(ws: WebSocket, message: Record<string, unknown>): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // Socket teardown is handled by the close listener.
  }
}

function readUpgradeToken(request: AuthenticatedWebSocketRequest): string | null {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    return url.searchParams.get('token');
  } catch {
    return null;
  }
}

/**
 * Re-runs the same authentication the gateway applied at upgrade time for
 * every state-changing message, so a token revoked mid-connection cuts off
 * viewing and input injection immediately instead of at the next reconnect.
 */
function resolveUser(state: BrowserViewConnectionState, auth: BrowserViewAuthDependencies) {
  if (auth.isPlatform) {
    return auth.authenticateWebSocket(null);
  }
  return auth.authenticateWebSocket(state.token);
}

/**
 * Handles one `/browser-view` connection. Wired by the websocket module's
 * gateway, which has already authenticated the upgrade request.
 */
export function handleBrowserViewConnection(
  ws: WebSocket,
  request: AuthenticatedWebSocketRequest,
  auth: BrowserViewAuthDependencies,
): void {
  const state: BrowserViewConnectionState = {
    token: readUpgradeToken(request),
    activeSubscriptionId: null,
    messageBucket: createTokenBucket(MAX_MESSAGES_PER_SECOND, MAX_MESSAGES_PER_SECOND),
  };

  const cleanup = () => {
    browserViewService.unsubscribeSocket(ws);
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);

  ws.on('message', (data: RawData, isBinary: boolean) => {
    // Only the JSON control protocol arrives on this path; binary is never accepted from viewers.
    if (isBinary) {
      sendJson(ws, { type: 'view_error', code: 'invalid_message', message: 'Binary messages are not supported.' });
      return;
    }

    const size = typeof data === 'string'
      ? Buffer.byteLength(data)
      : Array.isArray(data)
        ? data.reduce((total, chunk) => total + chunk.length, 0)
        : data.byteLength;
    if (size > MAX_MESSAGE_BYTES) {
      sendJson(ws, { type: 'view_error', code: 'message_too_large', message: 'Browser view message too large.' });
      return;
    }
    if (!state.messageBucket.take()) {
      return;
    }

    const message = parseIncomingJsonObject(data);
    if (!message || typeof message.type !== 'string') {
      sendJson(ws, { type: 'view_error', code: 'invalid_message', message: 'Invalid browser view message.' });
      return;
    }

    // Every state-changing message re-authenticates against the stored token.
    const user = resolveUser(state, auth);
    if (!user) {
      sendJson(ws, { type: 'view_error', code: 'unauthorized', message: 'Authentication expired.' });
      ws.close(4001, 'unauthorized');
      return;
    }

    void handleControlMessage(ws, state, message);
  });
}

async function handleControlMessage(
  ws: WebSocket,
  state: BrowserViewConnectionState,
  message: Record<string, unknown>,
): Promise<void> {
  switch (message.type) {
    case 'view_subscribe': {
      const sessionId = message.sessionId;
      if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 64) {
        sendJson(ws, { type: 'view_error', code: 'invalid_session', message: 'Invalid browser session id.' });
        return;
      }

      // One active subscription per connection: switching sessions replaces the previous one explicitly.
      if (state.activeSubscriptionId !== null) {
        browserViewService.unsubscribe(state.activeSubscriptionId);
        state.activeSubscriptionId = null;
      }

      const result = await browserViewService.subscribe(sessionId, ws);
      if ('error' in result) {
        sendJson(ws, { type: 'view_error', code: result.error, message: result.message });
        return;
      }
      state.activeSubscriptionId = result.subscriptionId;
      return;
    }

    case 'view_unsubscribe': {
      if (state.activeSubscriptionId !== null) {
        browserViewService.unsubscribe(state.activeSubscriptionId);
        state.activeSubscriptionId = null;
      }
      return;
    }

    case 'view_input': {
      if (state.activeSubscriptionId === null) {
        sendJson(ws, { type: 'view_error', code: 'not_subscribed', message: 'No active browser view subscription.' });
        return;
      }
      const result = await browserViewService.dispatchInput(state.activeSubscriptionId, message.input);
      if ('error' in result && result.error !== 'rate_limited') {
        // Rate-limit notices stay silent: the client throttles too, and echoing
        // them back would amplify traffic during interaction bursts.
        sendJson(ws, { type: 'view_error', code: result.error, message: result.message });
      }
      return;
    }

    default:
      sendJson(ws, { type: 'view_error', code: 'invalid_message', message: 'Unknown browser view message.' });
  }
}
