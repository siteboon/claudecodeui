import type { ChildProcessWithoutNullStreams } from 'node:child_process';

/**
 * Minimal JSON-RPC 2.0 client over a child process's stdio.
 *
 * Designed for Kiro CLI's ACP (Agent Client Protocol) endpoint, but agnostic
 * of the method names used. Handles:
 *   - line-buffered stdout (one JSON-RPC frame per line)
 *   - request/response correlation by `id`
 *   - notification dispatch by method name (with prefix-matching support so
 *     Kiro's `_kiro.dev/*` extension namespace can register a wildcard handler)
 *   - graceful close that rejects all in-flight requests with the close reason
 */

type Handler = (params: unknown) => void;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  method: string;
};

export type StdioJsonRpcClientOptions = {
  /** Maximum time to wait for a response, in ms. Default 120_000 (2 minutes). */
  requestTimeoutMs?: number;
  /** Optional callback for stderr lines from the child. */
  onStderr?: (line: string) => void;
  /** Optional callback for parse failures. */
  onParseError?: (rawLine: string, error: unknown) => void;
};

/**
 * Wraps a spawned child process and exposes JSON-RPC request/notify/onNotification.
 *
 * Caller owns the child process lifecycle (spawning and killing). This client
 * only attaches stdout/stderr listeners and writes to stdin.
 */
export class StdioJsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly handlers = new Map<string, Handler>();
  private readonly prefixHandlers = new Map<string, Handler>();
  private readonly options: Required<Pick<StdioJsonRpcClientOptions, 'requestTimeoutMs'>> &
    Pick<StdioJsonRpcClientOptions, 'onStderr' | 'onParseError'>;
  private stdoutBuffer = '';
  private closed = false;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    options: StdioJsonRpcClientOptions = {},
  ) {
    this.options = {
      requestTimeoutMs: options.requestTimeoutMs ?? 120_000,
      onStderr: options.onStderr,
      onParseError: options.onParseError,
    };

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', this.handleStdoutChunk);
    if (this.child.stderr) {
      this.child.stderr.setEncoding('utf8');
      this.child.stderr.on('data', this.handleStderrChunk);
    }
    this.child.on('close', this.handleClose);
    this.child.on('error', (error) => this.handleClose(null, null, error));
  }

  /**
   * Sends a JSON-RPC request and resolves with the typed result.
   */
  request<TResult = unknown>(method: string, params?: unknown): Promise<TResult> {
    if (this.closed) {
      return Promise.reject(new Error(`JSON-RPC client is closed (request: ${method})`));
    }

    const id = this.nextId;
    this.nextId += 1;
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`JSON-RPC request '${method}' timed out after ${this.options.requestTimeoutMs}ms`));
      }, this.options.requestTimeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as TResult);
        },
        reject: (reason) => {
          clearTimeout(timer);
          reject(reason);
        },
        method,
      });

      this.child.stdin.write(`${frame}\n`, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  /**
   * Sends a JSON-RPC notification (no response expected).
   */
  notify(method: string, params?: unknown): void {
    if (this.closed) {
      return;
    }
    const frame = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.child.stdin.write(`${frame}\n`);
  }

  /**
   * Registers a notification handler for a specific method name.
   *
   * Returns a disposer that removes the handler.
   */
  onNotification(method: string, handler: Handler): () => void {
    this.handlers.set(method, handler);
    return () => this.handlers.delete(method);
  }

  /**
   * Registers a notification handler for any method whose name starts with the
   * given prefix (e.g. `_kiro.dev/`). Useful for protocol extension namespaces.
   */
  onNotificationPrefix(prefix: string, handler: Handler): () => void {
    this.prefixHandlers.set(prefix, handler);
    return () => this.prefixHandlers.delete(prefix);
  }

  /**
   * True after the child process has exited or errored.
   */
  isClosed(): boolean {
    return this.closed;
  }

  private handleStdoutChunk = (chunk: string): void => {
    this.stdoutBuffer += chunk;

    let newlineIndex: number;
    while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) >= 0) {
      const rawLine = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!rawLine) {
        continue;
      }

      let frame: Record<string, unknown>;
      try {
        const parsed = JSON.parse(rawLine);
        if (!parsed || typeof parsed !== 'object') {
          continue;
        }
        frame = parsed as Record<string, unknown>;
      } catch (error) {
        this.options.onParseError?.(rawLine, error);
        continue;
      }

      this.dispatchFrame(frame);
    }
  };

  private handleStderrChunk = (chunk: string): void => {
    if (!this.options.onStderr) {
      return;
    }
    for (const line of chunk.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) {
        this.options.onStderr(trimmed);
      }
    }
  };

  private handleClose = (code?: number | null, _signal?: NodeJS.Signals | null, error?: Error): void => {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const reason = error
      ? error
      : new Error(code === 0 ? 'JSON-RPC stream closed' : `JSON-RPC stream closed with code ${code ?? 'unknown'}`);
    for (const pending of this.pending.values()) {
      pending.reject(reason);
    }
    this.pending.clear();
  };

  private dispatchFrame(frame: Record<string, unknown>): void {
    const id = typeof frame.id === 'number' ? frame.id : null;
    const method = typeof frame.method === 'string' ? frame.method : null;

    if (id !== null && this.pending.has(id)) {
      const pending = this.pending.get(id)!;
      this.pending.delete(id);
      if (frame.error && typeof frame.error === 'object') {
        const err = frame.error as Record<string, unknown>;
        const message = typeof err.message === 'string' ? err.message : 'JSON-RPC error';
        const rpcError = new Error(`${message} (method: ${pending.method})`);
        (rpcError as Error & { data?: unknown }).data = err.data;
        pending.reject(rpcError);
        return;
      }
      pending.resolve(frame.result);
      return;
    }

    if (method) {
      const params = frame.params;
      const exact = this.handlers.get(method);
      if (exact) {
        try {
          exact(params);
        } catch {
          // Handler errors must not break the JSON-RPC stream.
        }
      }
      for (const [prefix, handler] of this.prefixHandlers) {
        if (method.startsWith(prefix)) {
          try {
            handler(params);
          } catch {
            // Same defensive policy as above.
          }
        }
      }
    }
  }
}
