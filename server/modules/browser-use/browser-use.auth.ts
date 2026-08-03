import type { RequestHandler } from 'express';

type ValidateViewerToken = (
  sessionId: string,
  token: string | null | undefined,
) => boolean;

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function readCookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;

  const prefix = `${name}=`;
  const cookie = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!cookie) return null;

  return decodePathSegment(cookie.slice(prefix.length));
}

function readQueryToken(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Creates the Browser API authentication middleware consumed by the server
 * composition root. Viewer assets accept only a session-scoped viewer token;
 * every other Browser API route delegates to the normal application auth.
 */
export function createBrowserUseApiAuthentication(
  authenticateToken: RequestHandler,
  validateViewerToken: ValidateViewerToken,
  viewerCookieName: string,
): RequestHandler {
  return (req, res, next) => {
    const match = /^\/sessions\/([^/]+)\/viewer(?:\/|$)/.exec(req.path || '');
    if (!match) {
      return authenticateToken(req, res, next);
    }

    const sessionId = decodePathSegment(match[1]);
    const token = readQueryToken(req.query.viewerToken)
      ?? readCookieValue(req.headers.cookie, viewerCookieName);
    if (sessionId && validateViewerToken(sessionId, token)) {
      next();
      return;
    }

    res.status(401).json({
      error: 'Browser viewer access requires a valid session token.',
    });
  };
}

/**
 * Creates the Browser viewer upgrade validator consumed by the WebSocket
 * composition root. Only the exact noVNC websockify path is eligible.
 */
export function createBrowserUseViewerWebSocketAuthentication(
  validateViewerToken: ValidateViewerToken,
): (pathname: string, token: string | null) => boolean {
  return (pathname, token) => {
    const match =
      /^\/api\/browser-use\/sessions\/([^/]+)\/viewer\/websockify$/.exec(pathname);
    const sessionId = match ? decodePathSegment(match[1]) : null;
    return Boolean(sessionId && validateViewerToken(sessionId, token));
  };
}
