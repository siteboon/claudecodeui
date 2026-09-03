/**
 * ZCode Engine Supervisor
 *
 * Owns the app-server subprocess lifecycle for the protocol client: lazy
 * startup, stdout/stderr line framing, crash detection, automatic restart
 * with exponential backoff, and graceful shutdown.
 *
 * Lifecycle rules (defects this module fixes relative to the original
 * single-file client):
 * - The restart circuit breaker covers EVERY spawn path. `ensureRunning`
 *   refuses to start a new process while the breaker is tripped, so request
 *   traffic cannot restart a crash-looping engine.
 * - The scheduled restart timer is stored and cancelled by `shutdown`, so a
 *   shutdown completed between a crash and its scheduled restart can never
 *   spawn a new engine afterwards.
 * - `shutdown` resets its state when it completes, so the singleton client
 *   remains usable across shutdown cycles (server tests reuse it in `after`
 *   hooks).
 * - The restart window only resets after the process has stayed up for a
 *   stable period, not immediately on spawn.
 *
 * @module zcode-engine-supervisor
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as setTimeoutFn, clearTimeout as clearTimeoutFn } from 'node:timers';

import { getZCodeStorageDir } from './zcode-data-root.js';
import { tryResolveEnginePath } from './zcode-engine-path.js';

/**
 * Tunables for the supervisor; defaults match the original client behavior.
 */
export type EngineSupervisorOptions = {
  maxRestartsPerMinute?: number;
  restartBackoffBaseMs?: number;
  maxBackoffMs?: number;
  shutdownTimeoutMs?: number;
  /** Uptime required before the restart window resets. */
  stableUptimeMs?: number;
};

/**
 * Injectable subprocess dependencies. Production uses the real `spawn` and
 * the shared engine-path resolver; tests stub both.
 */
export type EngineSupervisorDependencies = {
  resolveEnginePath?: () => string | null;
  spawnProcess?: (enginePath: string) => ChildProcess;
  now?: () => number;
};

/**
 * Runs the engine subprocess and reports stdout/stderr lines and crashes.
 *
 * Consumers: the zcode protocol client facade (the only production consumer)
 * and `server/modules/providers/tests/zcode-engine-supervisor.test.ts`.
 */
export class EngineSupervisor {
  private readonly options: Required<EngineSupervisorOptions>;
  private readonly dependencies: Required<EngineSupervisorDependencies>;

  private process: ChildProcess | null = null;
  private startupPromise: Promise<void> | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private stabilityTimer: NodeJS.Timeout | null = null;

  private restartCount = 0;
  private restartWindowStart = 0;
  private currentBackoff = 1000;

  private isShuttingDown = false;

  private stdoutBuffer = '';
  private stderrBuffer = '';

  private lineListener: ((line: string) => void) | null = null;
  private stderrLineListener: ((line: string) => void) | null = null;
  private crashListeners: Array<(info: { code: number | null; signal: NodeJS.Signals | null }) => void> = [];

  constructor(options: EngineSupervisorOptions = {}, dependencies: EngineSupervisorDependencies = {}) {
    this.options = {
      maxRestartsPerMinute: options.maxRestartsPerMinute ?? 5,
      restartBackoffBaseMs: options.restartBackoffBaseMs ?? 1000,
      maxBackoffMs: options.maxBackoffMs ?? 32000,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? 2000,
      stableUptimeMs: options.stableUptimeMs ?? 30_000,
    };
    this.dependencies = {
      resolveEnginePath: dependencies.resolveEnginePath ?? tryResolveEnginePath,
      spawnProcess: dependencies.spawnProcess ?? ((enginePath) => spawn('node', [enginePath, 'app-server'], {
        env: {
          ...process.env,
          // Ensure ZCode uses the expected storage directory (shared data-root
          // helper, so ZCODE_STORAGE_DIR isolation applies uniformly).
          ZCODE_STORAGE_DIR: getZCodeStorageDir(),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
      })),
      now: dependencies.now ?? Date.now,
    };
  }

  /**
   * Subscribes to complete stdout lines (already framed).
   */
  onLine(listener: (line: string) => void): void {
    this.lineListener = listener;
  }

  /**
   * Subscribes to complete stderr lines (diagnostics logging).
   */
  onStderrLine(listener: (line: string) => void): void {
    this.stderrLineListener = listener;
  }

  /**
   * Subscribes to engine crashes. Fires once per unexpected exit, before the
   * restart is scheduled.
   */
  onCrash(listener: (info: { code: number | null; signal: NodeJS.Signals | null }) => void): void {
    this.crashListeners.push(listener);
  }

  /**
   * Ensures the engine subprocess is running, spawning it lazily on first
   * use. Concurrent callers share one startup attempt.
   *
   * Throws when the client is shutting down, the engine is not installed, or
   * the restart circuit breaker is tripped (crash-loop protection — request
   * traffic must not revive a crash-looping engine).
   */
  async ensureRunning(): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('ZCode client is shutting down');
    }

    if (this.process && !this.process.killed) {
      return;
    }

    if (this.isCrashLooping()) {
      throw new Error(
        'ZCode engine is crash-looping; giving up until the restart window resets. '
        + 'Check the server logs for the underlying engine errors.'
      );
    }

    if (this.restartTimer) {
      // A backoff restart is scheduled, but demand arrived: accelerate it and
      // start right away instead of letting the caller wait out the backoff.
      clearTimeoutFn(this.restartTimer);
      this.restartTimer = null;
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

  /**
   * Writes one already-encoded protocol line to the engine's stdin.
   */
  writeLine(line: string): void {
    try {
      this.process?.stdin?.write(line, 'utf-8', (error) => {
        if (error) {
          console.error('[ZCode Protocol] Failed to write to engine stdin:', error);
        }
      });
    } catch (error) {
      console.error('[ZCode Protocol] Failed to write to engine stdin:', error);
    }
  }

  /**
   * Graceful shutdown: cancels any scheduled restart, closes stdin to signal
   * EOF, force-kills after the timeout, and resets state so the supervisor
   * can be reused.
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    console.info('[ZCode Protocol] Initiating graceful shutdown...');

    if (this.restartTimer) {
      clearTimeoutFn(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.stabilityTimer) {
      clearTimeoutFn(this.stabilityTimer);
      this.stabilityTimer = null;
    }

    await new Promise<void>((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      const timeout = setTimeoutFn(() => {
        console.warn('[ZCode Protocol] Shutdown timeout, forcing kill');
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
        resolve();
      }, this.options.shutdownTimeoutMs);

      this.process.once('exit', () => {
        clearTimeoutFn(timeout);
        resolve();
      });

      // Close stdin to signal EOF to app-server
      this.process.stdin?.end();
    });

    // Reset so a later ensureRunning cycle (e.g. server tests reusing the
    // singleton) starts from a clean slate instead of a poisoned one.
    this.process = null;
    this.isShuttingDown = false;
    this.resetRestartTracking();
    console.info('[ZCode Protocol] Shutdown complete');
  }

  private isCrashLooping(): boolean {
    if (this.restartCount === 0) {
      return false;
    }
    const windowExpired = this.dependencies.now() - this.restartWindowStart > 60_000;
    return !windowExpired && this.restartCount > this.options.maxRestartsPerMinute;
  }

  private async doStartProcess(): Promise<void> {
    const enginePath = this.dependencies.resolveEnginePath();

    if (!enginePath) {
      throw new Error(
        'ZCode engine not found. Please install ZCode Desktop App from https://z.ai/download '
        + 'or set CLOUDCLI_ZCODE_ENGINE environment variable to override path detection.'
      );
    }

    console.info('[ZCode Protocol] Starting app-server subprocess...');
    console.debug(`[ZCode Protocol] Engine path: ${enginePath}`);

    this.process = this.dependencies.spawnProcess(enginePath);
    this.setupProcessHandlers();

    // The restart window only resets once the process has proven stable, so a
    // fast crash-spawn loop still trips the breaker. unref'd: a pending timer
    // must never keep the process alive on its own.
    if (this.stabilityTimer) {
      clearTimeoutFn(this.stabilityTimer);
    }
    this.stabilityTimer = setTimeoutFn(() => {
      this.stabilityTimer = null;
      this.resetRestartTracking();
    }, this.options.stableUptimeMs);
    this.stabilityTimer.unref();

    console.info('[ZCode Protocol] app-server started successfully');
  }

  private setupProcessHandlers(): void {
    if (!this.process) return;

    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleFramedLines(data, () => this.stdoutBuffer, (buffer) => {
        this.stdoutBuffer = buffer;
      }, (line) => this.lineListener?.(line));
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      this.handleFramedLines(data, () => this.stderrBuffer, (buffer) => {
        this.stderrBuffer = buffer;
      }, (line) => this.stderrLineListener?.(line));
    });

    this.process.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.handleProcessExit(code, signal);
    });

    this.process.on('error', (error: Error) => {
      console.error('[ZCode Protocol] Process error:', error);
    });
  }

  private handleFramedLines(
    data: Buffer,
    getBuffer: () => string,
    setBuffer: (buffer: string) => void,
    emitLine: (line: string) => void,
  ): void {
    let buffer = getBuffer() + data.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer
    setBuffer(buffer);

    for (const line of lines) {
      if (line.trim()) {
        emitLine(line);
      }
    }
  }

  /**
   * Handles unexpected process exit: notifies crash subscribers, then
   * schedules a restart with exponential backoff inside a one-minute window.
   */
  private handleProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
    console.warn(`[ZCode Protocol] Process exited (code: ${code}, signal: ${signal})`);
    this.process = null;

    if (this.stabilityTimer) {
      clearTimeoutFn(this.stabilityTimer);
      this.stabilityTimer = null;
    }

    for (const listener of this.crashListeners) {
      try {
        listener({ code, signal });
      } catch (error) {
        console.error('[ZCode Protocol] Crash listener error:', error);
      }
    }

    if (this.isShuttingDown) {
      console.info('[ZCode Protocol] Process terminated during shutdown');
      return;
    }

    const now = this.dependencies.now();
    if (now - this.restartWindowStart > 60_000) {
      this.restartCount = 0;
      this.restartWindowStart = now;
      this.currentBackoff = this.options.restartBackoffBaseMs;
    }

    if (++this.restartCount > this.options.maxRestartsPerMinute) {
      console.error('[ZCode Protocol] Too many restarts, giving up');
      return;
    }

    const backoff = Math.min(this.currentBackoff, this.options.maxBackoffMs);
    console.info(`[ZCode Protocol] Scheduling restart in ${backoff}ms...`);

    // Stored so shutdown can cancel it: a restart scheduled before shutdown
    // must never spawn an engine afterwards.
    this.restartTimer = setTimeoutFn(() => {
      this.restartTimer = null;
      this.currentBackoff *= 2;
      this.ensureRunning().catch((error) => {
        console.error('[ZCode Protocol] Restart failed:', error);
      });
    }, backoff);
  }

  private resetRestartTracking(): void {
    this.restartCount = 0;
    this.restartWindowStart = this.dependencies.now();
    this.currentBackoff = this.options.restartBackoffBaseMs;
  }
}
