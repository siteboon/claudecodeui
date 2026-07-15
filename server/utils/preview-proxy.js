import http from 'node:http';

import jwt from 'jsonwebtoken';

import { JWT_SECRET } from '../middleware/auth.js';

// Name of the httpOnly cookie carrying the short-lived preview token. An iframe
// cannot attach an Authorization header to its sub-resource requests, so the
// preview surface authenticates itself with this cookie instead of a Bearer.
export const PREVIEW_COOKIE = 'cloudcli_preview';
const PREVIEW_TOKEN_TTL = '12h';

// Query param used to bootstrap the cookie when the iframe is loaded from a
// different origin than the one that set the cookie (dev mode). The middleware
// exchanges it for the cookie and immediately redirects it out of the URL so
// the proxied app never sees the token.
const BOOTSTRAP_PARAM = '__cctoken';

const PREVIEW_PREFIX_RE = /^\/preview\/(\d{1,5})(\/.*)?$/;
const REFERER_PREFIX_RE = /\/preview\/(\d{1,5})(?:\/|$)/;

export function issuePreviewToken() {
  return jwt.sign({ preview: true }, JWT_SECRET, { expiresIn: PREVIEW_TOKEN_TTL });
}

export function verifyPreviewToken(token) {
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return Boolean(decoded && decoded.preview === true);
  } catch {
    return false;
  }
}

/**
 * @param {string | undefined} header
 * @returns {Record<string, string>}
 */
export function parseCookies(header) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function isPreviewAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifyPreviewToken(cookies[PREVIEW_COOKIE]);
}

function isValidPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

// Rewrite a redirect Location so the browser stays inside the /preview/<port>/
// namespace instead of escaping to the app's own origin root.
function rewriteLocation(location, port) {
  if (!location) return location;
  // Absolute URL pointing back at the upstream loopback host.
  const loopbackMatch = location.match(/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(\/.*)?$/i);
  if (loopbackMatch) {
    return `/preview/${port}${loopbackMatch[1] || '/'}`;
  }
  // Root-relative redirect from the app (e.g. "/login").
  if (location.startsWith('/') && !location.startsWith('/preview/')) {
    return `/preview/${port}${location}`;
  }
  return location;
}

function proxyHttp(req, res, port, upstreamPath) {
  if (!isValidPort(port)) {
    res.statusCode = 400;
    res.end('Invalid preview port');
    return;
  }

  const headers = { ...req.headers };
  headers.host = `127.0.0.1:${port}`;
  // Strip our own preview cookie so the proxied app never receives it.
  if (headers.cookie) {
    const kept = headers.cookie
      .split(';')
      .filter((c) => c.trim().split('=')[0].trim() !== PREVIEW_COOKIE)
      .join('; ');
    if (kept) headers.cookie = kept;
    else delete headers.cookie;
  }
  // Ask upstream for uncompressed bytes so we can inject <base> into HTML.
  delete headers['accept-encoding'];

  const upstream = http.request(
    { hostname: '127.0.0.1', port, path: upstreamPath, method: req.method, headers },
    (proxyRes) => {
      const resHeaders = { ...proxyRes.headers };
      if (resHeaders.location) {
        resHeaders.location = rewriteLocation(resHeaders.location, port);
      }

      const contentType = String(proxyRes.headers['content-type'] || '');
      const isHtml = contentType.includes('text/html');

      if (!isHtml) {
        res.writeHead(proxyRes.statusCode || 502, resHeaders);
        proxyRes.pipe(res);
        return;
      }

      // Buffer HTML to inject a <base> tag; this makes the app's relative URLs
      // resolve under /preview/<port>/. Absolute-path assets are handled
      // separately by the Referer fallback in previewProxyMiddleware.
      const chunks = [];
      proxyRes.on('data', (c) => chunks.push(c));
      proxyRes.on('end', () => {
        let body = Buffer.concat(chunks).toString('utf8');
        const baseTag = `<base href="/preview/${port}/">`;
        if (/<head[^>]*>/i.test(body)) {
          body = body.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}`);
        } else {
          body = `${baseTag}${body}`;
        }
        delete resHeaders['content-length'];
        delete resHeaders['content-encoding'];
        res.writeHead(proxyRes.statusCode || 502, resHeaders);
        res.end(body);
      });
    },
  );

  upstream.on('error', (err) => {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.end(`Preview upstream error on port ${port}: ${err.message}`);
    } else {
      res.end();
    }
  });

  req.pipe(upstream);
}

/**
 * Express middleware that serves the /preview/<port>/ proxy. Mount it BEFORE the
 * body parsers so request bodies stream through untouched. It self-authenticates
 * with the preview cookie, so it must stay outside the JWT-protected /api mount.
 */
export function previewProxyMiddleware(req, res, next) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  // Bootstrap: exchange a one-shot token in the query string for the cookie.
  const bootstrapToken = url.searchParams.get(BOOTSTRAP_PARAM);
  if (bootstrapToken && verifyPreviewToken(bootstrapToken)) {
    url.searchParams.delete(BOOTSTRAP_PARAM);
    res.setHeader(
      'Set-Cookie',
      `${PREVIEW_COOKIE}=${bootstrapToken}; Path=/preview; HttpOnly; SameSite=Lax`,
    );
    res.statusCode = 302;
    res.setHeader('Location', `${pathname}${url.search}`);
    res.end();
    return;
  }

  const prefixMatch = pathname.match(PREVIEW_PREFIX_RE);
  if (prefixMatch) {
    if (!isPreviewAuthenticated(req)) {
      res.statusCode = 401;
      res.end('Preview session required');
      return;
    }
    const port = Number(prefixMatch[1]);
    const rest = prefixMatch[2] || '/';
    proxyHttp(req, res, port, `${rest}${url.search}`);
    return;
  }

  // Fallback for absolute-path assets (e.g. "/assets/app.js") requested by an
  // app loaded under /preview/<port>/: recover the target port from the Referer.
  const referer = req.headers.referer || req.headers.referrer;
  if (referer && !pathname.startsWith('/api/')) {
    const refMatch = String(referer).match(REFERER_PREFIX_RE);
    if (refMatch && isPreviewAuthenticated(req)) {
      const port = Number(refMatch[1]);
      proxyHttp(req, res, port, req.url);
      return;
    }
  }

  next();
}
