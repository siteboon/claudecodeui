import express from 'express';
import type { RequestHandler } from 'express';

import { getConnection } from '@/modules/database/index.js';

import type { createAuthService } from './auth.service.js';
import {
  buildOtpAuthUri,
  clearTotpFailures,
  ensureTotpSchema,
  generateBackupCodes,
  generateQrCodeDataUrl,
  generateTotpSecret,
  isTotpRateLimited,
  recordTotpFailure,
  verifyTotpCode,
  verifyTotpOrConsumeBackupCode,
} from './totp.js';

type AuthenticatedRequest = express.Request & {
  user?: { id: number | bigint; username: string };
};

type UserTotpRow = {
  id: number;
  username: string;
  totp_secret: string | null;
  totp_enabled: number;
  totp_backup_codes: string | null;
  totp_pending_secret: string | null;
  totp_pending_backup_codes: string | null;
};

/**
 * Resolves the client IP address from Express's `req.ip` or socket remote address.
 */
function resolveClientIp(req: express.Request): string {
  const raw = req.ip || req.socket?.remoteAddress || 'unknown';
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

/**
 * Parses a JSON array of backup codes safely.
 */
function parseBackupCodes(rawJson: string | null | undefined): string[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Creates the Auth transport adapter including opt-in TOTP 2FA management routes.
 */
export function createAuthRouter(
  service: ReturnType<typeof createAuthService>,
  authenticateToken: RequestHandler,
): express.Router {
  const router = express.Router();
  const db = getConnection();
  ensureTotpSchema(db);

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
      res.json(await service.register(body.username, body.password));
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
          resolveClientIp(req),
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

  router.post('/logout', authenticateToken, (_req, res) => {
    res.json(service.logout());
  });

  router.get('/security/totp-status', authenticateToken, async (req, res, next) => {
    try {
      ensureTotpSchema(db);
      const authUser = (req as AuthenticatedRequest).user;
      if (!authUser) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      let row = db
        .prepare(
          `SELECT id, username, totp_secret, totp_enabled, totp_backup_codes,
                  totp_pending_secret, totp_pending_backup_codes
           FROM users WHERE id = ?`,
        )
        .get(Number(authUser.id)) as UserTotpRow | undefined;

      if (!row) {
        return res.status(404).json({ error: 'User not found' });
      }

      const totpEnabled = Boolean(row.totp_enabled);

      // When 2FA is already enabled and no pending rotation is in progress,
      // do not expose the active secret, QR code, or backup codes.
      if (totpEnabled && !row.totp_pending_secret) {
        return res.json({
          username: row.username,
          totpEnabled: true,
          hasPendingSetup: false,
          secret: null,
          otpauthUri: null,
          qrCodeDataUrl: null,
          backupCodes: [],
        });
      }

      // Initialize pending enrollment secret when 2FA is disabled and none exists yet
      if (!totpEnabled && !row.totp_pending_secret) {
        const pendingSecret = generateTotpSecret(20);
        const pendingBackups = generateBackupCodes(6);
        db.prepare(
          'UPDATE users SET totp_pending_secret = ?, totp_pending_backup_codes = ? WHERE id = ?',
        ).run(pendingSecret, JSON.stringify(pendingBackups), row.id);
        row = db
          .prepare(
            `SELECT id, username, totp_secret, totp_enabled, totp_backup_codes,
                    totp_pending_secret, totp_pending_backup_codes
             FROM users WHERE id = ?`,
          )
          .get(Number(authUser.id)) as UserTotpRow | undefined;
      }

      const enrollmentSecret = row?.totp_pending_secret || null;
      if (!row || !enrollmentSecret) {
        return res.status(500).json({ error: 'Failed to initialize pending TOTP secret' });
      }

      const otpauthUri = buildOtpAuthUri(row.username, enrollmentSecret, 'CloudCLI');
      const qrCodeDataUrl = await generateQrCodeDataUrl(otpauthUri);
      const backupCodes = parseBackupCodes(row.totp_pending_backup_codes);

      return res.json({
        username: row.username,
        totpEnabled,
        hasPendingSetup: true,
        secret: enrollmentSecret,
        otpauthUri,
        qrCodeDataUrl,
        backupCodes,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/security/totp-setup', authenticateToken, async (req, res, next) => {
    try {
      ensureTotpSchema(db);
      const authUser = (req as AuthenticatedRequest).user;
      if (!authUser) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const ipKey = `ip:${resolveClientIp(req)}`;
      const userKey = `user:${authUser.username.toLowerCase()}`;
      if (isTotpRateLimited(ipKey, userKey)) {
        return res.status(429).json({
          error: 'Too many failed verification attempts. Please wait 5 minutes.',
        });
      }

      const row = db
        .prepare(
          'SELECT id, username, totp_secret, totp_enabled, totp_backup_codes FROM users WHERE id = ?',
        )
        .get(Number(authUser.id)) as UserTotpRow | undefined;

      if (!row) {
        return res.status(404).json({ error: 'User not found' });
      }

      // If 2FA is currently active, require a valid current TOTP or backup code before issuing a pending replacement
      if (row.totp_enabled && row.totp_secret) {
        const { code } = (req.body || {}) as { code?: string };
        const verification = verifyTotpOrConsumeBackupCode(
          db,
          row.id,
          row.totp_secret,
          row.totp_backup_codes,
          code || '',
        );
        if (!verification.valid) {
          recordTotpFailure(ipKey, userKey);
          return res.status(400).json({
            error:
              'Current 6-digit TOTP code or backup recovery code is required to rotate an active 2FA secret.',
          });
        }
        clearTotpFailures(ipKey, userKey);
      }

      const pendingSecret = generateTotpSecret(20);
      const pendingBackupCodes = generateBackupCodes(6);
      db.prepare(
        'UPDATE users SET totp_pending_secret = ?, totp_pending_backup_codes = ? WHERE id = ?',
      ).run(pendingSecret, JSON.stringify(pendingBackupCodes), row.id);

      const otpauthUri = buildOtpAuthUri(row.username, pendingSecret, 'CloudCLI');
      const qrCodeDataUrl = await generateQrCodeDataUrl(otpauthUri);

      return res.json({
        success: true,
        totpEnabled: Boolean(row.totp_enabled),
        hasPendingSetup: true,
        secret: pendingSecret,
        otpauthUri,
        qrCodeDataUrl,
        backupCodes: pendingBackupCodes,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/security/totp-toggle', authenticateToken, (req, res, next) => {
    try {
      ensureTotpSchema(db);
      const authUser = (req as AuthenticatedRequest).user;
      if (!authUser) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const ipKey = `ip:${resolveClientIp(req)}`;
      const userKey = `user:${authUser.username.toLowerCase()}`;
      if (isTotpRateLimited(ipKey, userKey)) {
        return res.status(429).json({
          error: 'Too many failed verification attempts. Please wait 5 minutes.',
        });
      }

      const { enabled, code } = (req.body || {}) as {
        enabled?: boolean;
        code?: string;
      };
      const row = db
        .prepare(
          `SELECT id, username, totp_secret, totp_enabled, totp_backup_codes,
                  totp_pending_secret, totp_pending_backup_codes
           FROM users WHERE id = ?`,
        )
        .get(Number(authUser.id)) as UserTotpRow | undefined;

      if (!row) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (enabled) {
        const candidateSecret = row.totp_pending_secret || row.totp_secret;
        const candidateBackups = row.totp_pending_backup_codes || row.totp_backup_codes;
        if (!candidateSecret) {
          return res.status(400).json({ error: 'TOTP secret not initialized' });
        }

        if (!code || !verifyTotpCode(candidateSecret, code, 1)) {
          recordTotpFailure(ipKey, userKey);
          return res.status(400).json({
            error:
              'Invalid 6-digit TOTP code. Please enter the current code from your authenticator app.',
          });
        }

        clearTotpFailures(ipKey, userKey);
        db.prepare(
          `UPDATE users
           SET totp_secret = ?,
               totp_backup_codes = ?,
               totp_enabled = 1,
               totp_pending_secret = NULL,
               totp_pending_backup_codes = NULL
           WHERE id = ?`,
        ).run(candidateSecret, candidateBackups, row.id);

        return res.json({ success: true, totpEnabled: true });
      }

      // Disabling active 2FA requires verifying a valid current TOTP or backup code
      if (row.totp_enabled && row.totp_secret) {
        const verification = verifyTotpOrConsumeBackupCode(
          db,
          row.id,
          row.totp_secret,
          row.totp_backup_codes,
          code || '',
        );
        if (!verification.valid) {
          recordTotpFailure(ipKey, userKey);
          return res.status(400).json({
            error:
              'Current 6-digit TOTP code or backup recovery code is required to disable 2FA.',
          });
        }
        clearTotpFailures(ipKey, userKey);
      }

      db.prepare(
        `UPDATE users
         SET totp_enabled = 0,
             totp_pending_secret = NULL,
             totp_pending_backup_codes = NULL
         WHERE id = ?`,
      ).run(row.id);

      return res.json({ success: true, totpEnabled: false });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
