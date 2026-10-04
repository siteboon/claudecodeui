import express from 'express';
import type { RequestHandler } from 'express';

import type { createAuthService } from './auth.service.js';
import { normalizeCasReturnPath } from './cas.service.js';
import type { createCasService } from './cas.service.js';

type AuthenticatedRequest = express.Request & { user?: unknown };

// Remembers, across the round trip through the CAS server, which SPA path the
// sign-in started from (CAS itself only carries the fixed service URL back).
const CAS_RETURN_PATH_COOKIE = 'cloudcli_cas_return';
const CAS_RETURN_PATH_MAX_AGE_MS = 10 * 60 * 1000;

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  for (const cookie of (cookieHeader ?? '').split(';')) {
    const separatorIndex = cookie.indexOf('=');
    if (separatorIndex !== -1 && cookie.slice(0, separatorIndex).trim() === name) {
      try {
        return decodeURIComponent(cookie.slice(separatorIndex + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Creates the Auth transport adapter. Handlers only parse request data and
 * delegate authentication behavior to the injected application service.
 */
export function createAuthRouter(
  service: ReturnType<typeof createAuthService>,
  authenticateToken: RequestHandler,
  casService: ReturnType<typeof createCasService> | null = null,
): express.Router {
  const router = express.Router();

  router.get('/status', (_req, res, next) => {
    try {
      res.json({
        ...service.getStatus(),
        cas: casService ? casService.getPublicStatus() : { enabled: false },
      });
    } catch (error) {
      next(error);
    }
  });

  // CAS routes exist only when CAS is configured, so an unconfigured server
  // behaves exactly as before (these paths fall through to the SPA).
  if (casService) {
    router.get('/cas/login', (req, res) => {
      res.cookie(CAS_RETURN_PATH_COOKIE, normalizeCasReturnPath(req.query.returnTo), {
        ...casService.getCallbackCookieOptions(),
        httpOnly: true,
        sameSite: 'lax',
        maxAge: CAS_RETURN_PATH_MAX_AGE_MS,
      });
      res.redirect(302, casService.getLoginUrl());
    });

    router.get('/cas/callback', async (req, res, next) => {
      try {
        const returnPath = normalizeCasReturnPath(readCookie(req.headers.cookie, CAS_RETURN_PATH_COOKIE));
        res.clearCookie(CAS_RETURN_PATH_COOKIE, casService.getCallbackCookieOptions());
        const result = await casService.completeLogin(req.query.ticket);
        // A fragment never reaches server logs or Referer headers; the SPA
        // reads it once and removes it from the address bar.
        const fragment = 'code' in result ? `cas_code=${result.code}` : `cas_error=${result.error}`;
        res.setHeader('Cache-Control', 'no-store');
        res.redirect(302, `${returnPath}#${fragment}`);
      } catch (error) {
        next(error);
      }
    });

    router.post('/cas/exchange', (req, res, next) => {
      try {
        const body = req.body as { code?: unknown } | undefined;
        res.json(casService.exchangeCode(body?.code));
      } catch (error) {
        next(error);
      }
    });
  }

  router.post('/register', async (req, res, next) => {
    try {
      const body = req.body as { username?: unknown; password?: unknown };
      res.json(await service.register(body.username, body.password));
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', async (req, res, next) => {
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
