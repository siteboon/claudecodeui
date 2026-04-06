/** @module remote/transport */

import { RPC_DEFAULT_TIMEOUT_MS, MAX_MESSAGE_SIZE_BYTES } from '../constants/remote.js';

/**
 * JSON-RPC transport over an SSH channel.
 *
 * Uses a remainder-buffer line parser for newline-delimited JSON framing.
 * Supports request-response correlation via JSON-RPC id tracking with
 * configurable timeout, and emits daemon notifications to registered listeners.
 */
export class SSHTransport {
  /**
   * @param {object} channel - ssh2 channel (duplex stream or exec channel with stdout/stdin)
   */
  constructor(channel) {
    this._channel = channel;
    this._buffer = '';
    this._pendingRequests = new Map();
    this._notificationHandlers = [];
    this._nextId = 1;
    this._closed = false;

    // Determine readable stream: exec channels have .stdout, shell channels are duplex
    this._readable = channel.stdout ? channel.stdout : channel;
    // Determine writable stream: exec channels have .stdin, shell channels are duplex
    this._writable = channel.stdin ? channel.stdin : channel;

    this._readable.on('data', (chunk) => this._onData(chunk));

    if (channel.stderr) {
      channel.stderr.on('data', (chunk) => {
        console.error('[ccud:remote]', chunk.toString().trimEnd());
      });
    }

    channel.on('close', () => this._onClose());
    channel.on('error', (err) => this._onError(err));
  }

  /**
   * Handle incoming data from the SSH channel.
   * @param {Buffer} chunk
   */
  _onData(chunk) {
    const text = chunk.toString('utf8');
    this._buffer += text;

    if (this._buffer.length > MAX_MESSAGE_SIZE_BYTES) {
      console.error('[SSHTransport] Buffer overflow, closing transport');
      this._buffer = '';
      this.close();
      return;
    }

    this._processBuffer();
  }

  /**
   * Remainder-buffer line parser.
   * Splits on newlines and keeps the incomplete last line as remainder.
   */
  _processBuffer() {
    const lines = this._buffer.split('\n');
    this._buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);
        this._dispatch(parsed);
      } catch (e) {
        console.error('[SSHTransport] Invalid JSON:', e.message);
      }
    }
  }

  /**
   * Dispatch a parsed JSON-RPC message.
   * @param {object} msg - Parsed JSON-RPC message
   */
  _dispatch(msg) {
    if (msg.id !== undefined && this._pendingRequests.has(msg.id)) {
      const pending = this._pendingRequests.get(msg.id);
      clearTimeout(pending.timer);
      this._pendingRequests.delete(msg.id);

      if (msg.error) {
        const rpcErr = new Error(msg.error.message || 'RPC error');
        rpcErr.code = msg.error.code;
        pending.reject(rpcErr);
      } else {
        pending.resolve(msg.result);
      }
    } else if (msg.method && msg.id === undefined) {
      for (const handler of this._notificationHandlers) {
        handler(msg);
      }
    } else {
      console.error('[SSHTransport] Unhandled message:', JSON.stringify(msg));
    }
  }

  /**
   * Send a JSON-RPC request and wait for a response.
   * @param {string} method - RPC method name
   * @param {object} [params] - RPC parameters
   * @param {number} [timeoutMs] - Request timeout in milliseconds
   * @returns {Promise<any>}
   */
  request(method, params, timeoutMs) {
    if (this._closed) {
      return Promise.reject(new Error('Transport closed'));
    }

    const id = this._nextId++;
    const request = { jsonrpc: '2.0', id, method, params: params || {} };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(id);
        reject(new Error('RPC timeout: ' + method));
      }, timeoutMs || RPC_DEFAULT_TIMEOUT_MS);

      this._pendingRequests.set(id, { resolve, reject, timer });
      this._writable.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   * @param {string} method - RPC method name
   * @param {object} [params] - RPC parameters
   */
  notify(method, params) {
    if (this._closed) return;

    const notification = { jsonrpc: '2.0', method, params: params || {} };
    this._writable.write(JSON.stringify(notification) + '\n');
  }

  /**
   * Register a handler for daemon notifications.
   * @param {function} handler - Callback receiving the full JSON-RPC notification message
   * @returns {function} Cleanup function that removes the handler
   */
  onNotification(handler) {
    this._notificationHandlers.push(handler);
    return () => {
      const idx = this._notificationHandlers.indexOf(handler);
      if (idx !== -1) this._notificationHandlers.splice(idx, 1);
    };
  }

  /**
   * Handle channel close event.
   */
  _onClose() {
    if (this._closed) return;
    this._closed = true;

    for (const [, entry] of this._pendingRequests) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Transport closed'));
    }
    this._pendingRequests.clear();
  }

  /**
   * Handle channel error event.
   * @param {Error} err
   */
  _onError(err) {
    console.error('[SSHTransport] Channel error:', err.message);
    this._onClose();
  }

  /**
   * Close the transport and underlying channel.
   */
  close() {
    this._onClose();
    try {
      this._channel.close();
    } catch {
      // Channel may already be closed
    }
  }

  /**
   * Whether the transport is closed.
   * @returns {boolean}
   */
  get isClosed() {
    return this._closed;
  }
}
