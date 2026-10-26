import type { RealtimeClientConnection } from '@/shared/types.js';

/**
 * Numeric readyState for an open WebSocket connection.
 *
 * We keep this in module state so services that broadcast updates do not need
 * to import `ws` directly just to compare open/closed state.
 */
export const WS_OPEN_STATE = 1;

/**
 * Shared registry of active chat WebSocket connections.
 *
 * Project/session services publish realtime updates by iterating this set.
 */
export const connectedClients = new Set<RealtimeClientConnection>();

/**
 * Sends one or more already-serialized payloads to every connected chat
 * client, walking `connectedClients` exactly once regardless of how many
 * payloads are given (a batch of session-upsert deltas sends all of them to
 * a client before moving to the next, rather than re-walking the set per
 * payload).
 *
 * The single producer of fan-out broadcasts in this module: the session
 * upsert broadcaster, the `chat.btw` socket handler and the side-questions
 * dismiss route all used to walk `connectedClients` themselves with the same
 * loop. Consumed through `@/modules/websocket/index.js` by
 * `session-upsert-broadcast.service.ts` and by the providers module's
 * `side-questions.service.ts` (as the default `notify` for `ask`/`dismiss`).
 */
export function broadcastToConnectedClients(payload: string | string[]): void {
  const payloads = Array.isArray(payload) ? payload : [payload];
  if (payloads.length === 0) {
    return;
  }

  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      for (const item of payloads) {
        client.send(item);
      }
    }
  });
}
