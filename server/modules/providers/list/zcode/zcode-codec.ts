/**
 * ZCode Protocol Codec
 *
 * Pure protocol knowledge for the line-delimited JSON protocol the ZCode
 * app-server speaks: envelope types, parsing, encoding, and message
 * discrimination. No state, no subprocess access — everything here is
 * directly unit-testable.
 *
 * Protocol Specification (derived from reverse engineering):
 * - Request: { id: number, method: string, params?: AnyRecord }
 * - Response: { id: number, result: unknown } | { id: number, error: { code: number, message: string, data?: unknown } }
 * - Server Request (bidirectional): { id: string ("server-N"), method: string, params?: AnyRecord }.
 *   The engine initiates requests against the client and blocks the
 *   originating client call until it is answered — `session/create` waits on
 *   `session/requestRuntimePreferences` and fails with -32022 after the
 *   engine's 15s timeout if no answer arrives, so EVERY server request must
 *   get a response: { id, result } | { id, error }
 * - Notification: { method: string, params: AnyRecord } (no id field)
 * - Error codes: -32600 (Invalid Request), -32601 (Method not found)
 *
 * @module zcode-codec
 */

import type { AnyRecord } from '@/shared/types.js';

/**
 * Protocol request envelope (line-delimited JSON to stdin).
 */
export type ProtocolRequest = {
  id: number;
  method: string;
  params?: AnyRecord;
};

/**
 * Protocol response envelope (from stdout).
 */
export type ProtocolResponse =
  | { id: number; result: unknown }
  | { id: number; error: { code: number; message: string; data?: unknown } };

/**
 * Protocol notification envelope (no id, async event).
 */
export type ProtocolNotification = {
  method: string;
  params: AnyRecord;
};

/**
 * Protocol server-initiated request envelope (id + method, from stdout).
 *
 * The engine calls back into the client with its own id namespace
 * ("server-1", "server-2", ...) while handling client requests; the client
 * must answer with `{ id, result }` or `{ id, error }` or the originating
 * client request dies with a -32022 timeout after the engine's 15s window.
 */
export type ProtocolServerRequest = {
  id: number | string;
  method: string;
  params?: AnyRecord;
};

/**
 * Any message the engine can put on one stdout line.
 */
export type ProtocolMessage = ProtocolResponse | ProtocolNotification | ProtocolServerRequest;

/**
 * Synthetic notification the client originates when the engine process dies:
 * registered session listeners receive it so a run can fail fast instead of
 * waiting out its completion timeout against a dead engine.
 */
export const SESSION_LOST_METHOD = 'zcode:session/lost';

/**
 * Event listener for session-specific notifications.
 * Consumers: zcode runtime provider (per-run event normalization) and the
 * request router's listener registry.
 */
export type SessionEventListener = (notification: ProtocolNotification) => void;

/**
 * Parses one stdout line into a protocol response, notification, or
 * server-initiated request.
 *
 * Consumers: the request router and
 * `server/modules/providers/tests/zcode-codec.test.ts`.
 * Returns null for empty or malformed lines so callers can skip them.
 */
export function parseProtocolLine(line: string): ProtocolMessage | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const message = JSON.parse(trimmed) as ProtocolMessage;
    if (!message || typeof message !== 'object') {
      return null;
    }
    // Responses carry `id`; notifications carry `method` only.
    if (!('id' in message) && !('method' in message)) {
      return null;
    }
    return message;
  } catch {
    return null;
  }
}

/**
 * Discriminates server-initiated requests: `id` + `method` together.
 */
export function isServerRequest(message: ProtocolMessage): message is ProtocolServerRequest {
  return 'id' in message && 'method' in message;
}

/**
 * Discriminates responses to client-originated requests: `id` alone.
 */
export function isResponse(message: ProtocolMessage): message is ProtocolResponse {
  return 'id' in message && !('method' in message);
}

/**
 * Encodes a client request as one protocol line (with trailing newline).
 */
export function encodeRequest(request: ProtocolRequest): string {
  return `${JSON.stringify(request)}\n`;
}

/**
 * Encodes the answer to a server-initiated request as one protocol line.
 * The envelope keeps the server's own id so the engine can correlate.
 */
export function encodeResponse(
  requestId: number | string,
  payload: { result: unknown } | { error: { code: number; message: string } },
): string {
  return `${JSON.stringify({ id: requestId, ...payload })}\n`;
}

/**
 * Reads the session id a `session/event` notification belongs to.
 * Supports both flat (`params.sessionId`) and nested (`params.event.sessionId`)
 * payload layouts; the exact wrapper was not captured during the Phase 0
 * spike, so both documented shapes are accepted.
 */
export function readNotificationSessionId(params: AnyRecord | undefined): string | null {
  const flat = params?.sessionId;
  if (typeof flat === 'string' && flat) {
    return flat;
  }

  const nested = (params?.event as AnyRecord | undefined)?.sessionId;
  if (typeof nested === 'string' && nested) {
    return nested;
  }

  return null;
}
