import type { ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

import crossSpawn from 'cross-spawn';

import { AppError } from '@/shared/utils.js';

// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;

/** How long a command may go unanswered before its request fails. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** How many trailing stderr characters are kept to explain a failure. */
const STDERR_TAIL_LENGTH = 2_000;
/** How long the child gets to exit on its own once its stdin is closed. */
const EXIT_GRACE_MS = 2_000;
/** How much longer it gets after SIGTERM before it is SIGKILLed. */
const SIGTERM_GRACE_MS = 2_000;

/**
 * One stdout record of `pi --mode rpc` (pi 1.6).
 *
 * The protocol has four record families: commands go in on stdin; a
 * `response` answers a command; session events (`agent_start`,
 * `message_update`, `tool_execution_end`, `agent_settled`, ...) stream out;
 * and `extension_ui_request` records forward extension dialogs. Everything
 * that is not a pending command's `response` reaches `PiRpcClient.onRecord`
 * as this shape.
 *
 * Consumer: `pi-runtime.provider.ts`, which owns every interpretation of
 * these records.
 */
export type PiRpcRecord = {
  type: string;
  [field: string]: unknown;
};

/**
 * How the `pi --mode rpc` child ended.
 *
 * Both fields are null when the child could not be spawned at all.
 * Consumer: `pi-runtime.provider.ts`, for the terminal `complete` and the
 * failure message.
 */
export type PiRpcExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

type PendingRequest = {
  command: string;
  settle(error: AppError | null, data?: unknown): void;
  timer: NodeJS.Timeout;
};

/**
 * Subprocess client for `pi --mode rpc` (pi 1.6).
 *
 * Why RPC rather than the one-shot `pi -p --mode json`: print mode can only
 * be stopped by signalling the process, and a signal reaches whatever the
 * `pi` launcher is — a `.cmd` shim on Windows, a shell wrapper elsewhere —
 * and not necessarily the Node process running the agent. An aborted turn
 * could then keep running, and keep appending to the session file, after the
 * gateway had already reported it as cancelled. In RPC mode the agent stops
 * itself on an `abort` command and reports `agent_settled`.
 *
 * This client is transport only. It correlates commands with responses,
 * hands every other record to `onRecord`, and shuts the child down; it never
 * interprets a session event. `pi-runtime.provider.ts` is its only consumer.
 */
export class PiRpcClient {
  /**
   * Resolves once the child process has exited (or failed to spawn).
   *
   * Deliberately not tied to the stdio pipes closing: a tool that left a
   * background process behind keeps the pipes open after `pi` itself is gone,
   * and a shutdown that waited for that would never return.
   */
  readonly exited: Promise<PiRpcExit>;

  /** Receives every stdout record that is not the answer to a pending command. */
  onRecord: ((record: PiRpcRecord) => void) | null = null;

  /** The last few hundred characters pi wrote to stderr, to explain a failure. */
  get stderrTail(): string {
    return this.stderrTailValue;
  }

  private readonly child: ChildProcess;
  private readonly pending = new Map<string, PendingRequest>();
  private nextRequestId = 1;
  private stdoutBuffer = '';
  private readonly stdoutDecoder = new StringDecoder('utf8');
  private readonly stderrDecoder = new StringDecoder('utf8');
  private stderrTailValue = '';
  private exit: PiRpcExit | null = null;
  private spawnError: NodeJS.ErrnoException | null = null;
  private resolveExited!: (exit: PiRpcExit) => void;
  private shutdownTimer: NodeJS.Timeout | null = null;
  private killTimer: NodeJS.Timeout | null = null;

  /**
   * Starts `pi` with `argv` and opens the command channel.
   *
   * `argv` is the full argument list after the binary name; the client adds
   * nothing, so the invocation is decided in one place (`buildPiArgs`).
   * A missing binary does not throw here — it surfaces asynchronously as a
   * rejected `exited`-time error on every pending command, with the spawn
   * error's code in `details.spawnCode`.
   */
  constructor(argv: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }) {
    this.exited = new Promise((resolve) => {
      this.resolveExited = resolve;
    });

    this.child = spawnFunction('pi', [...argv], {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // pi has no permission levers, so unlike opencode there is no env
      // override to merge here — the user's own pi config governs.
      env: options.env,
    });

    // Decoders span chunk boundaries: stdout/stderr arrive in arbitrary Buffer
    // chunks and a multi-byte character can straddle two of them, which a
    // chunk-local `toString()` would render as U+FFFD.
    this.child.stdout?.on('data', (data: Buffer) => {
      this.stdoutBuffer += this.stdoutDecoder.write(data);
      // Strict JSONL: records are split on LF only. Node's readline also
      // breaks on U+2028/U+2029, which are valid inside JSON strings.
      const completeLines = this.stdoutBuffer.split('\n');
      this.stdoutBuffer = completeLines.pop() || '';
      for (const line of completeLines) {
        this.handleLine(line);
      }
    });

    // Stdout is reserved for protocol records; diagnostics go to stderr.
    // They are kept, not forwarded: a run that ends well has nothing to do
    // with the warnings pi printed on its way up, while a run that fails is
    // far easier to explain with the last thing pi said.
    this.child.stderr?.on('data', (data: Buffer) => {
      this.stderrTailValue = (this.stderrTailValue + this.stderrDecoder.write(data)).slice(-STDERR_TAIL_LENGTH);
    });

    // A child that dies mid-request leaves its pipes broken, and the next
    // write raises EPIPE on the stream rather than at the call site. Without
    // a listener that is an unhandled 'error' event, which takes the whole
    // server down over one failed run.
    this.child.stdin?.on('error', () => {});
    this.child.stdout?.on('error', () => {});
    this.child.stderr?.on('error', () => {});

    this.child.on('error', (error: NodeJS.ErrnoException) => {
      this.spawnError = error;
    });

    // 'exit' is the release signal: the process is gone, whatever still
    // holds its pipes. 'close' follows once the pipes drain, which is when
    // the last newline-less record can be flushed.
    this.child.on('exit', (code, signal) => {
      this.finish({ code, signal });
    });
    this.child.on('close', (code, signal) => {
      // 'close' is also where a failed spawn lands: it emits 'error' and then
      // 'close', but never 'exit'.
      this.stdoutBuffer += this.stdoutDecoder.end();
      if (this.stdoutBuffer.trim()) {
        this.handleLine(this.stdoutBuffer);
        this.stdoutBuffer = '';
      }
      this.finish({ code, signal });
    });
  }

  /**
   * Sends one command and resolves with its `data`.
   *
   * Every command carries a unique `id`, because command handling is
   * asynchronous and responses may not arrive in request order.
   *
   * Rejects with `PI_RPC_COMMAND_REJECTED` when pi answers `success: false`,
   * `PI_RPC_TIMEOUT` when nothing answers within `timeoutMs`, and
   * `PI_RPC_CLOSED` when the child is gone. A successful response only means
   * the command was handled; what the run then does arrives as records.
   */
  request<T = unknown>(command: string, fields: Record<string, unknown> = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
    const id = `cloudcli-${this.nextRequestId}`;

    this.nextRequestId += 1;
    return new Promise<T>((resolve, reject) => {
      if (this.exit) {
        reject(this.closedError(command));
        return;
      }

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppError(`pi did not answer "${command}" within ${timeoutMs}ms.`, {
          code: 'PI_RPC_TIMEOUT',
          details: { command },
        }));
      }, timeoutMs);

      this.pending.set(id, {
        command,
        timer,
        settle: (error, data) => {
          clearTimeout(timer);
          if (error) {
            reject(error);
            return;
          }
          resolve(data as T);
        },
      });

      try {
        this.write({ id, type: command, ...fields });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Writes one `extension_ui_response` without waiting for anything.
   *
   * Responses are the one record Pi accepts that is not a command, so it has
   * no `response` to correlate with and must not go through `request`.
   */
  respond(response: Record<string, unknown>): void {
    this.write(response);
  }

  /**
   * Requests an orderly shutdown and resolves when the child has exited.
   *
   * Closing stdin is the protocol's own shutdown: pi disposes its runtime
   * and exits. It is given `EXIT_GRACE_MS` to do so, then SIGTERM, then
   * SIGKILL, so a run never hangs on a child that will not leave.
   */
  async end(): Promise<PiRpcExit> {
    if (!this.shutdownTimer && !this.exit) {
      this.child.stdin?.end();
      this.shutdownTimer = setTimeout(() => this.kill('SIGTERM'), EXIT_GRACE_MS);
      // Never holds the event loop open on its own.
      this.shutdownTimer.unref?.();
    }
    return this.exited;
  }

  /** Signals the child right away; SIGTERM is followed by SIGKILL. */
  kill(signal: NodeJS.Signals): void {
    if (this.exit) {
      return;
    }
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }
    this.child.kill(signal);
    if (signal === 'SIGTERM' && !this.killTimer) {
      this.killTimer = setTimeout(() => this.child.kill('SIGKILL'), SIGTERM_GRACE_MS);
      this.killTimer.unref?.();
    }
  }

  private write(record: Record<string, unknown>): void {
    const stdin = this.child.stdin;
    if (!stdin || stdin.destroyed) {
      throw this.closedError(String(record.type));
    }
    // One prompt per run is the only large record, and the stream buffers it
    // in full, so the pipe's backpressure never has to be awaited here.
    stdin.write(`${JSON.stringify(record)}\n`);
  }

  private handleLine(rawLine: string): void {
    // The protocol allows CRLF; the CR is not part of the record.
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.trim()) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Not a protocol record. An extension that logs to stdout produces
      // these; they are handed over as-is so the owner can decide, and they
      // never break the records around them.
      this.onRecord?.({ type: 'unparseable', line });
      return;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.onRecord?.({ type: 'unparseable', line });
      return;
    }

    const record = parsed as PiRpcRecord;
    if (record.type !== 'response') {
      this.onRecord?.(record);
      return;
    }

    const pending = typeof record.id === 'string' ? this.pending.get(record.id) : undefined;
    if (!pending) {
      // A parse rejection (which has no id) or a late answer to a request
      // that already timed out. Both are the owner's to judge.
      this.onRecord?.(record);
      return;
    }

    this.pending.delete(record.id as string);
    if (record.success === false) {
      pending.settle(new AppError(`pi rejected "${pending.command}": ${typeof record.error === 'string' ? record.error : 'unknown error'}`, {
        code: 'PI_RPC_COMMAND_REJECTED',
        details: { command: pending.command },
      }));
      return;
    }
    pending.settle(null, record.data);
  }

  private finish(exit: PiRpcExit): void {
    if (this.exit) {
      return;
    }
    this.exit = exit;
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.settle(this.closedError(pending.command));
    }
    this.resolveExited(exit);
  }

  private closedError(command: string): AppError {
    const reason = this.spawnError
      ? this.spawnError.message
      : `pi exited (code ${this.exit?.code ?? 'null'}, signal ${this.exit?.signal ?? 'null'})`;
    return new AppError(`${reason} before it answered "${command}".${this.stderrSuffix()}`, {
      code: 'PI_RPC_CLOSED',
      details: {
        command,
        spawnCode: this.spawnError?.code ?? null,
        exitCode: this.exit?.code ?? null,
        stderr: this.stderrTailValue,
      },
    });
  }

  private stderrSuffix(): string {
    const lastLine = this.stderrTailValue.trim().split('\n').pop() || '';
    return lastLine ? ` Last stderr line: ${lastLine}` : '';
  }
}
