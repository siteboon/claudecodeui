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

function isValidPort(portStr) {
  if (!PORT_PATTERN.test(portStr)) return false;
  const port = Number(portStr);
  return port >= 1 && port <= 65535;
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
    res.status(400).json({ error: 'Invalid port' });
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
// server/index.js via `attachPreviewUpgrade(server)`. Uses
// `prependListener` so it wins the race against the root wss for
// /preview/* paths, leaving /ws, /shell, /plugin-ws/* for the root wss.
export function attachPreviewUpgrade(server) {
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
