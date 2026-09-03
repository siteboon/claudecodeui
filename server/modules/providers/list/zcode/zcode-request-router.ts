/**
 * ZCode Request Router
 *
 * Protocol correlation on top of a running engine: client request/response
 * correlation with timeouts, server-initiated request answering through an
 * injectable handler, and session event listener routing.
 *
 * The transport (write a line, ensure the engine runs) is injected, so the
 * router owns no process lifecycle. Product semantics — how to answer the
 * engine's callbacks — are injected too: the default handler answers
 * `session/requestRuntimePreferences` and returns an explicit -32601 for
 * everything else.
 *
 * @module zcode-request-router
 */

import { setTimeout as setTimeoutFn, clearTimeout as clearTimeoutFn } from 'node:timers';

import type { AnyRecord } from '@/shared/types.js';

import {
  encodeRequest,
  encodeResponse,
  isResponse,
  isServerRequest,
  parseProtocolLine,
  readNotificationSessionId,
  SESSION_LOST_METHOD,
  type ProtocolMessage,
  type ProtocolNotification,
  type ProtocolServerRequest,
  type SessionEventListener,
} from './zcode-codec.js';

/**
 * Router tunables.
 */
export type RequestRouterOptions = {
  defaultTimeoutMs?: number;
};

/**
 * The transport surface the router needs from the engine supervisor.
 */
export type RouterTransport = {
  ensureRunning: () => Promise<void>;
  writeLine: (line: string) => void;
};

/**
 * Answer for one server-initiated request.
 */
export type ServerRequestAnswer = { result: unknown } | { error: { code: number; message: string } };

/**
 * Decides how to answer the engine's callback requests.
 *
 * Every request MUST be answered: the engine blocks the client call that
 * triggered it (e.g. `session/create` waits on
 * `session/requestRuntimePreferences`) until a response arrives or its own
 * 15s timeout rejects the client call with -32022.
 */
export type ServerRequestHandler = (request: ProtocolServerRequest) => ServerRequestAnswer | Promise<ServerRequestAnswer>;

/**
 * The default engine-callback policy, extracted from the original client.
 *
 * `session/requestRuntimePreferences` gets the minimal viable preferences
 * validated by the Phase 0.1 spike (docs/phase0-1-findings.md §5). Unsupported
 * engine callbacks get an explicit method-not-found error rather than silence
 * or an empty result: the engine recognizes -32601 as "client does not
 * implement this" and applies its own fallbacks, while an empty `{}` result
 * could be misread as approval for interaction/* requests.
 */
export function defaultServerRequestHandler(request: ProtocolServerRequest): ServerRequestAnswer {
  if (request.method === 'session/requestRuntimePreferences') {
    return { result: { nativeSearchEnhancementsEnabled: false } };
  }

  return { error: { code: -32601, message: `Method not found: ${request.method}` } };
}

/**
 * Response wrapper for internal pending request management.
 */
type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout | null;
};

/**
 * Correlates client requests with responses and routes engine events.
 *
 * Consumers: the zcode protocol client facade (the only production consumer)
 * and `server/modules/providers/tests/zcode-request-router.test.ts`.
 */
export class RequestRouter {
  private readonly defaultTimeoutMs: number;
  private readonly transport: RouterTransport;

  private requestId = 0;
  private readonly pendingRequests: Map<number, PendingRequest> = new Map();
  private readonly sessionListeners: Map<string, SessionEventListener[]> = new Map();

  private serverRequestHandler: ServerRequestHandler = defaultServerRequestHandler;

  constructor(transport: RouterTransport, options: RequestRouterOptions = {}) {
    this.transport = transport;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30000;
  }

  /**
   * Replaces the engine-callback policy. Tests inject stubs; production keeps
   * the default.
   */
  setServerRequestHandler(handler: ServerRequestHandler): void {
    this.serverRequestHandler = handler;
  }

  /**
   * Sends a protocol request and returns the response.
   *
   * @param method - Protocol method name
   * @param params - Method parameters
   * @param timeout - Request timeout in milliseconds (0 for no timeout: use
   *   for `session/send`, whose result arrives on the event stream)
   * @returns Promise that resolves with the result or rejects with error
   */
  async request<T = unknown>(
    method: string,
    params: AnyRecord = {},
    timeout: number = this.defaultTimeoutMs,
  ): Promise<T> {
    await this.transport.ensureRunning();

    const id = ++this.requestId;
    const request = { id, method, params };

    return new Promise<T>((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | null = null;
      if (timeout > 0) {
        timeoutHandle = setTimeoutFn(() => {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout after ${timeout}ms: ${method}`));
        }, timeout);
      }

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout: timeoutHandle,
      });

      this.transport.writeLine(encodeRequest(request));
    });
  }

  /**
   * Feeds one complete stdout line from the engine through the codec and
   * dispatches it (server request, response, or notification).
   */
  handleLine(line: string): void {
    const message: ProtocolMessage | null = parseProtocolLine(line);
    if (!message) {
      console.warn(`[ZCode Protocol] Failed to parse stdout line: ${line.slice(0, 100)}`);
      return;
    }

    if (isServerRequest(message)) {
      void this.handleServerRequest(message);
    } else if (isResponse(message)) {
      this.handleResponse(message);
    } else {
      this.handleNotification(message as ProtocolNotification);
    }
  }

  /**
   * Rejects every in-flight request (engine crash or shutdown).
   */
  failAllPending(reason: Error): void {
    for (const pending of this.pendingRequests.values()) {
      if (pending.timeout) clearTimeoutFn(pending.timeout);
      pending.reject(reason);
    }
    this.pendingRequests.clear();
  }

  /**
   * Notifies every registered session listener that the engine connection was
   * lost, with a synthetic per-session notification. Runs waiting runs fail
   * fast instead of timing out against an engine that no longer knows their
   * sessions.
   */
  notifySessionLost(code: number | null, signal: NodeJS.Signals | null): void {
    for (const [sessionId, listeners] of this.sessionListeners) {
      for (const listener of listeners) {
        try {
          listener({
            method: SESSION_LOST_METHOD,
            params: { sessionId, code, signal },
          });
        } catch (error) {
          console.error(`[ZCode Protocol] Session-lost listener error for ${sessionId}:`, error);
        }
      }
    }
  }

  /**
   * Registers a listener for one ZCode session's events.
   */
  addSessionListener(sessionId: string, listener: SessionEventListener): void {
    const listeners = this.sessionListeners.get(sessionId) ?? [];
    listeners.push(listener);
    this.sessionListeners.set(sessionId, listeners);
  }

  /**
   * Removes one listener registration; the listener identity must be the
   * same function that was registered.
   */
  removeSessionListener(sessionId: string, listener: SessionEventListener): void {
    const listeners = this.sessionListeners.get(sessionId);
    if (!listeners) {
      return;
    }
    const next = listeners.filter((registered) => registered !== listener);
    if (next.length > 0) {
      this.sessionListeners.set(sessionId, next);
    } else {
      this.sessionListeners.delete(sessionId);
    }
  }

  private async handleServerRequest(request: ProtocolServerRequest): Promise<void> {
    console.debug(`[ZCode Protocol] Received server request: ${request.method}`);

    let answer: ServerRequestAnswer;
    try {
      answer = await this.serverRequestHandler(request);
    } catch (error) {
      answer = {
        error: {
          code: -32603,
          message: `Server request handler failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }

    this.transport.writeLine(encodeResponse(request.id, answer));
  }

  private handleResponse(response: { id: number; result?: unknown; error?: { code: number; message: string; data?: unknown } }): void {
    const pending = this.pendingRequests.get(response.id);

    if (!pending) {
      console.warn(`[ZCode Protocol] Received response for unknown request id: ${response.id}`);
      return;
    }

    if (pending.timeout) {
      clearTimeoutFn(pending.timeout);
    }

    this.pendingRequests.delete(response.id);

    if ('error' in response && response.error) {
      const error = new Error(response.error.message);
      (error as AnyRecord).code = response.error.code;
      (error as AnyRecord).data = response.error.data;
      pending.reject(error);
    } else {
      pending.resolve(response.result);
    }
  }

  private handleNotification(notification: ProtocolNotification): void {
    console.debug(`[ZCode Protocol] Received notification: ${notification.method}`);

    if (notification.method === 'session/event') {
      const sessionId = readNotificationSessionId(notification.params);
      if (sessionId) {
        this.routeSessionEvent(sessionId, notification);
      }
    }
  }

  private routeSessionEvent(sessionId: string, notification: ProtocolNotification): void {
    const listeners = this.sessionListeners.get(sessionId);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(notification);
        } catch (error) {
          console.error(`[ZCode Protocol] Session event listener error for ${sessionId}:`, error);
        }
      }
    }
  }
}
