import type Database from 'better-sqlite3';

import { AppError } from '@/shared/utils.js';

import {
  ensureSecuritySchema,
  isIpBruteForceBlocked,
  logAuditEvent,
  verifyTotpCode,
  type RequestSecurityMeta,
} from './security.js';

type AuthUser = {
  id: number | bigint;
  username: string;
};

type AuthLoginUser = AuthUser & { password_hash: string };

type AuthDependencies = {
  db?: Database.Database;
  users: {
    hasUsers(): boolean;
    createUser(username: string, passwordHash: string): AuthUser;
    getUserByUsername(username: string): AuthLoginUser | undefined;
    updateLastLogin(userId: number): void;
  };
  transaction: {
    begin(): void;
    commit(): void;
    rollback(): void;
  };
  hashPassword(password: string): Promise<string>;
  comparePassword(password: string, passwordHash: string): Promise<boolean>;
  generateToken(user: AuthUser): string;
};

function numericUserId(userId: number | bigint): number {
  return Number(userId);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

/**
 * Creates the Auth application service around explicit persistence, crypto,
 * transaction, token, TOTP 2FA, and security audit logging dependencies.
 */
export function createAuthService(dependencies: AuthDependencies) {
  const db = dependencies.db;
  ensureSecuritySchema(db);

  return {
    getStatus() {
      ensureSecuritySchema(db);
      const firstUser = db
        ?.prepare('SELECT id, username, totp_enabled FROM users WHERE is_active = 1 LIMIT 1')
        .get() as { id: number; username: string; totp_enabled?: number } | undefined;

      return {
        needsSetup: !dependencies.users.hasUsers(),
        isAuthenticated: false,
        totpEnabled: Boolean(firstUser?.totp_enabled),
      };
    },

    async register(
      usernameInput: unknown,
      passwordInput: unknown,
      reqMeta: RequestSecurityMeta = {},
    ) {
      const username = typeof usernameInput === 'string' ? usernameInput : '';
      const password = typeof passwordInput === 'string' ? passwordInput : '';

      if (!username || !password) {
        throw new AppError('Username and password are required', {
          code: 'AUTH_CREDENTIALS_REQUIRED',
          statusCode: 400,
        });
      }
      if (username.length < 3 || password.length < 6) {
        throw new AppError(
          'Username must be at least 3 characters, password at least 6 characters',
          { code: 'AUTH_CREDENTIALS_TOO_SHORT', statusCode: 400 },
        );
      }

      dependencies.transaction.begin();
      try {
        if (dependencies.users.hasUsers()) {
          throw new AppError('User already exists. This is a single-user system.', {
            code: 'AUTH_USER_ALREADY_CONFIGURED',
            statusCode: 403,
          });
        }

        const passwordHash = await dependencies.hashPassword(password);
        const user = dependencies.users.createUser(username, passwordHash);
        const token = dependencies.generateToken(user);
        dependencies.transaction.commit();
        dependencies.users.updateLastLogin(numericUserId(user.id));

        logAuditEvent(db, {
          eventType: 'AUTH_REGISTER_SUCCESS',
          severity: 'INFO',
          username: user.username,
          userId: user.id,
          ...reqMeta,
          statusCode: 200,
          details: { message: 'Initial admin account registered' },
        });

        return {
          success: true,
          user: { id: user.id, username: user.username },
          token,
        };
      } catch (error) {
        dependencies.transaction.rollback();
        if (isUniqueConstraintError(error)) {
          throw new AppError('Username already exists', {
            code: 'AUTH_USERNAME_CONFLICT',
            statusCode: 409,
          });
        }
        throw error;
      }
    },

    async login(
      usernameInput: unknown,
      passwordInput: unknown,
      totpCodeInput: unknown = undefined,
      reqMeta: RequestSecurityMeta = {},
    ) {
      const username = typeof usernameInput === 'string' ? usernameInput.trim() : '';
      const password = typeof passwordInput === 'string' ? passwordInput : '';
      const totpCode = typeof totpCodeInput === 'string' ? totpCodeInput.trim() : '';

      if (isIpBruteForceBlocked(db, reqMeta.ip)) {
        logAuditEvent(db, {
          eventType: 'AUTH_BRUTEFORCE_BLOCKED',
          severity: 'CRITICAL',
          username: username || 'unknown',
          ...reqMeta,
          statusCode: 429,
          details: { reason: 'Too many failed authentication attempts within 5 minutes' },
        });
        throw new AppError(
          'Too many failed login attempts. Please wait 5 minutes before trying again.',
          {
            code: 'AUTH_RATE_LIMITED',
            statusCode: 429,
          },
        );
      }

      if (!username || !password) {
        throw new AppError('Username and password are required', {
          code: 'AUTH_CREDENTIALS_REQUIRED',
          statusCode: 400,
        });
      }

      const user = dependencies.users.getUserByUsername(username);
      const validPassword = user
        ? await dependencies.comparePassword(password, user.password_hash)
        : false;

      if (!user || !validPassword) {
        logAuditEvent(db, {
          eventType: 'AUTH_LOGIN_FAILED',
          severity: 'WARN',
          username,
          userId: user?.id ?? null,
          ...reqMeta,
          statusCode: 401,
          details: {
            reason: !user ? 'Non-existent username' : 'Password mismatch',
          },
        });
        throw new AppError('Invalid username or password', {
          code: 'AUTH_INVALID_CREDENTIALS',
          statusCode: 401,
        });
      }

      const secRow = db
        ?.prepare('SELECT totp_secret, totp_enabled, totp_backup_codes FROM users WHERE id = ?')
        .get(numericUserId(user.id)) as
        | {
            totp_secret?: string | null;
            totp_enabled?: number;
            totp_backup_codes?: string | null;
          }
        | undefined;

      if (secRow?.totp_enabled && secRow.totp_secret) {
        if (!totpCode) {
          logAuditEvent(db, {
            eventType: 'AUTH_TOTP_REQUIRED',
            severity: 'WARN',
            username: user.username,
            userId: user.id,
            ...reqMeta,
            statusCode: 401,
            details: { reason: 'Password verified, awaiting 6-digit TOTP 2FA code' },
          });
          throw new AppError('Two-factor authentication (TOTP) 6-digit code is required.', {
            code: 'AUTH_TOTP_REQUIRED',
            statusCode: 401,
            details: { totpRequired: true },
          });
        }

        let totpValid = verifyTotpCode(secRow.totp_secret, totpCode, 1);
        let usedBackupCode = false;

        if (!totpValid && secRow.totp_backup_codes && db) {
          try {
            const backups = JSON.parse(secRow.totp_backup_codes) as unknown;
            const normalizedInput = totpCode.toUpperCase().replace(/\s/g, '');
            if (Array.isArray(backups)) {
              const idx = backups.findIndex(
                (c) => String(c).toUpperCase() === normalizedInput,
              );
              if (idx !== -1) {
                totpValid = true;
                usedBackupCode = true;
                backups.splice(idx, 1);
                db.prepare('UPDATE users SET totp_backup_codes = ? WHERE id = ?').run(
                  JSON.stringify(backups),
                  numericUserId(user.id),
                );
              }
            }
          } catch {
            // Ignore malformed backup code JSON
          }
        }

        if (!totpValid) {
          logAuditEvent(db, {
            eventType: 'AUTH_TOTP_FAILED',
            severity: 'WARN',
            username: user.username,
            userId: user.id,
            ...reqMeta,
            statusCode: 401,
            details: { reason: 'Invalid 6-digit TOTP or backup recovery code' },
          });
          throw new AppError('Invalid TOTP 6-digit code or backup recovery code.', {
            code: 'AUTH_TOTP_INVALID',
            statusCode: 401,
            details: { totpRequired: true },
          });
        }

        logAuditEvent(db, {
          eventType: 'AUTH_TOTP_VERIFIED',
          severity: 'INFO',
          username: user.username,
          userId: user.id,
          ...reqMeta,
          statusCode: 200,
          details: { method: usedBackupCode ? 'backup-code' : 'rfc6238-totp' },
        });
      }

      dependencies.users.updateLastLogin(numericUserId(user.id));
      const token = dependencies.generateToken(user);

      logAuditEvent(db, {
        eventType: 'AUTH_LOGIN_SUCCESS',
        severity: 'INFO',
        username: user.username,
        userId: user.id,
        ...reqMeta,
        statusCode: 200,
        details: {
          totpVerified: Boolean(secRow?.totp_enabled),
        },
      });

      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          totpEnabled: Boolean(secRow?.totp_enabled),
        },
        token,
      };
    },

    getCurrentUser(user: unknown) {
      if (user && typeof user === 'object' && 'id' in user && db) {
        const secRow = db
          .prepare('SELECT totp_enabled FROM users WHERE id = ?')
          .get(numericUserId((user as AuthUser).id)) as { totp_enabled?: number } | undefined;
        return {
          user: {
            ...(user as Record<string, unknown>),
            totpEnabled: Boolean(secRow?.totp_enabled),
          },
        };
      }
      return { user };
    },

    refreshSession(user: unknown) {
      if (
        typeof user !== 'object' ||
        user === null ||
        !('id' in user) ||
        !('username' in user) ||
        (typeof user.id !== 'number' && typeof user.id !== 'bigint') ||
        typeof user.username !== 'string'
      ) {
        throw new AppError('Authenticated user is required', {
          code: 'AUTH_USER_REQUIRED',
          statusCode: 401,
        });
      }

      return { token: dependencies.generateToken(user as AuthUser) };
    },

    logout(user: unknown = null, reqMeta: RequestSecurityMeta = {}) {
      const authUser =
        user && typeof user === 'object' && 'username' in user
          ? (user as { id?: number | bigint; username?: string })
          : null;

      logAuditEvent(db, {
        eventType: 'AUTH_LOGOUT',
        severity: 'INFO',
        username: authUser?.username || null,
        userId: authUser?.id || null,
        ...reqMeta,
        statusCode: 200,
        details: { message: 'User logged out' },
      });
      return { success: true, message: 'Logged out successfully' };
    },
  };
}
