/**
 * ZCode Protocol Client
 *
 * Manages communication with the ZCode app-server subprocess using line-delimited JSON protocol.
 * This module handles process lifecycle, protocol encoding/decoding, request correlation,
 * event routing, and automatic recovery.
 *
 * Protocol Specification (derived from reverse engineering):
 * - Format: Line-delimited JSON (not JSON-RPC 2.0)
 * - Request: { id: number, method: string, params?: AnyRecord }
 * - Response: { id: number, result: unknown } | { id: number, error: { code: number, message: string, data?: unknown } }
 * - Notification: { method: string, params: AnyRecord } (no id field)
 * - Error codes: -32600 (Invalid Request), -32601 (Method not found)
 *
 * Lifecycle rules:
 * - Construction is side-effect free: the engine path is resolved lazily on
 *   the first request, so importing this module never fails on machines
 *   without ZCode installed (integration plan §3.2.4).
 * - Shutdown is driven exclusively by the server's shutdown flow
 *   (`shutdownZCodeRuntime`); the client never installs its own signal
 *   handlers or calls `process.exit`.
 *
 * @module zcode-protocol.client
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { setTimeout, clearTimeout } from 'node:timers';
import * as os from 'node:os';

import type { AnyRecord } from '@/shared/types.js';

import { tryResolveEnginePath, getEngineVersion } from './zcode-engine-path.js';

/**
 * Protocol request envelope (line-delimited JSON to stdin).
 */
type ProtocolRequest = {
  id: number;
  method: string;
  params?: AnyRecord;
};

/**
 * Protocol response envelope (from stdout).
 */
type ProtocolResponse =
  | { id: number; result: unknown }
  | { id: number; error: { code: number; message: string; data?: unknown } };

/**
 * Protocol notification envelope (no id, async event).
 */
type ProtocolNotification = {
  method: string;
  params: AnyRecord;
};

/**
 * Response wrapper for internal pending request management.
 */
type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout | null;
};

/**
 * Event listener for session-specific notifications.
 * Consumers: zcode runtime provider (per-run event normalization).
 */
export type SessionEventListener = (notification: ProtocolNotification) => void;

/**
 * Configuration constants for process management.
 */
const CONFIG = {
  /** Default timeout for requests (30s) */
  DEFAULT_TIMEOUT: 30000,
  /** Maximum restarts per minute before giving up */
  MAX_RESTARTS_PER_MINUTE: 5,
  /** Exponential backoff base in milliseconds */
  RESTART_BACKOFF_BASE: 1000,
  /** Maximum backoff time */
  MAX_BACKOFF: 32000,
  /** Graceful shutdown timeout in milliseconds */
  SHUTDOWN_TIMEOUT: 2000,
} as const;

/**
 * Parses one stdout line into a protocol response or notification.
 *
 * Consumers: `handleStdout` here and
 * `server/modules/providers/tests/zcode-protocol.client.test.ts`.
 * Returns null for empty or malformed lines so callers can skip them.
 */
export function parseProtocolLine(line: string): ProtocolResponse | ProtocolNotification | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const message = JSON.parse(trimmed) as ProtocolResponse | ProtocolNotification;
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
 * Reads the session id a `session/event` notification belongs to.
 * Supports both flat (`params.sessionId`) and nested (`params.event.sessionId`)
 * payload layouts; the exact wrapper was not captured during the Phase 0
 * spike, so both documented shapes are accepted.
 */
function readNotificationSessionId(params: AnyRecord | undefined): string | null {
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

/**
 * ZCode Protocol Client - Singleton process manager and protocol router.
 *
 * Responsibilities:
 * - Lazy app-server subprocess spawning (first request triggers startup)
 * - Request/response correlation with auto-incrementing IDs
 * - Event notification routing to session listeners
 * - Automatic restart with exponential backoff
 * - Graceful shutdown orchestrated by the server shutdown flow
 */
class ZCodeProtocolClient {
  /** Singleton instance */
  private static instance: ZCodeProtocolClient | null = null;

  /** app-server subprocess handle */
  private process: ChildProcess | null = null;

  /** In-flight startup promise; concurrent callers await the same attempt */
  private startupPromise: Promise<void> | null = null;

  /** Auto-incrementing request ID counter */
  private requestId: number = 0;

  /** Pending requests awaiting response */
  private pendingRequests: Map<number, PendingRequest> = new Map();

  /** Session-specific event listeners by session ID */
  private sessionListeners: Map<string, SessionEventListener[]> = new Map();

  /** Process restart tracking */
  private restartCount: number = 0;
  private restartWindowStart: number = 0;
  private currentBackoff: number = CONFIG.RESTART_BACKOFF_BASE;

  /** Process state flags */
  private isShuttingDown: boolean = false;

  /** stdout line buffer */
  private stdoutBuffer: string = '';

  /** stderr line buffer */
  private stderrBuffer: string = '';

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

  /**
   * Starts the app-server subprocess if not already running.
   * Concurrent calls share one startup attempt.
   */
  private startProcess(): Promise<void> {
    if (this.process && !this.process.killed) {
      return Promise.resolve();
    }

    if (this.startupPromise) {
      return this.startupPromise;
    }

    this.startupPromise = this.doStartProcess();
    this.startupPromise.finally(() => {
      this.startupPromise = null;
    }).catch(() => {
      // Startup errors are already surfaced to the awaiting request.
    });

    return this.startupPromise;
  }

  private async doStartProcess(): Promise<void> {
    const enginePath = tryResolveEnginePath();

    if (!enginePath) {
      throw new Error(
        'ZCode engine not found. Please install ZCode Desktop App from https://z.ai/download ' +
        'or set CLOUDCLI_ZCODE_ENGINE environment variable to override path detection.'
      );
    }

    console.info('[ZCode Protocol] Starting app-server subprocess...');
    console.debug(`[ZCode Protocol] Engine path: ${enginePath}`);
    console.debug(`[ZCode Protocol] Detected version: ${getEngineVersion() || 'unknown'}`);

    this.process = spawn('node', [enginePath, 'app-server'], {
      env: {
        ...process.env,
        // Ensure ZCode uses the expected storage directory
        ZCODE_STORAGE_DIR: process.env.ZCODE_STORAGE_DIR || path.join(os.homedir(), '.zcode'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    this.setupProcessHandlers();
    this.resetRestartTracking();

    console.info('[ZCode Protocol] app-server started successfully');
  }

  /**
   * Sets up event handlers for the subprocess.
   */
  private setupProcessHandlers(): void {
    if (!this.process) return;

    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleStdout(data);
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      this.handleStderr(data);
    });

    this.process.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.handleProcessExit(code, signal);
    });

    this.process.on('error', (error: Error) => {
      console.error('[ZCode Protocol] Process error:', error);
    });
  }

  /**
   * Handles stdout data with line-delimited JSON parsing.
   */
  private handleStdout(data: Buffer): void {
    this.stdoutBuffer += data.toString('utf-8');

    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      const message = parseProtocolLine(line);
      if (message) {
        this.handleProtocolMessage(message);
      } else if (line.trim()) {
        console.warn(`[ZCode Protocol] Failed to parse stdout line: ${line.slice(0, 100)}`);
      }
    }
  }

  /**
   * Handles stderr data for logging.
   */
  private handleStderr(data: Buffer): void {
    this.stderrBuffer += data.toString('utf-8');

    const lines = this.stderrBuffer.split('\n');
    this.stderrBuffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        console.debug(`[ZCode stderr] ${line}`);
      }
    }
  }

  /**
   * Handles parsed protocol messages (responses or notifications).
   */
  private handleProtocolMessage(message: ProtocolResponse | ProtocolNotification): void {
    if ('id' in message) {
      this.handleResponse(message);
    } else {
      this.handleNotification(message);
    }
  }

  /**
   * Handles protocol responses and resolves pending requests.
   */
  private handleResponse(response: ProtocolResponse): void {
    const pending = this.pendingRequests.get(response.id);

    if (!pending) {
      console.warn(`[ZCode Protocol] Received response for unknown request id: ${response.id}`);
      return;
    }

    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }

    this.pendingRequests.delete(response.id);

    if ('error' in response) {
      const error = new Error(response.error.message);
      (error as AnyRecord).code = response.error.code;
      (error as AnyRecord).data = response.error.data;
      pending.reject(error);
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * Handles protocol notifications and routes to session listeners.
   */
  private handleNotification(notification: ProtocolNotification): void {
    console.debug(`[ZCode Protocol] Received notification: ${notification.method}`);

    if (notification.method === 'session/event') {
      const sessionId = readNotificationSessionId(notification.params);
      if (sessionId) {
        this.routeSessionEvent(sessionId, notification);
      }
    }
  }

  /**
   * Routes session-specific events to registered listeners.
   */
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

  /**
   * Handles unexpected process exit with auto-restart logic.
   */
  private handleProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
    console.warn(`[ZCode Protocol] Process exited (code: ${code}, signal: ${signal})`);

    this.process = null;

    for (const pending of this.pendingRequests.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(new Error('ZCode process terminated unexpectedly'));
    }
    this.pendingRequests.clear();

    if (this.isShuttingDown) {
      console.info('[ZCode Protocol] Process terminated during shutdown');
      return;
    }

    const now = Date.now();
    if (now - this.restartWindowStart > 60000) {
      this.restartCount = 0;
      this.restartWindowStart = now;
      this.currentBackoff = CONFIG.RESTART_BACKOFF_BASE;
    }

    if (++this.restartCount > CONFIG.MAX_RESTARTS_PER_MINUTE) {
      console.error('[ZCode Protocol] Too many restarts, giving up');
      return;
    }

    const backoff = Math.min(this.currentBackoff, CONFIG.MAX_BACKOFF);
    console.info(`[ZCode Protocol] Scheduling restart in ${backoff}ms...`);

    setTimeout(() => {
      this.currentBackoff *= 2;
      this.startProcess().catch((error) => {
        console.error('[ZCode Protocol] Restart failed:', error);
      });
    }, backoff);
  }

  /**
   * Resets restart tracking after successful startup.
   */
  private resetRestartTracking(): void {
    this.restartCount = 0;
    this.restartWindowStart = Date.now();
    this.currentBackoff = CONFIG.RESTART_BACKOFF_BASE;
  }

  /**
   * Sends a protocol request and returns the response.
   *
   * Consumers: zcode runtime provider (session lifecycle + messaging).
   *
   * @param method - Protocol method name
   * @param params - Method parameters
   * @param timeout - Request timeout in milliseconds (0 for no timeout: use
   *   for `session/send`, whose result arrives on the event stream)
   * @returns Promise that resolves with the result or rejects with error
   */
  async sendRequest<T = unknown>(
    method: string,
    params: AnyRecord = {},
    timeout: number = CONFIG.DEFAULT_TIMEOUT
  ): Promise<T> {
    await this.startProcess();

    if (!this.process || this.process.killed) {
      throw new Error('ZCode process is not available');
    }

    const id = ++this.requestId;
    const request: ProtocolRequest = { id, method, params };
    const childProcess = this.process;

    return new Promise<T>((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | null = null;
      if (timeout > 0) {
        timeoutHandle = setTimeout(() => {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout after ${timeout}ms`));
        }, timeout);
      }

      this.pendingRequests.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
        timeout: timeoutHandle,
      });

      try {
        const jsonLine = JSON.stringify(request) + '\n';
        childProcess.stdin!.write(jsonLine, 'utf-8', (error) => {
          if (error) {
            this.pendingRequests.delete(id);
            if (timeoutHandle) clearTimeout(timeoutHandle);
            reject(new Error(`Failed to send request: ${error.message}`));
          }
        });
      } catch (error) {
        this.pendingRequests.delete(id);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(new Error(`Failed to serialize request: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    });
  }

  /**
   * Registers a listener for session-specific events.
   *
   * @param sessionId - ZCode native session ID to listen for
   * @param listener - Callback function for notifications
   */
  addSessionListener(sessionId: string, listener: SessionEventListener): void {
    if (!this.sessionListeners.has(sessionId)) {
      this.sessionListeners.set(sessionId, []);
    }
    this.sessionListeners.get(sessionId)!.push(listener);
  }

  /**
   * Removes a session event listener.
   *
   * @param sessionId - Session ID
   * @param listener - Callback function to remove
   */
  removeSessionListener(sessionId: string, listener: SessionEventListener): void {
    const listeners = this.sessionListeners.get(sessionId);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
      if (listeners.length === 0) {
        this.sessionListeners.delete(sessionId);
      }
    }
  }

  /**
   * Gracefully shuts down the app-server process.
   *
   * Consumer: `shutdownZCodeRuntime` in the zcode provider, wired into the
   * server shutdown flow from `server/index.ts`.
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    console.info('[ZCode Protocol] Initiating graceful shutdown...');

    for (const pending of this.pendingRequests.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(new Error('Client is shutting down'));
    }
    this.pendingRequests.clear();

    // Close stdin to signal EOF to app-server
    if (this.process && this.process.stdin) {
      this.process.stdin.end();
    }

    const shutdownPromise = new Promise<void>((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        console.warn('[ZCode Protocol] Shutdown timeout, forcing kill');
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
        resolve();
      }, CONFIG.SHUTDOWN_TIMEOUT);

      this.process.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await shutdownPromise;
    console.info('[ZCode Protocol] Shutdown complete');
  }
}

/**
 * Singleton protocol client shared by every ZCode session.
 * Consumers: zcode runtime provider and `shutdownZCodeRuntime` in the zcode
 * provider barrel.
 */
export const protocolClient = ZCodeProtocolClient.getInstance();
