import type { SpawnOptions } from 'node:child_process';
import { createRequire } from 'node:module';
import type { Readable, Writable } from 'node:stream';

import spawn from 'cross-spawn';

import type {
  JsonRpcDiagnostic,
  JsonRpcNotification,
  JsonRpcRequest,
} from './codex-app-server.transport.js';
import { CodexAppServerTransport, JsonRpcTransportClosedError } from './codex-app-server.transport.js';

export type CodexAppServerClientInfo = {
  name: string;
  title: string;
  version: string;
};

export type CodexAppServerInitializeParams = {
  clientInfo: CodexAppServerClientInfo;
  capabilities?: Record<string, unknown>;
};

export type CodexAppServerInitializeResult = {
  userAgent?: string;
  codexHome?: string;
  platformFamily?: string;
  platformOs?: string;
  [key: string]: unknown;
};

export type CodexAppServerProcessState = 'stopped' | 'starting' | 'ready' | 'stopping' | 'failed';

export type CodexAppServerHealth = {
  state: CodexAppServerProcessState;
  generation: number;
  pid: number | null;
  startedAt: string | null;
  initializedAt: string | null;
  lastError: string | null;
};

export type CodexAppServerHandshake = {
  generation: number;
  initialize: CodexAppServerInitializeResult;
  initializedAt: string;
};

export type CodexAppServerDiagnostic =
  | JsonRpcDiagnostic
  | {
      type: 'process_started';
      generation: number;
      pid: number | null;
      executable: string;
      args: string[];
    }
  | {
      type: 'process_exit';
      generation: number;
      code: number | null;
      signal: NodeJS.Signals | null;
      expected: boolean;
    }
  | {
      type: 'process_error';
      generation: number;
      error: Error;
    };

export type CodexAppServerProcess = {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  pid?: number;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  on: {
    (event: 'error', listener: (error: Error) => void): CodexAppServerProcess;
    (event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): CodexAppServerProcess;
  };
  once: {
    (event: 'error', listener: (error: Error) => void): CodexAppServerProcess;
    (event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): CodexAppServerProcess;
  };
};

export type CodexAppServerSpawn = (
  executable: string,
  args: string[],
  options: SpawnOptions,
) => CodexAppServerProcess;

export type CodexAppServerProcessManagerOptions = {
  executable?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  clientInfo?: Partial<CodexAppServerClientInfo> & Pick<CodexAppServerClientInfo, 'name'>;
  capabilities?: Record<string, unknown>;
  shutdownGracePeriodMs?: number;
  spawn?: CodexAppServerSpawn;
  onNotification?: (notification: JsonRpcNotification) => void;
  onRequest?: (request: JsonRpcRequest) => unknown | Promise<unknown>;
  onDiagnostic?: (diagnostic: CodexAppServerDiagnostic) => void;
};

const resolveBundledCodexCli = (): string | null => {
  try {
    return createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js');
  } catch {
    return null;
  }
};

const BUNDLED_CODEX_CLI = resolveBundledCodexCli();
const DEFAULT_EXECUTABLE = BUNDLED_CODEX_CLI ? process.execPath : 'codex';
const DEFAULT_ARGS = BUNDLED_CODEX_CLI
  ? [BUNDLED_CODEX_CLI, 'app-server', '--listen', 'stdio://']
  : ['app-server', '--listen', 'stdio://'];
const DEFAULT_SHUTDOWN_GRACE_PERIOD_MS = 2_000;

const defaultSpawn: CodexAppServerSpawn = (
  executable,
  args,
  options,
) => spawn(executable, args, options) as unknown as CodexAppServerProcess;

const toError = (value: unknown, fallback: string): Error => (
  value instanceof Error ? value : new Error(typeof value === 'string' ? value : fallback)
);

const formatExitReason = (code: number | null, signal: NodeJS.Signals | null): Error => {
  if (signal) {
    return new Error(`Codex app-server exited with signal ${signal}`);
  }
  return new Error(`Codex app-server exited with code ${code ?? 'unknown'}`);
};

/**
 * Owns one Codex app-server child process and its stdio transport. The Codex
 * runtime uses this manager as an internal control plane; browser sessions and
 * provider thread orchestration remain outside this PR.
 */
export class CodexAppServerProcessManager {
  private readonly executable: string;
  private readonly args: string[];
  private readonly cwd?: string;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly clientInfo: CodexAppServerClientInfo;
  private readonly capabilities?: Record<string, unknown>;
  private readonly shutdownGracePeriodMs: number;
  private readonly spawnProcess: CodexAppServerSpawn;
  private readonly callbacks: Pick<
    CodexAppServerProcessManagerOptions,
    'onNotification' | 'onRequest' | 'onDiagnostic'
  >;
  private process: CodexAppServerProcess | null = null;
  private transport: CodexAppServerTransport | null = null;
  private state: CodexAppServerProcessState = 'stopped';
  private generation = 0;
  private startedAt: string | null = null;
  private initializedAt: string | null = null;
  private lastError: Error | null = null;
  private handshake: CodexAppServerHandshake | null = null;
  private startPromise: Promise<CodexAppServerHandshake> | null = null;
  private stopPromise: Promise<void> | null = null;
  private processExited = true;
  private expectedExit = false;

  constructor(options: CodexAppServerProcessManagerOptions = {}) {
    this.executable = options.executable ?? DEFAULT_EXECUTABLE;
    this.args = [...(options.args ?? DEFAULT_ARGS)];
    this.cwd = options.cwd;
    this.env = options.env;
    this.clientInfo = {
      name: options.clientInfo?.name ?? 'cloudcli',
      title: options.clientInfo?.title ?? 'CloudCLI',
      version: options.clientInfo?.version ?? process.env.CLOUDCLI_VERSION ?? 'unknown',
    };
    this.capabilities = options.capabilities;
    this.shutdownGracePeriodMs = Math.max(
      0,
      options.shutdownGracePeriodMs ?? DEFAULT_SHUTDOWN_GRACE_PERIOD_MS,
    );
    this.spawnProcess = options.spawn ?? defaultSpawn;
    this.callbacks = options;
  }

  get currentState(): CodexAppServerProcessState {
    return this.state;
  }

  get currentHandshake(): CodexAppServerHandshake | null {
    return this.handshake;
  }

  getHealth(): CodexAppServerHealth {
    return {
      state: this.state,
      generation: this.generation,
      pid: this.process?.pid ?? null,
      startedAt: this.startedAt,
      initializedAt: this.initializedAt,
      lastError: this.lastError?.message ?? null,
    };
  }

  /**
   * Starts the process once and performs the mandatory initialize handshake.
   * Concurrent callers share the same startup promise.
   */
  start(): Promise<CodexAppServerHandshake> {
    if (this.state === 'ready' && this.handshake) {
      return Promise.resolve(this.handshake);
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    if (this.state === 'stopping' && this.stopPromise) {
      return this.stopPromise.then(() => this.start());
    }

    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  /** Sends a request only after initialize/initialized has completed. */
  request<TResult = unknown>(method: string, params?: unknown): Promise<TResult> {
    if (this.state !== 'ready' || !this.transport) {
      return Promise.reject(new Error('Codex app-server is not ready'));
    }
    return this.transport.request<TResult>(method, params);
  }

  /** Sends a notification only after initialize/initialized has completed. */
  notify(method: string, params?: unknown): Promise<void> {
    if (this.state !== 'ready' || !this.transport) {
      return Promise.reject(new Error('Codex app-server is not ready'));
    }
    return this.transport.notify(method, params);
  }

  /**
   * Stops the child process and waits for it to exit. A bounded SIGKILL
   * fallback prevents an unresponsive child from surviving CloudCLI shutdown.
   */
  stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    if (!this.process) {
      this.setState('stopped');
      return Promise.resolve();
    }

    this.expectedExit = true;
    this.setState('stopping');
    const child = this.process;
    this.transport?.close(new JsonRpcTransportClosedError('Codex app-server is shutting down'));
    try {
      child.stdin.end();
    } catch (error) {
      this.emitDiagnostic({
        type: 'process_error',
        generation: this.generation,
        error: toError(error, 'Failed to close Codex app-server stdin'),
      });
    }

    this.stopPromise = this.waitForExit(child, this.shutdownGracePeriodMs)
      .then(async (exited) => {
        if (!exited) {
          try {
            child.kill('SIGTERM');
          } catch (error) {
            this.emitDiagnostic({
              type: 'process_error',
              generation: this.generation,
              error: toError(error, 'Failed to terminate Codex app-server'),
            });
          }
          const terminated = await this.waitForExit(child, this.shutdownGracePeriodMs);
          if (!terminated) {
            try {
              child.kill('SIGKILL');
            } catch (error) {
              this.emitDiagnostic({
                type: 'process_error',
                generation: this.generation,
                error: toError(error, 'Failed to force-stop Codex app-server'),
              });
            }
            await this.waitForExit(child, this.shutdownGracePeriodMs);
          }
        }
        if (this.process === child) {
          this.process = null;
          this.transport = null;
          this.handshake = null;
          this.setState('stopped');
        }
      })
      .finally(() => {
        this.stopPromise = null;
      });
    return this.stopPromise;
  }

  /**
   * Replaces the managed process and completes a fresh initialize handshake.
   * Callers use this after Codex configuration or authentication files change.
   */
  async restart(): Promise<CodexAppServerHandshake> {
    await this.stop();
    return this.start();
  }

  private async startInternal(): Promise<CodexAppServerHandshake> {
    if (this.process) {
      await this.stop();
    }

    this.generation += 1;
    this.startedAt = new Date().toISOString();
    this.initializedAt = null;
    this.lastError = null;
    this.handshake = null;
    this.processExited = false;
    this.expectedExit = false;
    this.setState('starting');

    let child: CodexAppServerProcess;
    try {
      child = this.spawnProcess(this.executable, this.args, {
        cwd: this.cwd,
        env: this.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      const normalized = toError(error, 'Failed to start Codex app-server');
      this.fail(normalized);
      throw normalized;
    }

    this.process = child;
    child.on('error', (error) => this.handleProcessError(error));
    child.on('exit', (code, signal) => this.handleProcessExit(code, signal));
    this.emitDiagnostic({
      type: 'process_started',
      generation: this.generation,
      pid: child.pid ?? null,
      executable: this.executable,
      args: [...this.args],
    });

    this.transport = new CodexAppServerTransport({
      input: child.stdout,
      output: child.stdin,
      stderr: child.stderr,
      wireFormat: 'codex-app-server',
      onNotification: this.callbacks.onNotification,
      onRequest: this.callbacks.onRequest,
      onDiagnostic: (diagnostic) => this.emitDiagnostic(diagnostic),
      onClose: (error) => {
        if (!this.expectedExit && this.state === 'ready') {
          this.fail(error);
        }
      },
    });

    const processExit = new Promise<never>((_resolve, reject) => {
      child.once('error', (error) => reject(error));
      child.once('exit', (code, signal) => reject(formatExitReason(code, signal)));
    });

    try {
      const initialize = this.transport.request<CodexAppServerInitializeResult>('initialize', {
        clientInfo: this.clientInfo,
        ...(this.capabilities ? { capabilities: this.capabilities } : {}),
      } satisfies CodexAppServerInitializeParams);
      const initializeResult = await Promise.race([initialize, processExit]);
      await this.transport.notify('initialized');

      this.initializedAt = new Date().toISOString();
      this.handshake = {
        generation: this.generation,
        initialize: initializeResult,
        initializedAt: this.initializedAt,
      };
      this.setState('ready');
      return this.handshake;
    } catch (error) {
      const normalized = toError(error, 'Codex app-server initialization failed');
      this.fail(normalized);
      await this.stop();
      throw normalized;
    }
  }

  private handleProcessError(error: Error): void {
    const normalized = toError(error, 'Codex app-server process error');
    this.lastError = normalized;
    this.emitDiagnostic({ type: 'process_error', generation: this.generation, error: normalized });
    if (!this.expectedExit) {
      this.fail(normalized);
    }
  }

  private handleProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.processExited = true;
    const expected = this.expectedExit || this.state === 'stopping';
    this.emitDiagnostic({
      type: 'process_exit',
      generation: this.generation,
      code,
      signal,
      expected,
    });

    if (!expected) {
      this.fail(formatExitReason(code, signal));
    }
    this.transport?.close(new JsonRpcTransportClosedError(formatExitReason(code, signal).message));
    if (this.state === 'stopping' || expected) {
      this.setState('stopped');
    }
  }

  private fail(error: Error): void {
    this.lastError = error;
    this.setState('failed');
  }

  private setState(state: CodexAppServerProcessState): void {
    this.state = state;
  }

  private emitDiagnostic(diagnostic: CodexAppServerDiagnostic): void {
    try {
      this.callbacks.onDiagnostic?.(diagnostic);
    } catch {
      // Diagnostics must never interrupt process supervision.
    }
  }

  private waitForExit(child: CodexAppServerProcess, timeoutMs: number): Promise<boolean> {
    if (this.process !== child || this.processExited) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (exited: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(exited);
      };
      child.once('exit', () => finish(true));
      setTimeout(() => finish(this.processExited), timeoutMs);
    });
  }
}
