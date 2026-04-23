import http from 'http';

import express from 'express';
import WebSocket, { WebSocketServer } from 'ws';

import { authenticateWebSocket } from '../middleware/auth.js';

const CDP_HOST = process.env.CHROME_CDP_HOST || '127.0.0.1';
const CDP_PORT = Number(process.env.CHROME_CDP_PORT || 9222);

// Opt-in flags. The screencast attaches to the operator's REAL Chrome over
// CDP — any authenticated Dispatch user could otherwise read cookies via
// Runtime.evaluate or drive the host browser (steal sessions, navigate to
// attacker URLs, etc.). Default is fully off; operator must explicitly enable.
//   DISPATCH_CHROME_VIEW_ENABLED=true        — turn the feature on (view-only)
//   DISPATCH_CHROME_VIEW_ALLOW_INPUT=true    — additionally accept Input.* events
const CHROME_VIEW_ENABLED = process.env.DISPATCH_CHROME_VIEW_ENABLED === 'true';
const CHROME_VIEW_ALLOW_INPUT = process.env.DISPATCH_CHROME_VIEW_ALLOW_INPUT === 'true';

function fetchChromeVersion() {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: CDP_HOST, port: CDP_PORT, path: '/json/version', timeout: 2000 },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('CDP /json/version timed out'));
    });
  });
}

function fetchChromeTabs() {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: CDP_HOST, port: CDP_PORT, path: '/json', timeout: 2000 },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(Array.isArray(parsed) ? parsed : []);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('CDP /json timed out'));
    });
  });
}

function pickActivePage(tabs) {
  const pages = tabs.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!pages.length) return null;
  return pages[0];
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, { perMessageDeflate: false });
      this.ws.on('open', () => resolve());
      this.ws.on('error', (err) => reject(err));
      this.ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: r, reject: rj } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rj(new Error(msg.error.message || 'CDP error'));
          else r(msg.result);
          return;
        }
        if (msg.method) {
          for (const listener of this.listeners) listener(msg);
        }
      });
      this.ws.on('close', () => {
        for (const { reject: rj } of this.pending.values()) rj(new Error('CDP closed'));
        this.pending.clear();
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.pending.delete(id);
        reject(new Error('CDP not open'));
        return;
      }
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close();
    } catch {
      /* no-op */
    }
    this.listeners.clear();
    this.pending.clear();
  }
}

function safeSend(clientWs, payload) {
  if (!clientWs || clientWs.readyState !== WebSocket.OPEN) return;
  try {
    clientWs.send(JSON.stringify(payload));
  } catch {
    /* no-op */
  }
}

async function handleChromeScreencastConnection(clientWs) {
  let cdp = null;
  let currentTargetId = null;

  const cleanup = () => {
    if (cdp) {
      cdp.send('Page.stopScreencast').catch(() => {});
      cdp.close();
      cdp = null;
    }
  };

  clientWs.on('close', cleanup);
  clientWs.on('error', cleanup);

  try {
    const tabs = await fetchChromeTabs();
    const target = pickActivePage(tabs);
    if (!target) {
      safeSend(clientWs, {
        type: 'error',
        error: 'No Chrome tabs available. Launch Chrome with --remote-debugging-port=9222.',
      });
      clientWs.close();
      return;
    }

    currentTargetId = target.id;
    cdp = new CdpSession(target.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    safeSend(clientWs, {
      type: 'connected',
      tabUrl: target.url,
      tabTitle: target.title,
      targetId: currentTargetId,
    });

    cdp.onEvent(async (msg) => {
      if (msg.method === 'Page.screencastFrame') {
        const { data, metadata, sessionId } = msg.params || {};
        safeSend(clientWs, { type: 'frame', data, metadata });
        try {
          await cdp.send('Page.screencastFrameAck', { sessionId });
        } catch {
          /* tab closed */
        }
      }
    });

    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 80,
      everyNthFrame: 2,
      maxWidth: 1920,
      maxHeight: 1080,
    });
  } catch (err) {
    safeSend(clientWs, {
      type: 'error',
      error: err && err.message ? err.message : 'CDP connect failed',
    });
    cleanup();
    try { clientWs.close(); } catch { /* no-op */ }
    return;
  }

  clientWs.on('message', async (raw) => {
    if (!cdp) return;
    if (!CHROME_VIEW_ALLOW_INPUT) {
      // View-only mode (default). Drop any Input.* dispatch attempts so a
      // logged-in user cannot drive the operator's real browser. The first
      // such message gets an explicit notice; subsequent ones are silent.
      safeSend(clientWs, {
        type: 'input-disabled',
        error: 'Input forwarding disabled. Set DISPATCH_CHROME_VIEW_ALLOW_INPUT=true to enable.',
      });
      return;
    }
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    try {
      if (msg.type === 'mouse') {
        await cdp.send('Input.dispatchMouseEvent', {
          type: msg.event,
          x: msg.x,
          y: msg.y,
          button: msg.button || 'none',
          buttons: msg.buttons || 0,
          clickCount: msg.clickCount || 0,
          modifiers: msg.modifiers || 0,
        });
      } else if (msg.type === 'key') {
        await cdp.send('Input.dispatchKeyEvent', {
          type: msg.event,
          text: msg.text,
          key: msg.key,
          code: msg.code,
          modifiers: msg.modifiers || 0,
        });
      } else if (msg.type === 'text') {
        await cdp.send('Input.insertText', { text: msg.text });
      } else if (msg.type === 'scroll') {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: msg.x,
          y: msg.y,
          deltaX: msg.deltaX || 0,
          deltaY: msg.deltaY || 0,
          modifiers: msg.modifiers || 0,
        });
      } else if (msg.type === 'resize') {
        await cdp.send('Page.startScreencast', {
          format: 'jpeg',
          quality: msg.quality || 80,
          everyNthFrame: msg.everyNthFrame || 2,
          maxWidth: msg.maxWidth || 1920,
          maxHeight: msg.maxHeight || 1080,
        });
      }
    } catch (err) {
      safeSend(clientWs, {
        type: 'input-error',
        error: err && err.message ? err.message : 'input dispatch failed',
      });
    }
  });
}

export function attachChromeScreencast(httpServer, rootWss) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    handleChromeScreencastConnection(ws).catch((err) => {
      console.error('[chrome-screencast] handler error:', err);
      try { ws.close(); } catch { /* no-op */ }
    });
  });

  // Patch the root WebSocketServer's `shouldHandle` so it returns false
  // for our path. Without this the ws library's internal upgrade listener
  // also invokes handleUpgrade on the same socket after ours has, and
  // throws `server.handleUpgrade() was called more than once with the
  // same socket`.
  if (rootWss && typeof rootWss.shouldHandle === 'function') {
    const original = rootWss.shouldHandle.bind(rootWss);
    rootWss.shouldHandle = (req) => {
      if ((req.url || '').startsWith('/ws/chrome-view')) return false;
      return original(req);
    };
  }

  // `prependListener` ensures this handler runs before the root wss
  // listener in server/index.js and wins the upgrade race for
  // /ws/chrome-view paths.
  httpServer.prependListener('upgrade', (req, socket, head) => {
    const rawUrl = req.url || '';
    if (!rawUrl.startsWith('/ws/chrome-view')) return;

    if (!CHROME_VIEW_ENABLED) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const parsed = new URL(rawUrl, 'http://localhost');
    const token =
      parsed.searchParams.get('token') ||
      (req.headers.authorization || '').split(' ')[1];
    const user = authenticateWebSocket(token);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  return wss;
}

// HTTP helper route: GET /api/chrome-view/status → is CDP reachable?
const router = express.Router();

router.get('/status', async (_req, res) => {
  if (!CHROME_VIEW_ENABLED) {
    return res.status(503).json({
      ok: false,
      enabled: false,
      hint: 'Chrome viewer disabled. Set DISPATCH_CHROME_VIEW_ENABLED=true to opt in.',
    });
  }
  try {
    const version = await fetchChromeVersion();
    res.json({
      ok: true,
      enabled: true,
      inputEnabled: CHROME_VIEW_ALLOW_INPUT,
      browser: version.Browser,
      protocolVersion: version['Protocol-Version'],
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      enabled: true,
      error: err && err.message ? err.message : 'CDP unreachable',
      hint: 'Launch Chrome with --remote-debugging-port=9222',
    });
  }
});

router.get('/tabs', async (_req, res) => {
  if (!CHROME_VIEW_ENABLED) {
    return res.status(503).json({
      enabled: false,
      hint: 'Chrome viewer disabled. Set DISPATCH_CHROME_VIEW_ENABLED=true to opt in.',
    });
  }
  try {
    const tabs = await fetchChromeTabs();
    res.json(
      tabs
        .filter((t) => t.type === 'page')
        .map((t) => ({ id: t.id, url: t.url, title: t.title })),
    );
  } catch (err) {
    res.status(503).json({ error: err && err.message ? err.message : 'CDP unreachable' });
  }
});

export default router;
