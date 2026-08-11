import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import type { AnyRecord } from '@/shared/types.js';

/**
 * Minimal JSON-RPC 2.0 client over a child process's stdio.
 *
 * Designed for omp's ACP (Agent Client Protocol) endpoint, but agnostic of the
 * method names used. Handles:
 *   - line-buffered stdout (one JSON-RPC frame per line)
 *   - request/response correlation by `id` (responses carry `id` and no `method`)
 *   - notification dispatch by method name (with prefix-matching support so a
 *     protocol extension namespace can register a wildcard handler)
 *   - inbound server->client requests (frame with BOTH `id` and `method`, e.g.
 *     `session/request_permission`): dispatched to a `registerRequestHandler`
 *     callback whose resolved value is written back as a JSON-RPC response,
 *     echoing the request id (string or number)
 *   - graceful close that rejects all in-flight requests with the close reason
 */

type Handler = (params: AnyRecord) => void;
type RequestId = number | string;
type RequestHandler = (params: AnyRecord) => unknown | Promise<unknown>;
/**
 * JSON-RPC allows positional (array) params, but every method here takes named
 * params — so anything that is not a plain object reaches handlers as an empty
 * record instead of being mislabelled as one.
 */
function asParamRecord(params: unknown): AnyRecord {
  return params !== null && typeof params === 'object' && !Array.isArray(params)
    ? (params as AnyRecord)
    : {};
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  method: string;
};

type StdioJsonRpcClientOptions = {
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
 *
 * Consumed by the omp runtime provider, which speaks ACP to an `omp` child
 * process over this transport.
 */
export class StdioJsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly handlers = new Map<string, Handler>();
  private readonly prefixHandlers = new Map<string, Handler>();
  private readonly requestHandlers = new Map<string, RequestHandler>();
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

    // A write to a dead child's stdin emits 'error' (EPIPE); without a listener
    // Node throws it process-wide. Swallow it — request()'s write callback and
    // the child 'close'/'error' handlers already reject the affected requests.
    this.child.stdin.on('error', () => {});

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
   *
   * `options.timeoutMs` overrides the client-wide default for this one request;
   * pass `0` to disable the timeout entirely. This exists because ACP
   * `session/prompt` resolves only at end-of-turn (routinely minutes), which
   * would spuriously reject under the 2-minute client default.
   */
  request<TResult = unknown>(
    method: string,
    params?: unknown,
    options: { timeoutMs?: number } = {},
  ): Promise<TResult> {
    if (this.closed) {
      return Promise.reject(new Error(`JSON-RPC client is closed (request: ${method})`));
    }

    const id = this.nextId;
    this.nextId += 1;
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const timeoutMs = options.timeoutMs ?? this.options.requestTimeoutMs;

    return new Promise<TResult>((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`JSON-RPC request '${method}' timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : null;

      this.pending.set(id, {
        resolve: (value) => {
          if (timer) clearTimeout(timer);
          resolve(value as TResult);
        },
        reject: (reason) => {
          if (timer) clearTimeout(timer);
          reject(reason);
        },
        method,
      });

      this.child.stdin.write(`${frame}\n`, (error) => {
        if (error) {
          if (timer) clearTimeout(timer);
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
   * given prefix (e.g. `_ext/`). Useful for protocol extension namespaces.
   */
  onNotificationPrefix(prefix: string, handler: Handler): () => void {
    this.prefixHandlers.set(prefix, handler);
    return () => this.prefixHandlers.delete(prefix);
  }

  /**
   * Registers a handler for INBOUND server->client requests of the given method
   * (e.g. `session/request_permission`). The handler's resolved value is written
   * back as the JSON-RPC `result`; a thrown/rejected error becomes an `error`
   * response. Returns a disposer.
   */
  registerRequestHandler(method: string, handler: RequestHandler): () => void {
    this.requestHandlers.set(method, handler);
    return () => this.requestHandlers.delete(method);
  }

  /**
   * True after the child process has exited or errored.
   */
  isClosed(): boolean {
    return this.closed;
  }

  private writeResponse(id: RequestId, result: unknown, error?: { code: number; message: string }): void {
    if (this.closed) {
      return;
    }
    const frame = error
      ? { jsonrpc: '2.0', id, error }
      : { jsonrpc: '2.0', id, result };
    this.child.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  private async handleInboundRequest(id: RequestId, method: string, params: unknown): Promise<void> {
    const handler = this.requestHandlers.get(method);
    if (!handler) {
      this.writeResponse(id, undefined, { code: -32601, message: `No handler for request '${method}'` });
      return;
    }
    try {
      const result = await handler(asParamRecord(params));
      this.writeResponse(id, result);
    } catch (handlerError) {
      const message = handlerError instanceof Error ? handlerError.message : String(handlerError);
      this.writeResponse(id, undefined, { code: -32603, message });
    }
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
    const id: RequestId | null = (typeof frame.id === 'number' || typeof frame.id === 'string')
      ? frame.id
      : null;
    const method = typeof frame.method === 'string' ? frame.method : null;

    // Inbound server->client REQUEST: carries BOTH an id and a method. Must be
    // disambiguated from a response (which never carries `method`) even if its
    // id happens to collide with one of our pending client-request ids.
    if (id !== null && method) {
      void this.handleInboundRequest(id, method, frame.params);
      return;
    }

    // Response to one of our requests: an id and no method. Pending is keyed by
    // the numeric ids we generate; a foreign string id simply won't match.
    if (id !== null && method === null) {
      const pending = typeof id === 'number' ? this.pending.get(id) : undefined;
      if (!pending) {
        return;
      }
      this.pending.delete(id as number);
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
          exact(asParamRecord(params));
        } catch (handlerError) {
          // Handler errors must not break the JSON-RPC stream — but they ARE
          // logged so silent regressions don't slip past the stderr console.
          console.error(`[StdioJsonRpcClient] notification handler for "${method}" threw:`, handlerError);
        }
      }
      for (const [prefix, handler] of this.prefixHandlers) {
        if (method.startsWith(prefix)) {
          try {
            handler(asParamRecord(params));
          } catch (handlerError) {
            console.error(`[StdioJsonRpcClient] prefix-"${prefix}" handler threw on "${method}":`, handlerError);
          }
        }
      }
    }
  }
}
