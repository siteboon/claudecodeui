import express from 'express';
import http from 'http';
import net from 'net';

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
// server/index.js via `attachPreviewUpgrade(server)`.
export function attachPreviewUpgrade(server) {
  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (!url.startsWith('/preview/')) return;

    const match = url.match(/^\/preview\/(\d{2,5})(\/.*)?$/);
    if (!match) {
      socket.destroy();
      return;
    }

    const port = match[1];
    const upstreamPath = match[2] || '/';
    if (!isValidPort(port)) {
      socket.destroy();
      return;
    }

    const upstream = net.connect(Number(port), '127.0.0.1', () => {
      const handshake =
        `${req.method} ${upstreamPath} HTTP/1.1\r\n` +
        Object.entries(req.headers)
          .filter(([key]) => !HOP_BY_HOP_HEADERS.has(key.toLowerCase()) || key.toLowerCase() === 'upgrade' || key.toLowerCase() === 'connection')
          .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
          .join('\r\n') +
        '\r\n\r\n';
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
