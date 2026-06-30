import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

import crossSpawn from 'cross-spawn';

const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

class AcpClient extends EventEmitter {
  constructor({ command = process.env.HERMES_CLI_PATH || 'hermes acp', cwd = process.cwd(), env = process.env } = {}) {
    super();
    const commandParts = command.trim().split(/\s+/);
    this.command = commandParts.shift() || 'hermes';
    this.args = commandParts;
    this.cwd = cwd;
    this.env = env;
    this.process = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.requestHandlers = new Map();
    this.initialized = false;
    this.initializeResult = null;
  }

  start() {
    if (this.process) {
      return;
    }

    this.process = spawnFunction(this.command, this.args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...this.env },
    });

    this.process.stdout.on('data', (chunk) => this.handleData(chunk));
    this.process.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.trim()) {
        this.emit('stderr', text);
      }
    });
    this.process.on('error', (error) => this.rejectAll(error));
    this.process.on('close', (code, signal) => {
      this.rejectAll(new Error(`hermes-acp exited with code ${code ?? 'null'}${signal ? ` signal ${signal}` : ''}`));
      this.emit('close', { code, signal });
      this.process = null;
      this.initialized = false;
    });
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    this.start();
    this.initializeResult = await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: {
          readTextFile: false,
          writeTextFile: false,
        },
        terminal: false,
      },
      clientInfo: {
        name: 'CloudCLI',
        title: 'CloudCLI',
        version: '1.0.0',
      },
    });
    this.initialized = true;
    this.notify('initialized', {});
  }

  onRequest(method, handler) {
    this.requestHandlers.set(method, handler);
  }

  registerRequestHandler(method, handler) {
    const handlers = this.requestHandlers.get(method) || new Set();
    handlers.add(handler);
    this.requestHandlers.set(method, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.requestHandlers.delete(method);
      }
    };
  }

  request(method, params) {
    this.start();
    const id = this.nextId;
    this.nextId += 1;

    const payload = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method, params });
      this.writeMessage(payload);
    });
  }

  notify(method, params) {
    this.start();
    this.writeMessage({ jsonrpc: '2.0', method, params });
  }

  writeMessage(payload) {
    if (!this.process || !this.process.stdin || this.process.stdin.destroyed) {
      throw new Error('hermes-acp process is not running');
    }
    const line = `${JSON.stringify(payload)}\n`;
    this.process.stdin.write(line);
  }

  handleData(chunk) {
    this.buffer += chunk.toString();

    while (this.buffer.length > 0) {
      if (this.buffer.startsWith('Content-Length:')) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) {
          return;
        }
        const header = this.buffer.slice(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          this.buffer = this.buffer.slice(headerEnd + 4);
          continue;
        }
        const length = Number(match[1]);
        const messageStart = headerEnd + 4;
        if (this.buffer.length < messageStart + length) {
          return;
        }
        const raw = this.buffer.slice(messageStart, messageStart + length);
        this.buffer = this.buffer.slice(messageStart + length);
        this.dispatchRaw(raw);
        continue;
      }

      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }
      const raw = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (raw) {
        this.dispatchRaw(raw);
      }
    }
  }

  dispatchRaw(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      this.emit('error', error);
      return;
    }

    void this.dispatchMessage(message);
  }

  async dispatchMessage(message) {
    if (Object.prototype.hasOwnProperty.call(message, 'id') && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        const messageText = message.error.message || JSON.stringify(message.error);
        const error = new Error(`ACP ${pending.method} failed: ${messageText}`);
        error.code = message.error.code;
        error.data = message.error.data;
        error.method = pending.method;
        error.params = pending.params;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'id') && message.method) {
      const handler = this.requestHandlers.get(message.method);
      if (!handler) {
        this.writeMessage({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `No handler for ${message.method}` },
        });
        return;
      }

      try {
        const result = handler instanceof Set
          ? await this.dispatchRequestHandlers(handler, message.params)
          : await handler(message.params);
        this.writeMessage({ jsonrpc: '2.0', id: message.id, result });
      } catch (error) {
        this.writeMessage({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
        });
      }
      return;
    }

    if (message.method) {
      this.emit(message.method, message.params);
      this.emit('notification', { method: message.method, params: message.params });
    }
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  async dispatchRequestHandlers(handlers, params) {
    let fallbackResult = null;
    let sawHandler = false;
    for (const handler of Array.from(handlers).reverse()) {
      sawHandler = true;
      const result = await handler(params);
      const outcome = result?.outcome?.outcome;
      if (outcome !== 'cancelled') {
        return result;
      }
      fallbackResult = result;
    }
    if (sawHandler && fallbackResult) {
      return fallbackResult;
    }
    return { outcome: { outcome: 'cancelled' } };
  }

  close() {
    if (!this.process) {
      return;
    }
    this.process.kill('SIGTERM');
  }
}

class HermesConnectionManager {
  constructor() {
    this.connections = new Map();
  }

  async getConnection(cwd) {
    const key = cwd || process.cwd();
    let connection = this.connections.get(key);
    if (!connection) {
      connection = new AcpClient({ cwd: key });
      connection.on('close', () => {
        this.connections.delete(key);
      });
      this.connections.set(key, connection);
    }
    await connection.initialize();
    return connection;
  }

  closeAll() {
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
  }
}

const hermesConnectionManager = new HermesConnectionManager();

export {
  AcpClient,
  HermesConnectionManager,
  hermesConnectionManager,
};
