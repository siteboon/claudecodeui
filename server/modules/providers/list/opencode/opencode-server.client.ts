import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import crossSpawn from 'cross-spawn';

import { AppError } from '@/shared/utils.js';

/**
 * HTTP client for `opencode serve`.
 *
 * OpenCode keeps every conversation in one shared opencode.db, so this app
 * cannot fork one by copying a transcript file the way Claude does, and it
 * must not write into that database from outside — the CLI owns its WAL and
 * would race any live `opencode run` or TUI process on the other half of it.
 * The binary's own server mode, however, exposes `POST /session/{id}/fork`,
 * which performs the copy through OpenCode's own connection and rewrites every
 * message reference the way a fork should. So this is a second transport to
 * the same CLI, opened only for the operations the `opencode run` CLI cannot
 * express — the same arrangement the Codex app-server client has with Codex.
 *
 * One short-lived server per operation rather than a pooled one: the spawn
 * costs about a second, forking happens at most once per user action, and a
 * shared child would need lifecycle handling for no measurable gain.
 */

/** How long one operation may take before the child is killed. */
const REQUEST_TIMEOUT_MS = 60_000;

/** How long the server may take to announce its listening URL. */
const LISTEN_TIMEOUT_MS = 30_000;

/**
 * Runs one exchange against a freshly spawned `opencode serve`.
 *
 * The child gets an explicitly generated server password instead of inheriting
 * the environment's: OpenCode turns on Basic auth the moment
 * OPENCODE_SERVER_PASSWORD is present, a developer machine can already export
 * it globally, and reading whatever was lying around would mean this client
 * not knowing the secret it has to authenticate with.
 */
async function withOpenCodeServer<T>(
  workingDir: string,
  run: (request: (path: string, init?: RequestInit) => Promise<Response>) => Promise<T>,
): Promise<T> {
  const serverPassword = randomBytes(24).toString('hex');
  // cross-spawn resolves the .cmd shim on Windows; opencode is one on PATH there.
  const child = crossSpawn('opencode', ['serve', '--port', '0', '--hostname', '127.0.0.1'], {
    cwd: workingDir || undefined,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, OPENCODE_SERVER_PASSWORD: serverPassword },
  }) as ChildProcessWithoutNullStreams;

  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-2000);
  });
  // The child dying mid-pipe raises EPIPE on the stream rather than at the
  // call site; without listeners that is an unhandled 'error' event taking the
  // whole app server down over one failed fork.
  child.stdin?.on('error', () => {});
  child.stdout?.on('error', () => {});
  child.stderr?.on('error', () => {});

  let exitInfo: string | null = null;
  child.on('error', (error) => { exitInfo = error.message; });
  child.on('exit', (code, signal) => {
    exitInfo = `opencode serve exited (code ${code ?? 'null'}, signal ${signal ?? 'null'})`;
  });

  const authHeader = `Basic ${Buffer.from(`opencode:${serverPassword}`).toString('base64')}`;

  try {
    const baseUrl = await new Promise<string>((resolve, reject) => {
      const fail = (reason: string) => {
        clearTimeout(timer);
        reject(new AppError(`OpenCode server did not start: ${reason}${stderr ? ` — ${stderr.trim().split('\n').slice(-1)[0]}` : ''}`, {
          code: 'OPENCODE_SERVER_UNAVAILABLE',
          statusCode: 502,
        }));
      };

      const timer = setTimeout(() => fail(`no listening line within ${LISTEN_TIMEOUT_MS}ms`), LISTEN_TIMEOUT_MS);
      let buffer = '';
      child.stdout?.on('data', (chunk) => {
        buffer += String(chunk);
        // Verified banner against v1.18: "opencode server listening on http://127.0.0.1:<port>".
        const match = buffer.match(/listening on (http:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.on('exit', () => fail(exitInfo ?? 'exited before announcing a listening URL'));
      child.on('error', (error) => fail(error.message));
    });

    const request = (path: string, init: RequestInit = {}): Promise<Response> => {
      if (exitInfo) {
        throw new AppError(`OpenCode server is not running: ${exitInfo}`, {
          code: 'OPENCODE_SERVER_UNAVAILABLE',
          statusCode: 502,
        });
      }
      const url = new URL(path, baseUrl);
      return fetch(url, {
        ...init,
        headers: { authorization: authHeader, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    };

    return await run(request);
  } finally {
    child.kill();
  }
}

export const openCodeServer = {
  /**
   * Copies a session into a new one that ends just before `messageID`, or
   * copies the whole session when it is omitted.
   *
   * The cut is EXCLUSIVE of the message named — verified against a live
   * v1.18 server: forking at a session's second user prompt kept everything
   * before it and neither that prompt nor its answer. This contract's
   * `upToAnchorId` means "keep this message too", so callers hand over the id
   * to cut BEFORE, not the anchor itself.
   *
   * `directory` decides where OpenCode files the copy. It is passed through
   * whenever the session has a working directory so the fork is found by the
   * same `opencode run --dir` lookup the runtime uses to resume it.
   */
  async forkSession(input: {
    sessionId: string;
    /** Cut point, exclusive; omitted copies the whole session. */
    cutBeforeMessageId?: string;
    directory?: string;
  }): Promise<{ sessionId: string }> {
    return withOpenCodeServer(input.directory ?? '', async (request) => {
      const url = new URL(`/session/${encodeURIComponent(input.sessionId)}/fork`, 'http://placeholder');
      if (input.directory) {
        url.searchParams.set('directory', input.directory);
      }

      let response: Response;
      try {
        response = await request(url.pathname + url.search, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input.cutBeforeMessageId ? { messageID: input.cutBeforeMessageId } : {}),
        });
      } catch (error) {
        throw new AppError(`Could not reach the OpenCode server for the fork: ${error instanceof Error ? error.message : String(error)}`, {
          code: 'OPENCODE_SERVER_UNAVAILABLE',
          statusCode: 502,
        });
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new AppError(`OpenCode rejected the fork (HTTP ${response.status})${body ? `: ${body.slice(0, 300)}` : '.'}`, {
          code: 'FORK_FAILED',
          statusCode: 502,
        });
      }

      const session = await response.json() as { id?: unknown };
      const sessionId = typeof session?.id === 'string' ? session.id : '';
      // Confirmed rather than trusted: the caller is about to write a database
      // row claiming this session exists, and the id shape OpenCode uses is
      // `ses_...` — anything else means the response was not a session.
      if (!sessionId.startsWith('ses_')) {
        throw new AppError('OpenCode reported a fork without a session id.', {
          code: 'FORK_FAILED',
          statusCode: 502,
        });
      }

      return { sessionId };
    });
  },
};
