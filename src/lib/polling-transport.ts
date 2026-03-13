/**
 * HTTP Polling Fallback Transport
 *
 * Provides PollingWebSocket and PollingShellWebSocket classes that implement
 * the browser WebSocket API using HTTP fetch() for environments where
 * WebSocket connections are blocked (e.g., corporate proxies).
 *
 * The module also monkey-patches window.WebSocket to transparently switch
 * to polling mode after repeated WebSocket failures.
 */

const WS_FAIL_THRESHOLD = 3;

// Per-endpoint fallback state so failures on one transport don't affect the other
let chatWsFailCount = 0;
let shellWsFailCount = 0;
let useChatPollingFallback = false;
let useShellPollingFallback = false;

const OrigWebSocket = window.WebSocket;

function getToken(): string | null {
  return localStorage.getItem('auth-token');
}

function authHeaders(contentType = true): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/** Returns true if the response indicates a dead/cleaned-up connection (terminal). */
function isTerminalResponse(resp: Response): boolean {
  return resp.status === 410 || resp.status === 404;
}

// ──────────────────────────────────────────────────────────────
//  PollingWebSocket — drop-in replacement for chat /ws
// ──────────────────────────────────────────────────────────────

type EventCallback = (ev: any) => void;

class PollingWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  url: string;
  readyState = 0;
  onopen: EventCallback | null = null;
  onmessage: EventCallback | null = null;
  onclose: EventCallback | null = null;
  onerror: EventCallback | null = null;

  private _connectionId: string = '';
  private _polling = false;
  private _closed = false;
  private _listeners: Record<string, EventCallback[]> = {};

  constructor(url: string) {
    this.url = url;
    this._connect();
  }

  addEventListener(event: string, fn: EventCallback): void {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }

  removeEventListener(event: string, fn: EventCallback): void {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter((f) => f !== fn);
    }
  }

  private _emit(event: string, data: any): void {
    (this._listeners[event] || []).forEach((fn) => {
      fn(data);
    });
  }

  private async _connect(): Promise<void> {
    try {
      const resp = await fetch('/api/poll/connect', {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
      });
      if (!resp.ok) throw new Error(`Connect failed: ${resp.status}`);

      const body = await resp.json();
      this._connectionId = body.connectionId;
      this.readyState = 1;
      console.log('[Poll Fallback] Chat connected:', this._connectionId);
      setTimeout(() => {
        this.onopen?.({});
        this._emit('open', {});
      }, 0);
      this._startPolling();
    } catch (e) {
      console.error('[Poll Fallback] Connect error:', e);
      this.readyState = 3;
      setTimeout(() => {
        this.onclose?.({ code: 1006 });
        this._emit('close', { code: 1006 });
      }, 0);
    }
  }

  private async _startPolling(): Promise<void> {
    this._polling = true;
    while (this._polling && !this._closed) {
      try {
        const resp = await fetch(
          '/api/poll/messages?' +
            new URLSearchParams({ connectionId: this._connectionId, _t: String(Date.now()) }),
          { cache: 'no-store', headers: authHeaders(false) },
        );
        if (this._closed) return;
        if (!resp.ok) {
          if (resp.status === 401 || isTerminalResponse(resp)) {
            this.close();
            return;
          }
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        const messages = await resp.json();
        if (this._closed) return;
        if (messages?.length > 0) {
          for (const msg of messages) {
            if (this._closed) return;
            const event = { data: JSON.stringify(msg) };
            this.onmessage?.(event);
            this._emit('message', event);
            // Yield between messages to prevent React setState batching
            await new Promise((r) => setTimeout(r, 10));
          }
        }
        // Adaptive polling: fast during activity, slower when idle
        await new Promise((r) => setTimeout(r, messages?.length > 0 ? 100 : 500));
      } catch {
        if (this._closed) return;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  send(data: string): void {
    const payload = JSON.parse(data);
    payload.connectionId = this._connectionId;
    fetch('/api/poll/send', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    }).catch((err) => console.error('[Poll Fallback] Send error:', err));
  }

  close(): void {
    this._closed = true;
    this._polling = false;
    this.readyState = 3;
    fetch('/api/poll/disconnect', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ connectionId: this._connectionId }),
    }).catch(() => {});
    this.onclose?.({ code: 1000 });
    this._emit('close', { code: 1000 });
  }
}

// ──────────────────────────────────────────────────────────────
//  PollingShellWebSocket — drop-in replacement for shell /shell
// ──────────────────────────────────────────────────────────────

class PollingShellWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  url: string;
  readyState = 0;
  onopen: EventCallback | null = null;
  onmessage: EventCallback | null = null;
  onclose: EventCallback | null = null;
  onerror: EventCallback | null = null;

  private _connectionId: string = '';
  private _polling = false;
  private _closed = false;
  private _listeners: Record<string, EventCallback[]> = {};

  constructor(url: string) {
    this.url = url;
    this._connect();
  }

  addEventListener(event: string, fn: EventCallback): void {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }

  removeEventListener(event: string, fn: EventCallback): void {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter((f) => f !== fn);
    }
  }

  private _emit(event: string, data: any): void {
    (this._listeners[event] || []).forEach((fn) => {
      fn(data);
    });
  }

  private async _connect(): Promise<void> {
    try {
      const resp = await fetch('/api/poll/shell/connect', {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
      });
      if (!resp.ok) throw new Error(`Shell connect failed: ${resp.status}`);

      const body = await resp.json();
      this._connectionId = body.connectionId;
      this.readyState = 1;
      console.log('[Poll Fallback] Shell connected:', this._connectionId);
      setTimeout(() => {
        this.onopen?.({});
        this._emit('open', {});
      }, 0);
      this._startPolling();
    } catch (e) {
      console.error('[Poll Fallback] Shell connect error:', e);
      this.readyState = 3;
      setTimeout(() => {
        this.onclose?.({ code: 1006 });
        this._emit('close', { code: 1006 });
      }, 0);
    }
  }

  private async _startPolling(): Promise<void> {
    this._polling = true;
    while (this._polling && !this._closed) {
      try {
        const resp = await fetch(
          '/api/poll/shell/output?' +
            new URLSearchParams({ connectionId: this._connectionId, _t: String(Date.now()) }),
          { cache: 'no-store', headers: authHeaders(false) },
        );
        if (this._closed) return;
        if (!resp.ok) {
          if (resp.status === 401 || isTerminalResponse(resp)) {
            this.close();
            return;
          }
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        const messages = await resp.json();
        if (this._closed) return;
        if (messages?.length > 0) {
          for (const msg of messages) {
            if (this._closed) return;
            const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
            const event = { data };
            this.onmessage?.(event);
            this._emit('message', event);
          }
        }
        // Faster polling for interactive terminal feel
        await new Promise((r) => setTimeout(r, messages?.length > 0 ? 50 : 200));
      } catch {
        if (this._closed) return;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  send(data: string): void {
    const payload = JSON.parse(data);
    payload.connectionId = this._connectionId;
    fetch('/api/poll/shell/send', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    }).catch((err) => console.error('[Poll Fallback] Shell send error:', err));
  }

  close(): void {
    this._closed = true;
    this._polling = false;
    this.readyState = 3;
    fetch('/api/poll/shell/disconnect', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ connectionId: this._connectionId }),
    }).catch(() => {});
    this.onclose?.({ code: 1000 });
    this._emit('close', { code: 1000 });
  }
}

// ──────────────────────────────────────────────────────────────
//  Monkey-patch window.WebSocket for auto-fallback
// ──────────────────────────────────────────────────────────────

export function installPollingFallback(): void {
  (window as any).WebSocket = function (url: string, protocols?: string | string[]) {
    if (typeof url === 'string') {
      // Chat WebSocket
      if (url.includes('/ws?token=') || url.endsWith('/ws')) {
        if (useChatPollingFallback) {
          console.log('[Poll Fallback] Using HTTP polling for chat');
          return new PollingWebSocket(url) as unknown as WebSocket;
        }
        const ws = protocols ? new OrigWebSocket(url, protocols) : new OrigWebSocket(url);
        ws.addEventListener('error', () => {
          chatWsFailCount++;
          console.warn(`[Poll Fallback] Chat WS failed (${chatWsFailCount}/${WS_FAIL_THRESHOLD})`);
          if (chatWsFailCount >= WS_FAIL_THRESHOLD) {
            useChatPollingFallback = true;
            console.log('[Poll Fallback] Switching chat to HTTP polling mode');
          }
        });
        ws.addEventListener('open', () => {
          chatWsFailCount = 0;
        });
        return ws;
      }

      // Shell WebSocket
      if (url.includes('/shell?token=') || url.endsWith('/shell')) {
        if (useShellPollingFallback) {
          console.log('[Poll Fallback] Using HTTP polling for shell');
          return new PollingShellWebSocket(url) as unknown as WebSocket;
        }
        const ws = protocols ? new OrigWebSocket(url, protocols) : new OrigWebSocket(url);
        ws.addEventListener('error', () => {
          shellWsFailCount++;
          console.warn(
            `[Poll Fallback] Shell WS failed (${shellWsFailCount}/${WS_FAIL_THRESHOLD})`,
          );
          if (shellWsFailCount >= WS_FAIL_THRESHOLD) {
            useShellPollingFallback = true;
            console.log('[Poll Fallback] Switching shell to HTTP polling mode');
          }
        });
        ws.addEventListener('open', () => {
          shellWsFailCount = 0;
        });
        return ws;
      }
    }

    return protocols ? new OrigWebSocket(url, protocols) : new OrigWebSocket(url);
  } as any;

  // Copy static properties
  (window as any).WebSocket.OPEN = OrigWebSocket.OPEN;
  (window as any).WebSocket.CLOSED = OrigWebSocket.CLOSED;
  (window as any).WebSocket.CONNECTING = OrigWebSocket.CONNECTING;
  (window as any).WebSocket.CLOSING = OrigWebSocket.CLOSING;
  (window as any).WebSocket.prototype = OrigWebSocket.prototype;
}
