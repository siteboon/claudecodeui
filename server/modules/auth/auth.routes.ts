import express from 'express';
import type { RequestHandler } from 'express';

import { getConnection } from '@/modules/database/index.js';

import type { createAuthService } from './auth.service.js';
import {
  buildOtpAuthUri,
  ensureSecuritySchema,
  extractRequestMeta,
  generateBackupCodes,
  generateQrCodeDataUrl,
  generateTotpSecret,
  getAuditLogs,
  getCurrentTotpCode,
  logAuditEvent,
  verifyTotpCode,
} from './security.js';

type AuthenticatedRequest = express.Request & {
  user?: { id: number | bigint; username: string };
};

/**
 * Creates the Auth transport adapter including TOTP 2FA and Security Audit routes.
 */
export function createAuthRouter(
  service: ReturnType<typeof createAuthService>,
  authenticateToken: RequestHandler,
): express.Router {
  const router = express.Router();
  const db = getConnection();
  ensureSecuritySchema(db);

  router.get('/status', (_req, res, next) => {
    try {
      res.json(service.getStatus());
    } catch (error) {
      next(error);
    }
  });

  router.post('/register', async (req, res, next) => {
    try {
      const body = req.body as { username?: unknown; password?: unknown };
      res.json(await service.register(body.username, body.password, extractRequestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const body = req.body as {
        username?: unknown;
        password?: unknown;
        totpCode?: unknown;
      };
      res.json(
        await service.login(
          body.username,
          body.password,
          body.totpCode,
          extractRequestMeta(req),
        ),
      );
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

  router.post('/logout', authenticateToken, (req, res) => {
    res.json(service.logout((req as AuthenticatedRequest).user, extractRequestMeta(req)));
  });

  router.get('/security/totp-status', authenticateToken, async (req, res, next) => {
    try {
      ensureSecuritySchema(db);
      const authUser = (req as AuthenticatedRequest).user;
      if (!authUser) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      let row = db
        .prepare(
          'SELECT id, username, totp_secret, totp_enabled, totp_backup_codes FROM users WHERE id = ?',
        )
        .get(Number(authUser.id)) as
        | {
            id: number;
            username: string;
            totp_secret: string | null;
            totp_enabled: number;
            totp_backup_codes: string | null;
          }
        | undefined;

      if (!row) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!row.totp_secret) {
        const secret = generateTotpSecret(20);
        const backupCodes = generateBackupCodes(6);
        db.prepare(
          'UPDATE users SET totp_secret = ?, totp_backup_codes = ? WHERE id = ?',
        ).run(secret, JSON.stringify(backupCodes), row.id);
        row = db
          .prepare(
            'SELECT id, username, totp_secret, totp_enabled, totp_backup_codes FROM users WHERE id = ?',
          )
          .get(Number(authUser.id)) as typeof row;
      }

      if (!row || !row.totp_secret) {
        return res.status(500).json({ error: 'Failed to initialize TOTP secret' });
      }

      const otpauthUri = buildOtpAuthUri(row.username, row.totp_secret, 'CloudCLI');
      const qrCodeDataUrl = await generateQrCodeDataUrl(otpauthUri);
      let backupCodes: string[] = [];
      try {
        backupCodes = row.totp_backup_codes ? (JSON.parse(row.totp_backup_codes) as string[]) : [];
      } catch {
        backupCodes = [];
      }

      return res.json({
        username: row.username,
        totpEnabled: Boolean(row.totp_enabled),
        secret: row.totp_secret,
        otpauthUri,
        qrCodeDataUrl,
        backupCodes,
        currentServerTime: new Date().toISOString(),
        currentCodeHint: getCurrentTotpCode(row.totp_secret),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/security/totp-setup', authenticateToken, async (req, res, next) => {
    try {
      ensureSecuritySchema(db);
      const authUser = (req as AuthenticatedRequest).user;
      if (!authUser) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const secret = generateTotpSecret(20);
      const backupCodes = generateBackupCodes(6);
      db.prepare(
        'UPDATE users SET totp_secret = ?, totp_backup_codes = ?, totp_enabled = 0 WHERE id = ?',
      ).run(secret, JSON.stringify(backupCodes), Number(authUser.id));

      const otpauthUri = buildOtpAuthUri(authUser.username, secret, 'CloudCLI');
      const qrCodeDataUrl = await generateQrCodeDataUrl(otpauthUri);

      logAuditEvent(db, {
        eventType: 'AUTH_TOTP_SECRET_ROTATED',
        severity: 'WARN',
        username: authUser.username,
        userId: authUser.id,
        ...extractRequestMeta(req),
        statusCode: 200,
        details: { message: 'TOTP secret and backup recovery codes regenerated' },
      });

      return res.json({
        success: true,
        totpEnabled: false,
        secret,
        otpauthUri,
        qrCodeDataUrl,
        backupCodes,
        currentCodeHint: getCurrentTotpCode(secret),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/security/totp-toggle', authenticateToken, (req, res, next) => {
    try {
      ensureSecuritySchema(db);
      const authUser = (req as AuthenticatedRequest).user;
      if (!authUser) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { enabled, code } = (req.body || {}) as {
        enabled?: boolean;
        code?: string;
      };
      const row = db
        .prepare('SELECT id, username, totp_secret, totp_enabled FROM users WHERE id = ?')
        .get(Number(authUser.id)) as
        | { id: number; username: string; totp_secret: string | null; totp_enabled: number }
        | undefined;

      if (!row || !row.totp_secret) {
        return res.status(400).json({ error: 'TOTP secret not initialized' });
      }

      if (enabled) {
        if (!code || !verifyTotpCode(row.totp_secret, code, 1)) {
          logAuditEvent(db, {
            eventType: 'AUTH_TOTP_ENABLE_FAILED',
            severity: 'WARN',
            username: row.username,
            userId: row.id,
            ...extractRequestMeta(req),
            statusCode: 400,
            details: { reason: 'Invalid 6-digit verification code during TOTP activation' },
          });
          return res.status(400).json({
            error: 'Invalid 6-digit TOTP code. Please enter the current code from your authenticator app.',
          });
        }

        db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(row.id);
        logAuditEvent(db, {
          eventType: 'AUTH_TOTP_ENABLED',
          severity: 'INFO',
          username: row.username,
          userId: row.id,
          ...extractRequestMeta(req),
          statusCode: 200,
          details: { message: 'TOTP 2FA enforcement enabled for account' },
        });
        return res.json({ success: true, totpEnabled: true });
      }

      db.prepare('UPDATE users SET totp_enabled = 0 WHERE id = ?').run(row.id);
      logAuditEvent(db, {
        eventType: 'AUTH_TOTP_DISABLED',
        severity: 'WARN',
        username: row.username,
        userId: row.id,
        ...extractRequestMeta(req),
        statusCode: 200,
        details: { message: 'TOTP 2FA enforcement disabled for account' },
      });
      return res.json({ success: true, totpEnabled: false });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/security/audit-logs', authenticateToken, (req, res, next) => {
    try {
      const limit = (req.query.limit as string | undefined) || 100;
      const eventType = (req.query.eventType as string | undefined) || null;
      const severity = (req.query.severity as string | undefined) || null;
      res.json(getAuditLogs(db, { limit, eventType, severity }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
