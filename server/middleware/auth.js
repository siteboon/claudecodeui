import jwt from 'jsonwebtoken';

import { IS_PLATFORM } from '../constants/config.js';
import { appConfigDb, userDb } from '../modules/database/index.js';

const JWT_SECRET = process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();
const TOKEN_EXPIRES_IN = '7d';
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function normalizeRemoteAddress(address) {
  return String(address || '').replace(/^::ffff:/, '');
}

function isTrustedProxyPeer(req) {
  const remoteAddress = normalizeRemoteAddress(req.socket?.remoteAddress);
  const trustedPeers = (process.env.TRUSTED_PROXY_CIDRS || '')
    .split(',')
    .map((value) => normalizeRemoteAddress(value.trim()))
    .filter(Boolean);

  if (trustedPeers.length === 0) {
    return LOOPBACK_ADDRESSES.has(req.socket?.remoteAddress) || LOOPBACK_ADDRESSES.has(remoteAddress);
  }

  return trustedPeers.includes(remoteAddress) || trustedPeers.includes(req.socket?.remoteAddress);
}

function authenticateTrustedProxy(req) {
  if (process.env.TRUSTED_PROXY_AUTH !== 'true' || !isTrustedProxyPeer(req)) {
    return null;
  }

  const headerName = (process.env.TRUSTED_PROXY_USER_HEADER || 'remote-user').toLowerCase();
  const username = String(req.headers?.[headerName] || '').trim();
  if (!username) {
    return null;
  }

  const user = userDb.getFirstUser();
  if (!user || user.username !== username) {
    return null;
  }

  return user;
}

function generateToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRES_IN },
  );
}

function maybeRefreshToken(decoded, user) {
  if (!decoded?.exp || !decoded?.iat) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const halfLife = Math.floor((decoded.exp - decoded.iat) / 2);
  return now > decoded.iat + halfLife ? generateToken(user) : null;
}

function verifyJwtToken(token) {
  if (!token) {
    return null;
  }

  const decoded = jwt.verify(token, JWT_SECRET);
  const user = userDb.getUserById(decoded.userId);
  if (!user) {
    return null;
  }

  return {
    user,
    decoded,
    refreshedToken: maybeRefreshToken(decoded, user),
  };
}

const validateApiKey = (req, res, next) => {
  if (!process.env.API_KEY) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  return next();
};

const authenticateToken = async (req, res, next) => {
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

  const proxyUser = authenticateTrustedProxy(req);
  if (proxyUser) {
    req.user = proxyUser;
    return next();
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1] || req.query.token;
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const result = verifyJwtToken(token);
    if (!result) {
      return res.status(401).json({ error: 'Invalid token. User not found.' });
    }

    req.user = result.user;
    req.refreshedToken = result.refreshedToken;
    if (result.refreshedToken) {
      res.setHeader('X-Refreshed-Token', result.refreshedToken);
    }

    return next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

const authenticateWebSocket = (token, req = null) => {
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      return user ? { id: user.id, userId: user.id, username: user.username } : null;
    } catch (error) {
      console.error('Platform mode WebSocket error:', error);
      return null;
    }
  }

  if (req) {
    const proxyUser = authenticateTrustedProxy(req);
    if (proxyUser) {
      return { id: proxyUser.id, userId: proxyUser.id, username: proxyUser.username };
    }
  }

  try {
    const result = verifyJwtToken(token);
    if (!result) {
      return null;
    }

    return {
      id: result.user.id,
      userId: result.user.id,
      username: result.user.username,
      refreshedToken: result.refreshedToken,
    };
  } catch (error) {
    console.error('WebSocket token verification error:', error);
    return null;
  }
};

export {
  JWT_SECRET,
  authenticateToken,
  authenticateTrustedProxy,
  authenticateWebSocket,
  generateToken,
  validateApiKey,
  verifyJwtToken,
};
