import type { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { userDb } from '@/shared/database/repositories/users.js';
import { appConfigDb } from '@/shared/database/repositories/app-config.js';
import { IS_PLATFORM } from '@/config/env.js';
import type { AuthenticatedRequest } from '@/shared/types/http.js';
import { logger } from '@/shared/utils/logger.js';
import { CreateUserResult } from '@/shared/database/types.js';

// Use env var if set, otherwise auto-generate a unique secret per installation
export const JWT_SECRET = process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();

/**
 * Optional API key middleware.
 * If API_KEY is set in the environment, all requests to the API must include
 * an 'x-api-key' header matching the configured value.
 */
export const validateApiKey = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    next();
    return;
  }
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  next();
};

/**
 * JWT authentication middleware.
 * Verifies the JWT token and attaches the user to the request object.
 * In Platform mode, it bypasses JWT validation and uses the first database user.
 */
export const authenticateToken = async (
  req: AuthenticatedRequest, 
  res: Response, 
  next: NextFunction
): Promise<void> => {
  // Platform mode: use single database user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (!user) {
        res.status(500).json({ error: 'Platform mode: No user found in database' });
        return;
      }
      req.user = user;
      next();
      return;
    } catch (error) {
      logger.error('Platform mode error:', { error });
      res.status(500).json({ error: 'Platform mode: Failed to fetch user' });
      return;
    }
  }

  // Normal OSS JWT validation
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  // Also check query param for SSE endpoints (EventSource can't set headers)
  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) {
    res.status(401).json({ error: 'Access denied. No token provided.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;

    // Verify user still exists and is active
    if (!decoded.userId) {
      res.status(401).json({ error: 'Invalid token payload.' });
      return;
    }

    const user = userDb.getUserById(decoded.userId as number);
    if (!user) {
      res.status(401).json({ error: 'Invalid token. User not found.' });
      return;
    }

    // Auto-refresh: if token is past halfway through its lifetime, issue a new one
    if (decoded.exp && decoded.iat) {
      const now = Math.floor(Date.now() / 1000);
      const halfLife = (decoded.exp - decoded.iat) / 2;
      if (now > decoded.iat + halfLife) {
        const newToken = generateToken({ id: user.id, username: user.username });
        res.setHeader('X-Refreshed-Token', newToken);
      }
    }

    req.user = user;
    next();
  } catch (error) {
    logger.error('Token verification error:', { error });
    res.status(403).json({ error: 'Invalid token' });
    return;
  }
};

/**
 * Generates a JWT token for the given user.
 * Valid for 7 days.
 */
export const generateToken = (user: CreateUserResult): string => {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

/**
 * WebSocket authentication function.
 * Validates a JWT token for WebSocket connections.
 * Returns the authenticated user payload or null if invalid.
 */
export const authenticateWebSocket = (token: string | null): { userId: number; username: string; id?: number } | null => {
  // Platform mode: bypass token validation, return first user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (user) {
        return { id: user.id, userId: user.id, username: user.username };
      }
      return null;
    } catch (error) {
      logger.error('Platform mode WebSocket error:', { error });
      return null;
    }
  }

  // Normal OSS JWT validation
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    
    if (!decoded.userId) return null;

    // Verify user actually exists in database (matches REST authenticateToken behavior)
    const user = userDb.getUserById(decoded.userId as number);
    if (!user) {
      return null;
    }
    return { userId: user.id, username: user.username };
  } catch (error) {
    logger.error('WebSocket token verification error:', { error });
    return null;
  }
};
