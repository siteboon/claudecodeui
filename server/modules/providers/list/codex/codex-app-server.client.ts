import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import readline from 'node:readline';

import {
  AppError,
  SIDE_CONVERSATION_BOUNDARY_PROMPT,
  SIDE_CONVERSATION_DEVELOPER_INSTRUCTIONS,
} from '@/shared/utils.js';

/**
 * Minimal JSON-RPC client for `codex app-server`.
 *
 * Codex ships two entry points and they expose different things. The
 * `@openai/codex-sdk` this app runs conversations through is a wrapper around
 * `codex exec`, and its whole surface is `startThread` and `resumeThread` —
 * there is no way to branch a thread or to resume one partway. The same
 * binary's `app-server` subcommand speaks JSON-RPC and does have that
 * primitive, `thread/fork`, which is what the Codex IDE clients build their
 * own "fork" and "edit an earlier message" on top of.
 *
 * So this is a second transport to the same CLI, opened only for the
 * operations the SDK cannot express. Everything else still goes through the
 * SDK.
 */

/** How long a single request may take before the child is killed. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * How long a side-question turn may run before it is given up on. Not
 * measured like `REQUEST_TIMEOUT_MS`: a side question is a model turn, not a
 * handshake request, and can legitimately run for minutes on a hard
 * question. 5 minutes is a generous ceiling against a turn that never sends
 * `turn/completed` (a hung child, a provider bug) rather than a tuned value.
 */
const SIDE_QUESTION_TURN_TIMEOUT_MS = 5 * 60_000;

type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
};

/** A line from the app-server: a reply to us, a notification, or a server request. */
type JsonRpcLine = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

/** Handler for a notification the app-server sent us (never a reply). */
type NotificationHandler = (method: string, params: unknown) => void;

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
  run: (helpers: {
    call: (method: string, params: unknown) => Promise<unknown>;
    /** Registers a handler for every notification (no `id`) the app-server sends. Returns a function that removes it. */
    onNotification: (handler: NotificationHandler) => () => void;
    /**
     * Registers a handler for the child exiting or erroring. Separate from
     * `call()`'s own rejection: a waiter that is not sitting on a pending
     * request (e.g. `askSideQuestion` waiting on a `turn/completed`
     * notification) would otherwise only learn the child is gone once its
     * own timeout fires, minutes later.
     */
    onExit: (handler: (reason: string) => void) => () => void;
  }) => Promise<T>,
): Promise<T> {
  // Resolved through the exported object, not a module-local function, so
  // tests can replace `codexAppServer.resolveLauncher` with a fake app-server
  // script the same way they already replace `forkThread`.
  const launcher = codexAppServer.resolveLauncher();
  const child = spawn(process.execPath, [launcher, 'app-server'], {
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
  const notificationListeners = new Set<NotificationHandler>();
  let exitReason: string | null = null;

  const onNotification = (handler: NotificationHandler): (() => void) => {
    notificationListeners.add(handler);
    return () => notificationListeners.delete(handler);
  };

  const exitListeners = new Set<(reason: string) => void>();
  const onExit = (handler: (reason: string) => void): (() => void) => {
    exitListeners.add(handler);
    return () => exitListeners.delete(handler);
  };

  const reader = readline.createInterface({ input: child.stdout });
  reader.on('line', (line) => {
    if (!line.trim()) {
      return;
    }
    let message: JsonRpcLine;
    try {
      message = JSON.parse(line) as JsonRpcLine;
    } catch {
      // Any non-JSON banner is not a reply to anything this client asked for.
      return;
    }

    // A line with `method` is never a reply, even when its `id` happens to
    // match one of our own pending requests (the app-server reuses our
    // `turn/start` id when it turns around and asks *us* something).
    if (typeof message.method === 'string') {
      if (typeof message.id === 'number') {
        // A server request (`item/tool/requestUserInput`,
        // `mcpServer/elicitation/request`, `item/tool/call`, …) that
        // `approvalPolicy: 'never'` does not suppress. A side question has no
        // one to answer it, so it is rejected at once rather than left
        // pending — an unanswered one stalls the turn that is waiting on it.
        child.stdin?.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'Side questions do not support interactive requests.' },
        })}\n`);
        return;
      }
      for (const handler of notificationListeners) {
        handler(message.method, message.params);
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
    exitReason = reason;
    for (const resolve of pending.values()) {
      resolve({ error: { message: reason } });
    }
    pending.clear();
    for (const listener of exitListeners) {
      listener(reason);
    }
  };

  child.on('error', (error) => failPending(error.message));
  child.on('exit', (code, signal) => {
    failPending(`codex app-server exited (code ${code ?? 'null'}, signal ${signal ?? 'null'})`);
  });
  // A child that dies mid-request leaves its pipes broken, and the next write
  // raises EPIPE on the stream rather than at the call site. Without a
  // listener that is an unhandled 'error' event, which takes the whole server
  // down over one failed fork.
  child.stdin?.on('error', (error) => failPending(error.message));
  child.stdout?.on('error', (error) => failPending(error.message));
  child.stderr?.on('error', () => {});

  const call = (method: string, params: unknown): Promise<unknown> =>
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
        reject(new AppError(`Codex app-server did not answer "${method}" within ${REQUEST_TIMEOUT_MS}ms.`, {
          code: 'CODEX_APP_SERVER_TIMEOUT',
          statusCode: 504,
        }));
      }, REQUEST_TIMEOUT_MS);

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

      child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  try {
    // `capabilities` is deliberately empty. `thread/fork` with `lastTurnId` is
    // in the stable protocol; only `beforeTurnId` and the turn-listing methods
    // are gated behind `experimentalApi`, and neither is needed here.
    await call('initialize', {
      clientInfo: { name: 'cloudcli', title: 'CloudCLI', version: '1' },
      capabilities: {},
    });
    child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`);

    return await run({ call, onNotification, onExit });
  } catch (error) {
    if (error instanceof AppError && exitReason) {
      throw new AppError(`${error.message}${stderr ? ` — ${stderr.trim().split('\n').slice(-1)[0]}` : ''}`, {
        code: error.code,
        statusCode: error.statusCode,
      });
    }
    throw error;
  } finally {
    reader.close();
    child.kill();
  }
}

export const codexAppServer = {
  /**
   * Resolves the `codex` launcher shipped in node_modules.
   *
   * Deliberately not the `codex` on PATH: a machine can have a second, older
   * install, and the protocol this speaks is only guaranteed against the
   * version this package depends on. A property on the exported object
   * rather than a module function so tests can swap in a fake app-server
   * script, the same seam `forkThread` already uses.
   */
  resolveLauncher(): string {
    const require_ = createRequire(import.meta.url);
    try {
      return require_.resolve('@openai/codex/bin/codex.js');
    } catch {
      throw new AppError('The Codex CLI package is not installed, so Codex conversations cannot be branched.', {
        code: 'CODEX_APP_SERVER_UNAVAILABLE',
        statusCode: 501,
      });
    }
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
    return withAppServer(async ({ call }) => {
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

  /**
   * Asks one question on an ephemeral, read-only fork of `threadId` and
   * resolves the concatenated answer. Used by `codexRuntime.askSideQuestion`
   * (`codex-runtime.provider.ts`) to answer a side question without touching
   * the parent thread.
   *
   * `ephemeral: true` keeps the fork off disk; `excludeTurns: true` only
   * leaves `thread.turns` out of the `thread/fork` response — this fork is
   * never listed anywhere, so there is nothing else for it to exclude.
   * `sandbox: 'read-only'` and `approvalPolicy: 'never'` keep it from
   * mutating anything while it has no one to approve a request. The turn
   * itself is the boundary prompt followed by the question, exactly as
   * Codex's own side-conversation support sends it.
   */
  async askSideQuestion(
    input: { threadId: string; cwd: string; model: string; question: string; signal: AbortSignal },
    onDelta: (text: string) => void,
  ): Promise<string> {
    const abortedError = () => new AppError('The side question was aborted.', {
      code: 'CODEX_SIDE_QUESTION_ABORTED',
      statusCode: 499,
    });

    return withAppServer(async ({ call, onNotification, onExit }) => {
      return new Promise<string>((resolve, reject) => {
        let text = '';
        let settled = false;
        let removeNotificationListener: (() => void) | null = null;
        let removeExitListener: (() => void) | null = null;

        const timer = setTimeout(() => {
          settle(() => reject(new AppError(
            `Codex side question did not complete within ${SIDE_QUESTION_TURN_TIMEOUT_MS}ms.`,
            { code: 'CODEX_SIDE_QUESTION_TIMEOUT', statusCode: 504 },
          )));
        }, SIDE_QUESTION_TURN_TIMEOUT_MS);

        const onAbort = () => {
          settle(() => reject(abortedError()));
        };
        // Attached before the `thread/fork` request even goes out, so a
        // dismiss during `initialize`/`thread/fork` is caught the same way
        // as one during the turn itself — it used to be added only once the
        // fork had already returned, and an abort in that window was lost.
        input.signal.addEventListener('abort', onAbort);

        function settle(action: () => void) {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          input.signal.removeEventListener('abort', onAbort);
          removeNotificationListener?.();
          removeExitListener?.();
          action();
        }

        if (input.signal.aborted) {
          settle(() => reject(abortedError()));
          return;
        }

        call('thread/fork', {
          threadId: input.threadId,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.model ? { model: input.model } : {}),
          ephemeral: true,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          developerInstructions: SIDE_CONVERSATION_DEVELOPER_INSTRUCTIONS,
          excludeTurns: true,
        }).then((forkResult) => {
          if (settled) {
            // Aborted, or already timed out, while the fork request was in flight.
            return;
          }

          const typedForkResult = forkResult as { thread?: { id?: unknown } } | undefined;
          const forkThreadId = typeof typedForkResult?.thread?.id === 'string' ? typedForkResult.thread.id : '';
          if (!forkThreadId) {
            settle(() => reject(new AppError('Codex reported a side-question fork without a thread id.', {
              code: 'FORK_FAILED',
              statusCode: 502,
            })));
            return;
          }

          // From here on the turn waiter sits on a notification, not a
          // pending `call()`, so a child that exits mid-turn would otherwise
          // only be noticed once `SIDE_QUESTION_TURN_TIMEOUT_MS` elapses.
          removeExitListener = onExit((reason) => {
            settle(() => reject(new AppError(
              `Codex exited before the side-question turn finished (${reason}).`,
              { code: 'CODEX_SIDE_QUESTION_FAILED', statusCode: 502 },
            )));
          });

          removeNotificationListener = onNotification((method, params) => {
            const notificationParams = params as { threadId?: unknown; delta?: unknown; turn?: { status?: unknown; error?: { message?: unknown } } } | undefined;
            // Another thread's deltas (e.g. the one this fork was copied from)
            // arrive on the same connection; only this fork's own notifications
            // belong to this question.
            if (notificationParams?.threadId !== forkThreadId) {
              return;
            }

            if (method === 'item/agentMessage/delta') {
              const delta = typeof notificationParams.delta === 'string' ? notificationParams.delta : '';
              if (delta) {
                text += delta;
                onDelta(delta);
              }
              return;
            }

            if (method === 'turn/completed') {
              const status = notificationParams.turn?.status;
              if (status === 'completed') {
                settle(() => resolve(text));
                return;
              }
              const message = typeof notificationParams.turn?.error?.message === 'string'
                ? notificationParams.turn.error.message
                : `Codex side-question turn ${String(status)}.`;
              settle(() => reject(new AppError(message, { code: 'CODEX_SIDE_QUESTION_FAILED', statusCode: 502 })));
            }
          });

          if (settled) {
            return;
          }

          call('turn/start', {
            threadId: forkThreadId,
            input: [
              { type: 'text', text: SIDE_CONVERSATION_BOUNDARY_PROMPT, text_elements: [] },
              { type: 'text', text: input.question, text_elements: [] },
            ],
          }).catch((error) => {
            settle(() => reject(error));
          });
        }).catch((error) => {
          settle(() => reject(error));
        });
      });
    });
  },
};
