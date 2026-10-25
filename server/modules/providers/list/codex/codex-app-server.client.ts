import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import readline from 'node:readline';

import { AppError } from '@/shared/utils.js';

/**
 * Minimal JSON-RPC client for `codex app-server`.
 *
 * Codex ships two entry points and they expose different things. The
 * `@openai/codex-sdk` is a wrapper around `codex exec`, and its whole surface
 * is `startThread` and `resumeThread` — one input per process, no way to
 * branch a thread or to resume one partway. The same binary's `app-server`
 * subcommand speaks JSON-RPC and has those primitives: `thread/fork`, which
 * the Codex IDE clients build "fork" and "edit an earlier message" on, and
 * `turn/steer`, which hands a running turn more input.
 *
 * Chat turns run over this transport (see codex-runtime.provider.ts) so they
 * can be steered; the SDK path stays behind CLOUDCLI_CODEX_TRANSPORT=exec as
 * a fallback.
 */

/** How long a single request may take before the child is killed. */
const REQUEST_TIMEOUT_MS = 30_000;

type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
};

/**
 * One fork of a Codex thread.
 *
 * `path` is returned by the server rather than reconstructed: the rollout
 * lands in today's date directory, not next to the file it was copied from,
 * so deriving it from the source path would be wrong roughly every day.
 */
export type CodexThreadFork = {
  threadId: string;
  path: string;
};

/** Raw quota windows consumed by the Providers plan usage service. */
export type CodexRateLimitWindow = {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
};

/** The Codex app server's included usage snapshot for the active account. */
export type CodexRateLimitSnapshot = {
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
};

/**
 * Resolves the `codex` launcher shipped in node_modules.
 *
 * Deliberately not the `codex` on PATH: a machine can have a second, older
 * install, and the protocol this speaks is only guaranteed against the
 * version this package depends on.
 */
function resolveCodexLauncher(): string {
  const require_ = createRequire(import.meta.url);
  try {
    return require_.resolve('@openai/codex/bin/codex.js');
  } catch {
    throw new AppError('The Codex CLI package is not installed, so Codex conversations cannot be branched.', {
      code: 'CODEX_APP_SERVER_UNAVAILABLE',
      statusCode: 501,
    });
  }
}

/** A `codex app-server` child, or a scripted stand-in with the same pipes. */
export type CodexAppServerChild = Pick<ChildProcess, 'stdin' | 'stdout' | 'stderr' | 'on' | 'kill'>;

/** Answers one server-to-client request (an approval prompt); a throw becomes a JSON-RPC error. */
export type CodexServerRequestHandler = (
  method: string,
  params: Record<string, unknown>,
  requestId: number | string,
) => Promise<unknown>;

/**
 * One open connection to a `codex app-server` child.
 *
 * The one-shot helpers below open one for a single exchange; a running chat
 * keeps one open for its whole turn, because steering and interrupting are
 * requests against the turn that child is running.
 */
export type CodexAppServerConnection = {
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
  /** Called for every server notification, in arrival order. */
  onNotification(handler: (method: string, params: Record<string, unknown>) => void): void;
  /** Answers approval prompts and other server requests. Without one they are refused. */
  onServerRequest(handler: CodexServerRequestHandler): void;
  /** Called once when the child goes away, for whatever reason. */
  onExit(handler: (reason: string) => void): void;
  /** Why the child went away, or null while it runs. */
  readonly exitReason: string | null;
  /** The last line the child wrote to stderr, for explaining a crash. */
  lastStderrLine(): string;
  close(): void;
};

type JsonRpcIncoming = JsonRpcResponse & {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
};

/**
 * Spawns `codex app-server` and completes the initialize handshake.
 *
 * `spawnChild` exists for tests, which script the child's stdout instead of
 * running the CLI.
 */
export async function openCodexAppServer(options: {
  cwd?: string;
  spawnChild?: () => CodexAppServerChild;
} = {}): Promise<CodexAppServerConnection> {
  const child = options.spawnChild
    ? options.spawnChild()
    : spawn(process.execPath, [resolveCodexLauncher(), 'app-server'], {
      cwd: options.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

  // The server logs sandbox and skill warnings to stderr on every start. They
  // are not failures and drowning the app log in them helps nobody, so stderr
  // is only kept around to explain a spawn that dies.
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-2000);
  });

  let nextRequestId = 1;
  const pending = new Map<number, (response: JsonRpcResponse) => void>();
  let exitReason: string | null = null;
  let notificationHandler: (method: string, params: Record<string, unknown>) => void = () => {};
  let serverRequestHandler: CodexServerRequestHandler | null = null;
  const exitHandlers: Array<(reason: string) => void> = [];

  const write = (message: unknown) => {
    if (!exitReason) {
      child.stdin?.write(`${JSON.stringify(message)}\n`);
    }
  };

  const answerServerRequest = async (id: number | string, method: string, params: Record<string, unknown>) => {
    if (!serverRequestHandler) {
      write({ jsonrpc: '2.0', id, error: { code: -32601, message: `${method} is not supported by this client` } });
      return;
    }
    try {
      const result = await serverRequestHandler(method, params, id);
      write({ jsonrpc: '2.0', id, result });
    } catch (error) {
      write({ jsonrpc: '2.0', id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
    }
  };

  const reader = readline.createInterface({ input: child.stdout! });
  reader.on('line', (line) => {
    if (!line.trim()) {
      return;
    }
    let message: JsonRpcIncoming;
    try {
      message = JSON.parse(line) as JsonRpcIncoming;
    } catch {
      // A non-JSON banner is not a reply to anything this client asked for.
      return;
    }
    if (typeof message.method === 'string') {
      // Requests from the server carry an id of their own, which can collide
      // with this client's ids; the method is what tells them apart.
      if (message.id !== undefined && message.id !== null) {
        void answerServerRequest(message.id, message.method, message.params ?? {});
      } else {
        notificationHandler(message.method, message.params ?? {});
      }
      return;
    }
    if (typeof message.id !== 'number') {
      return;
    }
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });

  const failPending = (reason: string) => {
    if (!exitReason) {
      exitReason = reason;
      for (const handler of exitHandlers) {
        handler(reason);
      }
    }
    for (const resolve of pending.values()) {
      resolve({ error: { message: reason } });
    }
    pending.clear();
  };

  child.on('error', (error: Error) => failPending(error.message));
  child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    failPending(`codex app-server exited (code ${code ?? 'null'}, signal ${signal ?? 'null'})`);
  });
  // A child that dies mid-request leaves its pipes broken, and the next write
  // raises EPIPE on the stream rather than at the call site. Without a
  // listener that is an unhandled 'error' event, which takes the whole server
  // down over one failed request.
  child.stdin?.on('error', (error) => failPending(error.message));
  child.stdout?.on('error', (error) => failPending(error.message));
  child.stderr?.on('error', () => {});

  const lastStderrLine = () => stderr.trim().split('\n').slice(-1)[0] || '';

  const request = (method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (exitReason) {
        reject(new AppError(`Codex app-server is not running: ${exitReason}`, {
          code: 'CODEX_APP_SERVER_UNAVAILABLE',
          statusCode: 502,
        }));
        return;
      }

      const id = nextRequestId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new AppError(`Codex app-server did not answer "${method}" within ${timeoutMs}ms.`, {
          code: 'CODEX_APP_SERVER_TIMEOUT',
          statusCode: 504,
        }));
      }, timeoutMs);

      pending.set(id, (response) => {
        clearTimeout(timer);
        if (response.error) {
          reject(new AppError(response.error.message || `Codex app-server rejected "${method}".`, {
            code: 'CODEX_APP_SERVER_ERROR',
            statusCode: 502,
            details: { method, rpcCode: response.error.code },
          }));
          return;
        }
        resolve(response.result);
      });

      write({ jsonrpc: '2.0', id, method, params });
    });

  const close = () => {
    reader.close();
    child.kill();
  };

  try {
    // `capabilities` is deliberately empty. Everything used here — fork with
    // `lastTurnId`, turn start/steer/interrupt — is in the stable protocol.
    await request('initialize', {
      clientInfo: { name: 'cloudcli', title: 'CloudCLI', version: '1' },
      capabilities: {},
    });
    write({ jsonrpc: '2.0', method: 'initialized', params: {} });
  } catch (error) {
    close();
    throw withStderr(error, exitReason, lastStderrLine());
  }

  return {
    request,
    onNotification(handler) {
      notificationHandler = handler;
    },
    onServerRequest(handler) {
      serverRequestHandler = handler;
    },
    onExit(handler) {
      exitHandlers.push(handler);
    },
    get exitReason() {
      return exitReason;
    },
    lastStderrLine,
    close,
  };
}

/** Adds the child's last stderr line to an error caused by the child dying. */
function withStderr(error: unknown, exitReason: string | null, stderrLine: string): unknown {
  if (error instanceof AppError && exitReason) {
    return new AppError(`${error.message}${stderrLine ? ` — ${stderrLine}` : ''}`, {
      code: error.code,
      statusCode: error.statusCode,
    });
  }
  return error;
}

/**
 * Runs one exchange against a freshly spawned `codex app-server`.
 *
 * A process per operation rather than a pooled long-lived one: the handshake
 * costs a fraction of a second, forking happens at most once per user action,
 * and a shared child would need lifecycle handling — restarts, back-pressure,
 * a crash taking every pending fork with it — for no measurable gain next to
 * the model turn that follows.
 */
async function withAppServer<T>(
  run: (call: (method: string, params: unknown) => Promise<unknown>) => Promise<T>,
): Promise<T> {
  const connection = await openCodexAppServer();
  try {
    return await run((method, params) => connection.request(method, params));
  } catch (error) {
    throw withStderr(error, connection.exitReason, connection.lastStderrLine());
  } finally {
    connection.close();
  }
}

export const codexAppServer = {
  /** Reads the active account's plan limits for the Providers settings panel. */
  async readRateLimits(): Promise<CodexRateLimitSnapshot> {
    return withAppServer(async (call) => {
      const result = await call('account/rateLimits/read', {
        excludeResetCreditDetails: true,
      }) as {
        rateLimits?: CodexRateLimitSnapshot;
        rateLimitsByLimitId?: Record<string, CodexRateLimitSnapshot> | null;
      } | undefined;
      const limits = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
      if (!limits) {
        throw new AppError('Codex did not return plan limits.', {
          code: 'CODEX_PLAN_USAGE_UNAVAILABLE',
          statusCode: 502,
        });
      }
      return limits;
    });
  },

  /**
   * Copies a thread into a new one that ends at `lastTurnId`, or copies the
   * whole thread when it is omitted.
   *
   * `lastTurnId` is inclusive of the turn it names, which is the same
   * convention the app's edit anchor uses ("the last row to keep").
   *
   * `cwd` decides the working directory recorded in the copy's `session_meta`,
   * and that field is what the session indexer keys a session's project off —
   * omitting it would file every fork under whatever directory this server
   * happens to be running from.
   */
  async forkThread(input: {
    threadId: string;
    lastTurnId?: string;
    cwd: string;
  }): Promise<CodexThreadFork> {
    return withAppServer(async (call) => {
      const result = await call('thread/fork', {
        threadId: input.threadId,
        ...(input.lastTurnId ? { lastTurnId: input.lastTurnId } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {}),
      }) as { thread?: { id?: unknown; path?: unknown } } | undefined;

      const threadId = typeof result?.thread?.id === 'string' ? result.thread.id : '';
      const path = typeof result?.thread?.path === 'string' ? result.thread.path : '';
      if (!threadId || !path) {
        throw new AppError('Codex reported a fork without a thread id or transcript path.', {
          code: 'FORK_FAILED',
          statusCode: 502,
        });
      }

      // Confirmed rather than trusted: both callers are about to point a
      // database row at this file, and a row naming a transcript that is not
      // there is a session that can never be opened.
      try {
        await stat(path);
      } catch {
        throw new AppError('Codex reported a fork but wrote no transcript for it.', {
          code: 'FORK_FAILED',
          statusCode: 502,
        });
      }

      return { threadId, path };
    });
  },
};
