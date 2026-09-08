import type { Readable, Writable } from 'node:stream';

export type JsonRpcId = number | string;

/**
 * Selects the newline-delimited wire representation. Codex app-server uses
 * JSON-RPC semantics but omits the `jsonrpc` member on stdio frames.
 */
export type JsonRpcWireFormat = 'json-rpc' | 'codex-app-server';

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
};

export type JsonRpcErrorObject = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcSuccessResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
};

export type JsonRpcErrorResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: JsonRpcErrorObject;
};

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
type JsonRpcIncomingMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export type JsonRpcDiagnostic =
  | {
      type: 'malformed_message';
      line: string;
      error: Error;
    }
  | {
      type: 'invalid_message';
      line: string;
      reason: string;
    }
  | {
      type: 'orphan_response';
      response: JsonRpcResponse;
    }
  | {
      type: 'stderr';
      text: string;
    }
  | {
      type: 'handler_error';
      method: string;
      error: Error;
    }
  | {
      type: 'unhandled_request';
      request: JsonRpcRequest;
    };

export type JsonRpcTransportOptions = {
  input: Readable;
  output: Writable;
  stderr?: Readable;
  wireFormat?: JsonRpcWireFormat;
  onNotification?: (notification: JsonRpcNotification) => void;
  onRequest?: (request: JsonRpcRequest) => unknown | Promise<unknown>;
  onDiagnostic?: (diagnostic: JsonRpcDiagnostic) => void;
  onClose?: (error: JsonRpcTransportClosedError) => void;
};

export class JsonRpcRemoteError extends Error {
  readonly requestId: JsonRpcId;
  readonly code: number;
  readonly data: unknown;

  constructor(requestId: JsonRpcId, error: JsonRpcErrorObject) {
    super(`JSON-RPC request ${String(requestId)} failed (${error.code}): ${error.message}`);
    this.name = 'JsonRpcRemoteError';
    this.requestId = requestId;
    this.code = error.code;
    this.data = error.data;
  }
}

export class JsonRpcTransportClosedError extends Error {
  constructor(message = 'JSON-RPC transport is closed') {
    super(message);
    this.name = 'JsonRpcTransportClosedError';
  }
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const hasOwn = (value: Record<string, unknown>, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(value, key)
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isJsonRpcId = (value: unknown): value is JsonRpcId => (
  (typeof value === 'string' && value.length > 0)
  || (typeof value === 'number' && Number.isFinite(value))
);

const toError = (value: unknown, fallback = 'Unknown JSON-RPC error'): Error => (
  value instanceof Error ? value : new Error(typeof value === 'string' ? value : fallback)
);

const withParams = <T extends Record<string, unknown>>(message: T, params: unknown): T & { params?: unknown } => (
  params === undefined ? message : { ...message, params }
);

/**
 * Typed JSON-RPC 2.0 transport for the Codex app-server stdio protocol.
 *
 * The provider runtime owns process creation and lifecycle. This class only
 * owns newline framing, request correlation, server-request dispatch, and
 * stream failure propagation, which keeps the protocol layer independently
 * testable with an in-memory stream pair.
 */
export class CodexAppServerTransport {
  private readonly input: Readable;
  private readonly output: Writable;
  private readonly wireFormat: JsonRpcWireFormat;
  private readonly callbacks: Pick<
    JsonRpcTransportOptions,
    'onNotification' | 'onRequest' | 'onDiagnostic' | 'onClose'
  >;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private nextRequestId = 1;
  private inputBuffer = '';
  private writeTail: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(options: JsonRpcTransportOptions) {
    this.input = options.input;
    this.output = options.output;
    this.wireFormat = options.wireFormat ?? 'json-rpc';
    this.callbacks = options;

    this.input.on('data', (chunk: Buffer | string) => this.handleData(chunk));
    this.input.on('end', () => {
      if (this.inputBuffer.trim()) {
        this.emitDiagnostic({
          type: 'malformed_message',
          line: this.inputBuffer,
          error: new Error('JSON-RPC input ended with an incomplete line'),
        });
      }
      this.close(new JsonRpcTransportClosedError('JSON-RPC input stream ended'));
    });
    this.input.on('error', (error) => this.closeFromStream(error));

    this.output.on('error', (error) => this.closeFromStream(error));

    options.stderr?.on('data', (chunk: Buffer | string) => {
      this.emitDiagnostic({ type: 'stderr', text: String(chunk) });
    });
    options.stderr?.on('error', (error) => {
      this.emitDiagnostic({
        type: 'stderr',
        text: `stderr stream error: ${toError(error).message}`,
      });
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get pendingRequestCount(): number {
    return this.pending.size;
  }

  /**
   * Sends a JSON-RPC request and resolves when the matching response arrives.
   * Responses are correlated by ID and may arrive in any order.
   */
  request<TResult = unknown>(method: string, params?: unknown): Promise<TResult> {
    if (this.closed) {
      return Promise.reject(new JsonRpcTransportClosedError());
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const request = withParams({ jsonrpc: '2.0' as const, id, method }, params);
    const promise = new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
      });
    });

    void this.enqueueWrite(request).catch((error: unknown) => {
      const pending = this.pending.get(id);
      if (!pending) {
        return;
      }
      this.pending.delete(id);
      pending.reject(toError(error, `Failed to send JSON-RPC request ${method}`));
    });

    return promise;
  }

  /** Sends a JSON-RPC notification without creating a pending response. */
  notify(method: string, params?: unknown): Promise<void> {
    if (this.closed) {
      return Promise.reject(new JsonRpcTransportClosedError());
    }

    return this.enqueueWrite(withParams({ jsonrpc: '2.0' as const, method }, params));
  }

  /**
   * Closes the transport and rejects every request that has not received a
   * response. Process termination is owned by the caller, so this method does
   * not call `end()` or `destroy()` on either stream.
   */
  close(reason?: JsonRpcTransportClosedError): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    const error = reason ?? new JsonRpcTransportClosedError();
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();

    try {
      this.callbacks.onClose?.(error);
    } catch {
      // A lifecycle callback must not turn a completed close into an uncaught
      // exception in the stream event handler.
    }
  }

  private closeFromStream(error: unknown): void {
    const sourceError = toError(error);
    this.close(new JsonRpcTransportClosedError(`JSON-RPC transport closed: ${sourceError.message}`));
  }

  private handleData(chunk: Buffer | string): void {
    if (this.closed) {
      return;
    }

    this.inputBuffer += String(chunk);
    let newlineIndex = this.inputBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.inputBuffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.inputBuffer = this.inputBuffer.slice(newlineIndex + 1);
      if (line.trim()) {
        this.handleLine(line);
      }
      newlineIndex = this.inputBuffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      this.emitDiagnostic({
        type: 'malformed_message',
        line,
        error: toError(error, 'Invalid JSON-RPC JSON'),
      });
      return;
    }

    const message = this.decodeMessage(parsed, line);
    if (!message) {
      return;
    }

    if ('method' in message) {
      if ('id' in message) {
        void this.handleServerRequest(message);
      } else {
        this.handleNotification(message);
      }
      return;
    }

    this.handleResponse(message);
  }

  private decodeMessage(parsed: unknown, line: string): JsonRpcIncomingMessage | null {
    if (!isRecord(parsed)) {
      this.emitDiagnostic({
        type: 'invalid_message',
        line,
        reason: 'Message must be a JSON-RPC object',
      });
      return null;
    }

    const hasJsonRpcVersion = hasOwn(parsed, 'jsonrpc');
    const hasValidJsonRpcVersion = parsed.jsonrpc === '2.0';
    if ((this.wireFormat === 'json-rpc' && !hasValidJsonRpcVersion)
      || (this.wireFormat === 'codex-app-server' && hasJsonRpcVersion && !hasValidJsonRpcVersion)) {
      this.emitDiagnostic({
        type: 'invalid_message',
        line,
        reason: this.wireFormat === 'codex-app-server'
          ? 'Codex app-server messages may omit jsonrpc but must use version 2.0 when present'
          : 'Message must be a JSON-RPC 2.0 object',
      });
      return null;
    }

    // Normalize Codex's headerless frames for the typed callbacks and internal
    // response handling. The member is removed again when writing to the wire.
    const messageRecord = this.wireFormat === 'codex-app-server'
      ? { jsonrpc: '2.0' as const, ...parsed }
      : parsed;

    const hasId = hasOwn(messageRecord, 'id');
    if (typeof messageRecord.method === 'string') {
      if (!messageRecord.method) {
        this.emitDiagnostic({ type: 'invalid_message', line, reason: 'method must not be empty' });
        return null;
      }
      if (hasId && !isJsonRpcId(messageRecord.id)) {
        this.emitDiagnostic({ type: 'invalid_message', line, reason: 'request id must be a string or number' });
        return null;
      }

      if (hasId) {
        return messageRecord as unknown as JsonRpcRequest;
      }
      return messageRecord as unknown as JsonRpcNotification;
    }

    const hasResult = hasOwn(messageRecord, 'result');
    const hasError = hasOwn(messageRecord, 'error');
    if (!hasId || !isJsonRpcId(messageRecord.id) || hasResult === hasError) {
      this.emitDiagnostic({
        type: 'invalid_message',
        line,
        reason: 'Response must contain exactly one result/error and a valid id',
      });
      return null;
    }

    if (hasError) {
      if (!isRecord(messageRecord.error) || typeof messageRecord.error.code !== 'number' || typeof messageRecord.error.message !== 'string') {
        this.emitDiagnostic({ type: 'invalid_message', line, reason: 'error must contain numeric code and message' });
        return null;
      }
      return messageRecord as unknown as JsonRpcErrorResponse;
    }

    return messageRecord as unknown as JsonRpcSuccessResponse;
  }

  private handleNotification(notification: JsonRpcNotification): void {
    try {
      this.callbacks.onNotification?.(notification);
    } catch (error) {
      this.emitDiagnostic({
        type: 'handler_error',
        method: notification.method,
        error: toError(error),
      });
    }
  }

  private async handleServerRequest(request: JsonRpcRequest): Promise<void> {
    const handler = this.callbacks.onRequest;
    if (!handler) {
      this.emitDiagnostic({ type: 'unhandled_request', request });
      await this.sendError(request.id, -32601, `No handler registered for ${request.method}`);
      return;
    }

    try {
      const result = await handler(request);
      await this.enqueueWrite({
        jsonrpc: '2.0' as const,
        id: request.id,
        result: result === undefined ? null : result,
      });
    } catch (error) {
      const normalizedError = toError(error);
      this.emitDiagnostic({ type: 'handler_error', method: request.method, error: normalizedError });
      await this.sendError(request.id, -32603, normalizedError.message);
    }
  }

  private async sendError(id: JsonRpcId, code: number, message: string): Promise<void> {
    try {
      await this.enqueueWrite({
        jsonrpc: '2.0' as const,
        id,
        error: { code, message },
      });
    } catch {
      // The stream error/close handler already rejects pending requests and
      // reports the transport failure. There is no response to send after it.
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      this.emitDiagnostic({ type: 'orphan_response', response });
      return;
    }

    this.pending.delete(response.id);
    if ('error' in response) {
      pending.reject(new JsonRpcRemoteError(response.id, response.error));
      return;
    }

    pending.resolve(response.result);
  }

  private emitDiagnostic(diagnostic: JsonRpcDiagnostic): void {
    try {
      this.callbacks.onDiagnostic?.(diagnostic);
    } catch {
      // Diagnostics are best-effort and must never interrupt protocol parsing.
    }
  }

  private enqueueWrite(message: Record<string, unknown>): Promise<void> {
    const operation = this.writeTail.then(() => this.writeMessage(message));
    this.writeTail = operation.catch(() => undefined);
    return operation;
  }

  private writeMessage(message: Record<string, unknown>): Promise<void> {
    if (this.closed) {
      return Promise.reject(new JsonRpcTransportClosedError());
    }

    let line: string;
    try {
      const wireMessage = this.wireFormat === 'codex-app-server'
        ? Object.fromEntries(Object.entries(message).filter(([key]) => key !== 'jsonrpc'))
        : message;
      line = `${JSON.stringify(wireMessage)}\n`;
    } catch (error) {
      return Promise.reject(toError(error, 'Could not serialize JSON-RPC message'));
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        this.output.removeListener('error', onError);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const onError = (error: Error) => finish(error);

      this.output.once('error', onError);

      try {
        const accepted = this.output.write(line, (error?: Error | null) => {
          if (error) {
            finish(error);
          }
        });

        if (accepted) {
          finish();
        } else {
          this.output.once('drain', () => finish());
        }
      } catch (error) {
        finish(toError(error, 'Could not write JSON-RPC message'));
      }
    });
  }
}
