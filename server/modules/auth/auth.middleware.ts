// @ts-nocheck -- JWT request augmentation is narrowed by Auth route contracts.
import jwt from 'jsonwebtoken';

import { IS_PLATFORM } from '@/shared/utils.js';

import { userDb, appConfigDb } from '../database/index.js';

// Use env var if set, otherwise auto-generate a unique secret per installation
const JWT_SECRET = process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();

// Optional API key middleware
const validateApiKey = (req, res, next) => {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// A log line is one line: a newline, a control character or a quote coming
// from the request would let a caller forge entries or break the `ua="..."`
// field. Everything interpolated below goes through this first.
const forLogLine = (value: unknown, maxLength: number): string =>
  String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/"/g, "'")
    .slice(0, maxLength);

/**
 * Records why a request was rejected with 401.
 *
 * Every rejection branch below used to be silent apart from a bad signature,
 * so the server logs could not distinguish "the client sent no token" from
 * "the token expired" from "the signing secret changed" - all three of which
 * surface identically in the UI as an expired session.
 */
const logAuthRejection = (req, reason: string, detail = ''): void => {
  // `baseUrl + path` deliberately, never `originalUrl`: SSE endpoints pass the
  // JWT as a `?token=` query parameter, which would put bearer credentials in
  // the log. `path` alone is router-relative, so it loses the endpoint.
  const target = forLogLine(`${req.method} ${req.baseUrl || ''}${req.path}`, 200);

  // Every client reaches this server through the same loopback proxy, so the
  // remote address cannot tell one device from another. The user agent can,
  // which is what makes a rejection attributable to a specific browser.
  const userAgent = forLogLine(req.headers['user-agent'] ?? 'unknown', 120);
  const safeDetail = forLogLine(detail, 200);

  console.warn(
    `[Auth] 401 ${reason} ${target}${safeDetail ? ` ${safeDetail}` : ''} ua="${userAgent}"`
  );
};

// JWT authentication middleware
const authenticateToken = async (req, res, next) => {
  // Platform mode:  use single database user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (!user) {
        return res.status(500).json({ error: 'Platform mode: No user found in database' });
      }
      req.user = user;
      return next();
    } catch (error) {
      console.error('Platform mode error:', error);
      return res.status(500).json({ error: 'Platform mode: Failed to fetch user' });
    }
  }

  // Normal OSS JWT validation
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  // Also check query param for SSE endpoints (EventSource can't set headers)
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    logAuthRejection(req, 'no-token');
    res.setHeader('X-Auth-Error', 'invalid-token');
    return res.status(401).json({
      error: 'Access denied. No token provided.',
      code: 'AUTH_TOKEN_INVALID',
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Verify user still exists and is active
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      logAuthRejection(req, 'user-not-found', `userId=${decoded.userId}`);
      res.setHeader('X-Auth-Error', 'invalid-token');
      return res.status(401).json({
        error: 'Invalid token. User not found.',
        code: 'AUTH_TOKEN_INVALID',
      });
    }

    // Auto-refresh: if token is past halfway through its lifetime, issue a new one
    if (decoded.exp && decoded.iat) {
      const now = Math.floor(Date.now() / 1000);
      const halfLife = (decoded.exp - decoded.iat) / 2;
      if (now > decoded.iat + halfLife) {
        const newToken = generateToken(user);
        res.setHeader('X-Refreshed-Token', newToken);
      }
    }

    req.user = user;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      // `issued` shows how old the token was: a full lifetime means the client
      // never picked up an X-Refreshed-Token, which is a refresh bug rather
      // than a user who simply stayed away past the expiry window.
      const claims = jwt.decode(token);
      const issued =
        claims && typeof claims === 'object' && typeof claims.iat === 'number'
          ? new Date(claims.iat * 1000).toISOString()
          : 'unknown';
      logAuthRejection(
        req,
        'session-expired',
        `issued=${issued} expired=${error.expiredAt?.toISOString() ?? 'unknown'}`,
      );
      res.setHeader('X-Auth-Error', 'session-expired');
      return res.status(401).json({
        error: 'Session expired. Please log in again.',
        code: 'AUTH_TOKEN_EXPIRED',
      });
    }

    logAuthRejection(
      req,
      'invalid-token',
      error instanceof Error ? error.message : String(error),
    );
    res.setHeader('X-Auth-Error', 'invalid-token');
    return res.status(401).json({
      error: 'Invalid token',
      code: 'AUTH_TOKEN_INVALID',
    });
  }
};

// Generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// WebSocket authentication function
const authenticateWebSocket = (token) => {
  // Platform mode: bypass token validation, return first user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (user) {
        return { id: user.id, userId: user.id, username: user.username };
      }
      return null;
    } catch (error) {
      console.error('Platform mode WebSocket error:', error);
      return null;
    }
  }

  // Normal OSS JWT validation
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Verify user actually exists in database (matches REST authenticateToken behavior)
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return null;
    }
    return { userId: user.id, username: user.username };
  } catch (error) {
    if (!(error instanceof jwt.TokenExpiredError)) {
      console.warn(
        'WebSocket token verification failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
    return null;
  }
};

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  JWT_SECRET
};
