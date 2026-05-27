import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { userDb, appConfigDb } from '../modules/database/index.js';
import { IS_PLATFORM } from '../constants/config.js';

// Use env var if set, otherwise auto-generate a unique secret per installation
const JWT_SECRET = process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();

// --- Trusted reverse-proxy header authentication ---------------------------------
// When CloudCLI runs behind an authenticating reverse proxy (Authelia, oauth2-proxy,
// Authentik, etc.) that performs forward-auth and injects the authenticated username
// as a request header, that identity can be trusted instead of requiring a second
// local login. Opt-in via TRUSTED_PROXY_AUTH=true. Requests are only trusted when
// they originate from one of TRUSTED_PROXY_CIDRS (loopback only by default — widen to
// your proxy's source range only once the proxy is configured to strip/override the
// identity header) so the header cannot be spoofed by a client reaching the app directly.
const TRUSTED_PROXY_AUTH = process.env.TRUSTED_PROXY_AUTH === 'true';
const TRUSTED_PROXY_USER_HEADER = (process.env.TRUSTED_PROXY_USER_HEADER || 'Remote-User').toLowerCase();
const TRUSTED_PROXY_CIDRS = (process.env.TRUSTED_PROXY_CIDRS || '127.0.0.0/8,::1/128')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const ipv4ToInt = (ip) => ip.split('.').reduce((acc, oct) => ((acc << 8) + parseInt(oct, 10)) >>> 0, 0) >>> 0;

const cidrMatch = (ip, cidr) => {
  if (cidr.includes(':')) {
    // Minimal IPv6 support: exact match on the network part.
    return ip === cidr.split('/')[0];
  }
  if (!ip.includes('.')) return false;
  const [range, bitsRaw] = cidr.split('/');
  const bits = bitsRaw === undefined ? 32 : parseInt(bitsRaw, 10);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
};

const isFromTrustedProxy = (req) => {
  let ip = (req.socket && req.socket.remoteAddress) || req.ip || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7); // unwrap IPv4-mapped IPv6
  return TRUSTED_PROXY_CIDRS.some((cidr) => cidrMatch(ip, cidr));
};

// Resolve (and lazily provision) the local user vouched for by a trusted proxy header.
// Returns the user record, or null when proxy auth is disabled / source is untrusted /
// the identity header is absent.
const resolveTrustedProxyUser = (req) => {
  if (!TRUSTED_PROXY_AUTH) return null;
  if (!isFromTrustedProxy(req)) return null;
  const username = req.headers[TRUSTED_PROXY_USER_HEADER];
  if (!username || typeof username !== 'string') return null;

  const existing = userDb.getUserByUsername(username);
  if (existing) return existing;

  // CloudCLI is single-user by design (see the /register guard, which refuses a second
  // account). To preserve that invariant, once any account exists a *different* proxy
  // identity is refused here rather than silently creating extra users.
  if (userDb.hasUsers()) return null;

  // No account yet: provision the one-and-only user from the proxy identity, with an
  // unguessable random password hash (its local password login is never used). Re-read
  // it so callers get the full user row (id is a real number, not lastInsertRowid bigint).
  const randomHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
  userDb.createUser(username, randomHash);
  return userDb.getUserByUsername(username) || null;
};

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

  // Trusted reverse-proxy header auth: identity already verified by the upstream proxy.
  const proxyUser = resolveTrustedProxyUser(req);
  if (proxyUser) {
    req.user = proxyUser;
    return next();
  }

  // Normal OSS JWT validation
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  // Also check query param for SSE endpoints (EventSource can't set headers)
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Verify user still exists and is active
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token. User not found.' });
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
    console.error('Token verification error:', error);
    return res.status(403).json({ error: 'Invalid token' });
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
    console.error('WebSocket token verification error:', error);
    return null;
  }
};

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  resolveTrustedProxyUser,
  cidrMatch,
  isFromTrustedProxy,
  JWT_SECRET
};
