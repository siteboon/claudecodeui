/**
 * PiRpcClient - thin wrapper around the official Pi rpc-client.
 *
 * Spawns `pi --mode rpc --no-extensions` (via the official RpcClient) and adds
 * a small layer the runtime relies on:
 * - fixed args injection (--mode rpc --no-extensions), merged with caller args,
 * - event dispatch fan-out (onEvent),
 * - stderr pass-through (getStderr),
 * - graceful close with a bounded window before giving up.
 *
 * Request/response correlation, timeouts and rejection of pending requests on
 * unexpected process exit are handled by the official client; this wrapper only
 * forwards to it and does not re-implement that machinery.
 */
import type { ChildProcess } from 'node:child_process';

import {
  RpcClient,
  type RpcClientOptions,
  type AgentSessionEvent,
  type ModelInfo,
  type RpcSessionState,
} from '@earendil-works/pi-coding-agent';

/**
 * Local equivalent of the official `RpcSlashCommand` (returned by
 * `getCommands()`). The package does not export this type from its top-level
 * entry, so we mirror its shape here to keep type-checking working.
 */
type RpcSlashCommand = {
  name: string;
  description?: string;
  source: 'extension' | 'prompt' | 'skill';
  sourceInfo?: unknown;
};

type EventListener = (event: AgentSessionEvent) => void;

/**
 * Minimal surface the wrapper depends on. The default adapter is backed by the
 * official {@link RpcClient}; tests inject a stub implementing this shape.
 */
export interface UnderlyingRpcClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  onEvent(listener: EventListener): () => void;
  /**
   * Subscribes to real process exit. The runtime relies on this to detect a
   * close before `agent_settled` (ERR-PI-RUN-FAILED) instead of hanging.
   * Optional so lightweight test stubs need not implement it.
   */
  onClose?(listener: () => void): () => void;
  getStderr(): string;
  prompt(message: string, images?: unknown[]): Promise<void>;
  abort(): Promise<void>;
  getState(): Promise<RpcSessionState>;
  getAvailableModels(): Promise<ModelInfo[]>;
  getCommands(): Promise<RpcSlashCommand[]>;
}

export interface PiRpcClientDeps {
  createClient(options: RpcClientOptions): UnderlyingRpcClient;
}

const FIXED_ARGS = ['--mode', 'rpc', '--no-extensions'];

/** Default adapter wiring the official RpcClient to {@link UnderlyingRpcClient}. */
const defaultDeps: PiRpcClientDeps = {
  createClient(options) {
    const client = new RpcClient(options);
    return {
      start: () => client.start(),
      stop: () => client.stop(),
      onEvent: (listener) => client.onEvent(listener),
      onClose: (listener) => {
        // The official client exposes its spawned ChildProcess as a public
        // field once start() has run. Forward its `exit` to the runtime so a
        // process death before agent_settled surfaces as a failure.
        // `process` is a runtime-public field; the shipped .d.ts marks it
        // private, so reach it through a narrow typed view.
        const child = (client as unknown as { process: ChildProcess | null }).process;
        if (!child) return () => {};
        const onExit = (): void => listener();
        child.once('exit', onExit);
        return () => {
          child.removeListener('exit', onExit);
        };
      },
      getStderr: () => client.getStderr(),
      prompt: (message, images) => client.prompt(message, images as never),
      abort: () => client.abort(),
      getState: () => client.getState(),
      getAvailableModels: () => client.getAvailableModels(),
      getCommands: () => client.getCommands(),
    };
  },
};

export class PiRpcClient {
  private readonly deps: PiRpcClientDeps;
  private readonly options: RpcClientOptions;
  private client: UnderlyingRpcClient | null = null;

  constructor(options: RpcClientOptions = {}, deps: PiRpcClientDeps = defaultDeps) {
    this.options = options;
    this.deps = deps;
  }

  async start(): Promise<void> {
    const { args, ...rest } = this.options;
    const client = this.deps.createClient({
      ...rest,
      args: [...FIXED_ARGS, ...(args ?? [])],
    });
    this.client = client;
    await client.start();
  }

  onEvent(listener: EventListener): () => void {
    return this.requireClient().onEvent(listener);
  }

  onClose(listener: () => void): () => void {
    const client = this.requireClient();
    return client.onClose ? client.onClose(listener) : () => {};
  }

  getStderr(): string {
    return this.client ? this.client.getStderr() : '';
  }

  prompt(message: string, images?: unknown[]): Promise<void> {
    return this.requireClient().prompt(message, images);
  }

  abort(): Promise<void> {
    return this.requireClient().abort();
  }

  getState(): Promise<RpcSessionState> {
    return this.requireClient().getState();
  }

  getAvailableModels(): Promise<ModelInfo[]> {
    return this.requireClient().getAvailableModels();
  }

  getCommands(): Promise<RpcSlashCommand[]> {
    return this.requireClient().getCommands();
  }

  /**
   * Gracefully stop the underlying client. If it does not settle within
   * `graceMs`, stop waiting and resolve anyway (the official stop() has already
   * signalled the process; this is only a bounded-wait safety net).
   */
  async close(graceMs: number): Promise<void> {
    const client = this.client;
    if (!client) return;

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, graceMs);
    });
    const stopped = client.stop().then(
      () => undefined,
      () => undefined,
    );

    await Promise.race([stopped, timeout]);
    if (timer) clearTimeout(timer);
  }

  private requireClient(): UnderlyingRpcClient {
    if (!this.client) throw new Error('PiRpcClient not started');
    return this.client;
  }
}
