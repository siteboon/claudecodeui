/**
 * ZCode Protocol Client (facade)
 *
 * Manages communication with the ZCode app-server subprocess. This facade
 * composes the three protocol modules and preserves the original singleton
 * consumption surface:
 * - `zcode-codec.ts`: pure protocol envelopes, parsing, and encoding
 * - `zcode-engine-supervisor.ts`: subprocess lifecycle (startup, crash
 *   detection, restart circuit breaker, graceful shutdown)
 * - `zcode-request-router.ts`: request correlation, engine-callback policy,
 *   and session event routing
 *
 * Lifecycle rules:
 * - Construction is side-effect free: the engine path is resolved lazily on
 *   the first request, so importing this module never fails on machines
 *   without ZCode installed (integration plan §3.2.4).
 * - Shutdown is driven exclusively by the server's shutdown flow
 *   (`shutdownZCodeRuntime`); the client never installs its own signal
 *   handlers or calls `process.exit`.
 * - When the engine crashes, in-flight requests fail and every registered
 *   session listener receives a synthetic `zcode:session/lost` notification
 *   so waiting runs can fail fast instead of timing out.
 *
 * @module zcode-protocol.client
 */

import type { SessionEventListener } from './zcode-codec.js';
import { EngineSupervisor } from './zcode-engine-supervisor.js';
import { RequestRouter } from './zcode-request-router.js';

export {
  parseProtocolLine,
  SESSION_LOST_METHOD,
  type ProtocolMessage,
  type ProtocolNotification,
  type ProtocolRequest,
  type ProtocolResponse,
  type ProtocolServerRequest,
  type SessionEventListener,
} from './zcode-codec.js';

/**
 * ZCode Protocol Client - singleton facade over the supervisor and router.
 *
 * Consumers: zcode runtime provider (sendRequest + session listeners) and
 * `shutdownZCodeRuntime` in the zcode provider (shutdown).
 */
class ZCodeProtocolClient {
  /** Singleton instance */
  private static instance: ZCodeProtocolClient | null = null;

  private readonly supervisor = new EngineSupervisor();
  private readonly router: RequestRouter;

  /**
   * Gets the singleton protocol client instance. Construction performs no
   * filesystem access and never throws.
   */
  static getInstance(): ZCodeProtocolClient {
    if (!ZCodeProtocolClient.instance) {
      ZCodeProtocolClient.instance = new ZCodeProtocolClient();
    }
    return ZCodeProtocolClient.instance;
  }

  private constructor() {
    this.router = new RequestRouter({
      ensureRunning: () => this.supervisor.ensureRunning(),
      writeLine: (line: string) => this.supervisor.writeLine(line),
    });

    this.supervisor.onLine((line) => this.router.handleLine(line));

    // Engine crash: fail in-flight requests and tell every waiting session
    // that its engine-side session is gone.
    this.supervisor.onCrash(({ code, signal }) => {
      this.router.failAllPending(new Error('ZCode process terminated unexpectedly'));
      this.router.notifySessionLost(code, signal);
    });
  }

  /**
   * Sends a protocol request and returns the response.
   *
   * @param method - Protocol method name
   * @param params - Method parameters
   * @param timeout - Request timeout in milliseconds (0 for no timeout: use
   *   for `session/send`, whose result arrives on the event stream)
   */
  async sendRequest<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeout?: number,
  ): Promise<T> {
    return this.router.request<T>(method, params, timeout);
  }

  /**
   * Registers a listener for one ZCode session's events.
   */
  addSessionListener(sessionId: string, listener: SessionEventListener): void {
    this.router.addSessionListener(sessionId, listener);
  }

  /**
   * Removes one listener registration (same function identity).
   */
  removeSessionListener(sessionId: string, listener: SessionEventListener): void {
    this.router.removeSessionListener(sessionId, listener);
  }

  /**
   * Graceful shutdown orchestrated by the server shutdown flow. Cancels any
   * scheduled restart, fails in-flight requests, and stops the engine.
   */
  async shutdown(): Promise<void> {
    this.router.failAllPending(new Error('Client is shutting down'));
    await this.supervisor.shutdown();
  }
}

/**
 * Singleton protocol client shared by every ZCode session.
 * Consumers: zcode runtime provider and `shutdownZCodeRuntime` in the zcode
 * provider barrel.
 */
export const protocolClient = ZCodeProtocolClient.getInstance();
