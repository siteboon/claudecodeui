import http from 'http';
import net from 'net';

import express from 'express';

import { authenticateWebSocket } from '../middleware/auth.js';

const router = express.Router();

const PORT_PATTERN = /^\d{2,5}$/;
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

// Default-deny common service ports even within the dev range. Postgres,
// MySQL, Redis, MongoDB, Memcached, Elasticsearch, Kafka, the CDP itself,
// and a few other infra defaults — proxying to them via an authenticated
// browser session is an SSRF foothold, not a developer convenience.
const DEFAULT_BLOCKED_PORTS = new Set([
  3306, 5432, 6379, 9092, 9200, 9300, 11211, 27017, 28017, 9222, 9223, 5984, 8086,
]);

const DEFAULT_PORT_ALLOWLIST = new Set([
  3000, 3001, 3002, 3003, 3030, 3333,
  4000, 4173, 4200,
  5000, 5001, 5173, 5174, 5500, 5555,
  6000, 6006,
  7000, 7777,
  8000, 8001, 8080, 8081, 8888,
  9000, 9001, 9090, 9876,
]);

function parsePortListEnv(value) {
  if (!value) return null;
  const out = new Set();
  for (const piece of value.split(',')) {
    const n = Number(piece.trim());
    if (Number.isInteger(n) && n >= 1 && n <= 65535) out.add(n);
  }
  return out.size > 0 ? out : null;
}

const ENV_ALLOWLIST = parsePortListEnv(process.env.DISPATCH_PREVIEW_PORTS);
const ALLOW_ANY_HIGH_PORT = process.env.DISPATCH_PREVIEW_ALLOW_ANY_HIGH_PORT === 'true';

function isValidPort(portStr) {
  if (!PORT_PATTERN.test(portStr)) return false;
  const port = Number(portStr);
  if (port < 1 || port > 65535) return false;
  if (DEFAULT_BLOCKED_PORTS.has(port)) return false;
  if (ENV_ALLOWLIST) return ENV_ALLOWLIST.has(port);
  if (DEFAULT_PORT_ALLOWLIST.has(port)) return true;
  // Opt-in escape hatch for users running dev servers on uncommon ports.
  if (ALLOW_ANY_HIGH_PORT && port >= 1024) return true;
  return false;
}

function stripHopByHop(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

function rewriteCookieDomain(setCookie, requestHost) {
  if (!setCookie) return setCookie;
  const entries = Array.isArray(setCookie) ? setCookie : [setCookie];
  const host = (requestHost || '').split(':')[0];
  return entries.map((cookie) =>
    cookie
      .replace(/;\s*Domain=[^;]+/gi, host ? `; Domain=${host}` : '')
      .replace(/;\s*Secure/gi, ''),
  );
}

router.use('/:port', (req, res) => {
  const { port } = req.params;

  if (!isValidPort(port)) {
    res.status(400).json({
      error: 'Port not allowed for preview proxy',
      hint: 'Set DISPATCH_PREVIEW_PORTS or DISPATCH_PREVIEW_ALLOW_ANY_HIGH_PORT=true to allow custom ports.',
    });
    return;
  }

  // `req.url` here is the path *after* `/preview/:port`. Empty string → `/`.
  const upstreamPath = req.url && req.url !== '' ? req.url : '/';

  const proxyReq = http.request(
    {
      host: '127.0.0.1',
      port: Number(port),
      method: req.method,
      path: upstreamPath,
      headers: {
        ...stripHopByHop(req.headers),
        host: `127.0.0.1:${port}`,
        'x-forwarded-host': req.headers.host || '',
        'x-forwarded-proto': req.protocol || 'http',
        'accept-encoding': 'identity',
      },
    },
    (proxyRes) => {
      const outHeaders = stripHopByHop(proxyRes.headers);
      if (outHeaders['set-cookie']) {
        outHeaders['set-cookie'] = rewriteCookieDomain(outHeaders['set-cookie'], req.headers.host);
      }
      // Strip CSP/X-Frame-Options so the iframe is allowed to frame us.
      delete outHeaders['content-security-policy'];
      delete outHeaders['content-security-policy-report-only'];
      delete outHeaders['x-frame-options'];

      res.writeHead(proxyRes.statusCode || 502, outHeaders);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({
        error: 'Preview upstream unavailable',
        detail: err.code || err.message,
        port,
      });
    } else {
      res.destroy();
    }
  });

  req.pipe(proxyReq);
});

// WebSocket upgrade handler for HMR / dev-server sockets. Registered by
// server/index.js via `attachPreviewUpgrade(server, rootWss)`. Patches the
// root WebSocketServer so `shouldHandle` returns false for `/preview/*`,
// which prevents the ws library's internal upgrade listener from also
// calling handleUpgrade on a socket we already consumed (that path threw
// `server.handleUpgrade() was called more than once with the same socket`).
// Uses `prependListener` so our handler runs before the ws internal one.
export function attachPreviewUpgrade(server, rootWss) {
  if (rootWss && typeof rootWss.shouldHandle === 'function') {
    const original = rootWss.shouldHandle.bind(rootWss);
    rootWss.shouldHandle = (req) => {
      if ((req.url || '').startsWith('/preview/')) return false;
      return original(req);
    };
  }
  server.prependListener('upgrade', (req, socket, head) => {
    const rawUrl = req.url || '';
    if (!rawUrl.startsWith('/preview/')) return;

    const match = rawUrl.match(/^\/preview\/(\d{2,5})(\/.*)?(\?.*)?$/);
    if (!match) {
      socket.destroy();
      return;
    }

    const port = match[1];
    const upstreamPath = (match[2] || '/') + (match[3] || '');
    if (!isValidPort(port)) {
      socket.destroy();
      return;
    }

    // Enforce JWT auth on the WS upgrade — mirrors the root wss
    // `verifyClient` behavior from server/index.js.
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

    const upstream = net.connect(Number(port), '127.0.0.1', () => {
      const upstreamHeaders = Object.entries(req.headers)
        .filter(([key]) => {
          const k = key.toLowerCase();
          // Keep upgrade/connection headers (required for WS handshake),
          // strip the rest of the hop-by-hops.
          if (k === 'upgrade' || k === 'connection') return true;
          return !HOP_BY_HOP_HEADERS.has(k);
        })
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
        .join('\r\n');
      const handshake = `${req.method} ${upstreamPath} HTTP/1.1\r\n${upstreamHeaders}\r\n\r\n`;
      upstream.write(handshake);
      if (head && head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });

    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
}

export default router;
