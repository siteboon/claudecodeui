/**
 * Private `opencode serve` process for one OpenCode chat turn.
 *
 * `opencode run` answers every permission request itself (it rejects them, or
 * approves them under `--auto`) and hides the question tool, so the chat can
 * never ask the user anything. OpenCode's own HTTP server exposes the same
 * session loop with the requests left open, so each turn starts a private
 * server instead and talks to it over loopback HTTP:
 *
 * - bound to 127.0.0.1 on a port picked here (never OpenCode's preferred 4096,
 *   so a server the user runs themselves is not displaced), with explicit
 *   flags so the user's `server.*` config cannot widen the binding;
 * - protected by a random Basic-auth password that only travels in the child
 *   environment, never in argv;
 * - stopped on every exit path, and synchronously when CloudCLI itself exits,
 *   because `opencode serve` does not exit when its parent dies.
 */
import { spawn as spawnChildProcess, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';

import crossSpawn from 'cross-spawn';

import type { AnyRecord } from '@/shared/types.js';
import { stripAnsiSequences } from '@/shared/utils.js';

const SERVER_USERNAME = 'opencode';
// Measured 2.3-8 s on a loaded Linux box (v1.18.25); generous for slow disks
// and Windows antivirus scans of the binary.
const LISTEN_TIMEOUT_MS = 60_000;
// The first request for a directory boots OpenCode's instance for it, which
// installs the user's plugins on a first run and can take minutes.
const FIRST_REQUEST_TIMEOUT_MS = 180_000;
const REQUEST_TIMEOUT_MS = 15_000;
const EVENTS_CONNECT_TIMEOUT_MS = 15_000;
// SIGTERM ends the server in 0.1-0.7 s (measured); SIGKILL after this grace.
const STOP_GRACE_MS = 3_000;
const STDERR_TAIL_LENGTH = 4_000;
const LISTENING_LINE = /listening on (https?:\/\/\S+)/;
// Start failures worth one more try: the port probed free was taken before
// the server bound it, or another OpenCode process (a previous turn's server
// shutting down, the TUI) held the shared opencode.db lock while this one
// booted (seen live: "database is locked").
const TRANSIENT_START_FAILURE = /EADDRINUSE|address already in use|port .* in use|database is locked/i;
const START_RETRY_DELAY_MS = 1_000;

const RUNS_DETACHED = process.platform !== 'win32';

/** Every private server that has not exited yet, for the exit-time sweep. */
const liveServers = new Set<OpenCodeServerProcess>();
let exitSweepInstalled = false;

/**
 * Thrown when a private `opencode serve` cannot be started or does not speak
 * the permission/question API, always before anything reached the model.
 * The OpenCode runtime (opencode-runtime.provider.js) catches it and runs the
 * turn through `opencode run` instead, exactly as before this server existed.
 */
export class OpenCodeServerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenCodeServerUnavailableError';
  }
}

type ServerExit = { code: number | null; signal: NodeJS.Signals | null };

type ServerResponse = { status: number; body: unknown };

function parseJsonBody(text: string): unknown {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port > 0 ? resolve(port) : reject(new Error('No free loopback port'))));
    });
  });
}

/**
 * Ends the server and everything it started that shares its process group.
 * POSIX: the server leads its own group (spawned detached), so one signal to
 * the group also reaches a wrapper script's child. Windows: `opencode` is a
 * .cmd shim, so the pid is cmd.exe; only `taskkill /T` ends the whole tree.
 */
function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals, synchronous: boolean): void {
  const { pid } = child;
  if (pid === undefined) {
    return;
  }

  if (process.platform === 'win32') {
    const args = ['/pid', String(pid), '/T', '/F'];
    if (synchronous) {
      spawnSync('taskkill', args, { stdio: 'ignore', windowsHide: true });
      return;
    }
    const killer = spawnChildProcess('taskkill', args, { stdio: 'ignore', windowsHide: true });
    killer.once('error', () => child.kill(signal));
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch {
    // The group is gone already, or the child never became a group leader.
    try {
      child.kill(signal);
    } catch {
      // Already exited.
    }
  }
}

function installExitSweep(): void {
  if (exitSweepInstalled) {
    return;
  }
  exitSweepInstalled = true;
  // CloudCLI's SIGTERM/SIGINT handlers end in process.exit(), and uncaught
  // crashes still run 'exit' listeners. Only a hard kill of CloudCLI itself
  // (SIGKILL, OOM, a Windows TerminateProcess) can leave a server behind.
  process.once('exit', () => {
    for (const server of liveServers) {
      server.killSynchronously();
    }
  });
}

/**
 * One private `opencode serve` child and a minimal client for its HTTP API.
 * Used only by the OpenCode serve runtime (opencode-serve.runtime.ts), which
 * owns one instance per chat turn.
 */
export class OpenCodeServerProcess {
  private readonly authorization: string;
  private readonly eventsController = new AbortController();
  private readonly longRequests = new Set<http.ClientRequest>();
  private readonly exitListeners = new Set<(exit: ServerExit) => void>();
  private exitInfo: ServerExit | null = null;
  private stopping: Promise<void> | null = null;
  private stderrTail = '';
  private bootstrapped = false;

  private constructor(
    private readonly child: ChildProcess,
    readonly baseUrl: string,
    password: string,
    private readonly directory: string,
    initialStderr: string,
  ) {
    this.authorization = `Basic ${Buffer.from(`${SERVER_USERNAME}:${password}`).toString('base64')}`;
    this.stderrTail = initialStderr;
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-STDERR_TAIL_LENGTH);
    });
    child.once('exit', (code, signal) => {
      this.exitInfo = { code, signal };
      liveServers.delete(this);
      for (const listener of this.exitListeners) {
        listener(this.exitInfo);
      }
    });
    liveServers.add(this);
    installExitSweep();
  }

  /**
   * Starts a server for `cwd` and resolves once it is listening. `signal`
   * aborts a start that is still waiting (the user stopped the turn).
   */
  static async start(options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  }): Promise<OpenCodeServerProcess> {
    for (let attempt = 0; ; attempt += 1) {
      const port = await allocateLoopbackPort();
      const password = randomBytes(24).toString('hex');
      const child = crossSpawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
        cwd: options.cwd,
        env: {
          ...options.env,
          OPENCODE_SERVER_PASSWORD: password,
          OPENCODE_SERVER_USERNAME: SERVER_USERNAME,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: RUNS_DETACHED,
        windowsHide: true,
      });
      // A late 'error' (a failed kill, say) must never become an uncaught
      // exception in CloudCLI; startup failures are read in waitForListening.
      child.on('error', () => {});

      try {
        const { baseUrl, stderr } = await waitForListening(child, options.signal);
        return new OpenCodeServerProcess(child, baseUrl, password, options.cwd, stderr);
      } catch (error) {
        signalProcessTree(child, 'SIGKILL', false);
        const retryable = error instanceof OpenCodeServerUnavailableError && TRANSIENT_START_FAILURE.test(error.message);
        if (attempt === 0 && retryable && !options.signal?.aborted) {
          await new Promise((resolve) => setTimeout(resolve, START_RETRY_DELAY_MS));
          continue;
        }
        throw error;
      }
    }
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  hasExited(): boolean {
    return this.exitInfo !== null;
  }

  /** Last few KB the server wrote to stderr, for an error message after a crash. */
  readStderrTail(): string {
    return this.stderrTail;
  }

  /** Registers a listener for the server process exiting (crash or stop). */
  onExit(listener: (exit: ServerExit) => void): void {
    if (this.exitInfo) {
      listener(this.exitInfo);
      return;
    }
    this.exitListeners.add(listener);
  }

  private url(pathname: string): string {
    const separator = pathname.includes('?') ? '&' : '?';
    return `${this.baseUrl}${pathname}${separator}directory=${encodeURIComponent(this.directory)}`;
  }

  /**
   * A short JSON request. The first one waits long enough for OpenCode to boot
   * its instance for the directory; later ones fail after 15 s.
   */
  async request(method: string, pathname: string, body?: unknown, timeoutMs?: number): Promise<ServerResponse> {
    const effectiveTimeout = timeoutMs ?? (this.bootstrapped ? REQUEST_TIMEOUT_MS : FIRST_REQUEST_TIMEOUT_MS);
    const response = await fetch(this.url(pathname), {
      method,
      headers: {
        authorization: this.authorization,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(effectiveTimeout),
    });
    this.bootstrapped = true;
    return { status: response.status, body: parseJsonBody(await response.text()) };
  }

  /**
   * A request without any client-side timeout, for the synchronous prompt:
   * it only answers when the whole turn has ended, which can take far longer
   * than fetch's built-in five-minute header timeout. `stop()` destroys it.
   */
  requestLong(method: string, pathname: string, body: unknown): Promise<ServerResponse> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const request = http.request(this.url(pathname), {
        method,
        headers: {
          authorization: this.authorization,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          this.longRequests.delete(request);
          resolve({
            status: response.statusCode ?? 0,
            body: parseJsonBody(Buffer.concat(chunks).toString('utf8')),
          });
        });
        response.on('error', (error) => {
          this.longRequests.delete(request);
          reject(error);
        });
      });
      request.on('error', (error) => {
        this.longRequests.delete(request);
        reject(error);
      });
      this.longRequests.add(request);
      request.end(payload);
    });
  }

  /**
   * Opens the server's event stream and resolves once OpenCode confirmed the
   * subscription (`server.connected`), so no event of the turn can be missed.
   * `closed` settles when the stream ends for any reason.
   */
  async subscribeEvents(onEvent: (type: string, properties: AnyRecord) => void): Promise<{ closed: Promise<void> }> {
    const response = await fetch(this.url('/event'), {
      headers: { authorization: this.authorization, accept: 'text/event-stream' },
      signal: this.eventsController.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`OpenCode event stream answered HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    let markConnected: () => void = () => {};
    let failConnect: (error: Error) => void = () => {};
    const connected = new Promise<void>((resolve, reject) => {
      markConnected = resolve;
      failConnect = reject;
    });
    const connectTimer = setTimeout(
      () => failConnect(new Error('OpenCode event stream sent no server.connected')),
      EVENTS_CONNECT_TIMEOUT_MS,
    );

    const closed = (async () => {
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');
            const event = parseServerSentEvent(block);
            if (!event) {
              continue;
            }
            if (event.type === 'server.connected') {
              markConnected();
            }
            try {
              onEvent(event.type, event.properties);
            } catch (error) {
              console.error('[OpenCode] Failed to handle server event:', event.type, error);
            }
          }
        }
      } catch {
        // Aborted by stop(), or the server went away; `closed` reports both.
      } finally {
        clearTimeout(connectTimer);
        failConnect(new Error('OpenCode event stream closed before it connected'));
      }
    })();

    await connected;
    return { closed };
  }

  /** Stops the server (idempotent); resolves once the process has exited. */
  stop(): Promise<void> {
    if (!this.stopping) {
      this.stopping = this.performStop();
    }
    return this.stopping;
  }

  private async performStop(): Promise<void> {
    this.eventsController.abort();
    for (const request of this.longRequests) {
      request.destroy();
    }
    this.longRequests.clear();
    if (this.hasExited()) {
      return;
    }

    signalProcessTree(this.child, 'SIGTERM', false);
    if (await this.waitForExit(STOP_GRACE_MS)) {
      return;
    }
    signalProcessTree(this.child, 'SIGKILL', false);
    await this.waitForExit(STOP_GRACE_MS);
  }

  private waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.hasExited()) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.exitListeners.delete(listener);
        resolve(false);
      }, timeoutMs);
      const listener = () => {
        clearTimeout(timer);
        resolve(true);
      };
      this.exitListeners.add(listener);
    });
  }

  /** Exit-time variant of stop(): nothing can be awaited inside 'exit'. */
  killSynchronously(): void {
    if (!this.hasExited()) {
      signalProcessTree(this.child, 'SIGTERM', true);
    }
  }
}

function parseServerSentEvent(block: string): { type: string; properties: AnyRecord } | null {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (!data) {
    return null;
  }

  try {
    const parsed = JSON.parse(data) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const { type, properties } = parsed as { type?: unknown; properties?: unknown };
    if (typeof type !== 'string') {
      return null;
    }
    return {
      type,
      properties: properties && typeof properties === 'object' ? properties as AnyRecord : {},
    };
  } catch {
    return null;
  }
}

/**
 * Resolves with the URL the server prints once it listens. Everything else
 * that ends the wait is a reason to fall back to `opencode run`.
 */
function waitForListening(child: ChildProcess, signal?: AbortSignal): Promise<{ baseUrl: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (error: Error | null, baseUrl?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      child.stdout?.off('data', onStdout);
      child.stderr?.off('data', onStderr);
      child.off('exit', onExit);
      child.off('error', onError);
      // Keep both pipes drained for the server's lifetime: a full pipe would
      // block the server on its next write.
      child.stdout?.resume();
      child.stderr?.resume();
      if (error) {
        reject(error);
        return;
      }
      resolve({ baseUrl: baseUrl as string, stderr: stderr.slice(-STDERR_TAIL_LENGTH) });
    };

    const onStdout = (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-STDERR_TAIL_LENGTH);
      const match = LISTENING_LINE.exec(stdout);
      if (match) {
        finish(null, match[1].replace(/\/+$/, ''));
      }
    };
    const onStderr = (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL_LENGTH);
    };
    const onExit = (code: number | null, exitSignal: NodeJS.Signals | null) => {
      const detail = stripAnsiSequences(stderr).trim() || stripAnsiSequences(stdout).trim();
      finish(new OpenCodeServerUnavailableError(
        `opencode serve exited before listening (code ${code}, signal ${exitSignal})${detail ? `: ${detail.slice(-500)}` : ''}`,
      ));
    };
    const onError = (error: Error) => {
      finish(new OpenCodeServerUnavailableError(`opencode serve could not be started: ${error.message}`));
    };
    const onAbort = () => {
      finish(new OpenCodeServerUnavailableError('opencode serve start was aborted'));
    };

    const timer = setTimeout(() => {
      finish(new OpenCodeServerUnavailableError(`opencode serve did not listen within ${LISTEN_TIMEOUT_MS / 1000} s`));
    }, LISTEN_TIMEOUT_MS);

    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.stdout?.on('error', () => {});
    child.stderr?.on('error', () => {});
    child.once('exit', onExit);
    child.once('error', onError);
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}
