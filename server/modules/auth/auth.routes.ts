import express from 'express';
import type { RequestHandler } from 'express';

import type { createAuthService } from './auth.service.js';
import { createRateLimiter } from './rate-limit.middleware.js';

type AuthenticatedRequest = express.Request & { user?: unknown };

// 10 attempts per IP per minute is generous for legitimate use (the only
// registered user is the local admin) but tight enough to slow down online
// credential stuffing. Lockouts extend the window by an additional minute so
// a misconfigured client cannot hammer the endpoint forever.
const AUTH_RATE_LIMIT_MAX = 10;
const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;
const AUTH_RATE_LIMIT_LOCKOUT_MS = 60_000;

const authRateLimit = createRateLimiter({
  maxAttempts: AUTH_RATE_LIMIT_MAX,
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  lockoutMs: AUTH_RATE_LIMIT_LOCKOUT_MS,
});

/**
 * Creates the Auth transport adapter. Handlers only parse request data and
 * delegate authentication behavior to the injected application service.
 */
export function createAuthRouter(
  service: ReturnType<typeof createAuthService>,
  authenticateToken: RequestHandler,
): express.Router {
  const router = express.Router();

  router.get('/status', (_req, res, next) => {
    try {
      res.json(service.getStatus());
    } catch (error) {
      next(error);
    }
  });

  router.post('/register', authRateLimit.middleware, async (req, res, next) => {
    try {
      const body = req.body as { username?: unknown; password?: unknown };
      res.json(await service.register(body.username, body.password));
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', authRateLimit.middleware, async (req, res, next) => {
    try {
      const body = req.body as { username?: unknown; password?: unknown };
      res.json(await service.login(body.username, body.password));
    } catch (error) {
      next(error);
    }
  });

  router.get('/user', authenticateToken, (req, res) => {
    res.json(service.getCurrentUser((req as AuthenticatedRequest).user));
  });

  router.post('/refresh', authenticateToken, (req, res) => {
    res.json(service.refreshSession((req as AuthenticatedRequest).user));
  });

  router.post('/logout', authenticateToken, (_req, res) => {
    res.json(service.logout());
  });

  return router;
}
