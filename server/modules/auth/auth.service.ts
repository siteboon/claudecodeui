import type Database from 'better-sqlite3';

import { AppError } from '@/shared/utils.js';

import {
  clearTotpFailures,
  ensureTotpSchema,
  isTotpRateLimited,
  recordTotpFailure,
  verifyTotpOrConsumeBackupCode,
} from './totp.js';

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

/**
 * Coerces a numeric or bigint user identifier into a standard number.
 */
function numericUserId(userId: number | bigint): number {
  return Number(userId);
}

/**
 * Checks whether a database error represents a SQLite UNIQUE constraint violation.
 */
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
 * transaction, token, and opt-in RFC 6238 TOTP 2FA dependencies.
 */
export function createAuthService(dependencies: AuthDependencies) {
  const db = dependencies.db;
  ensureTotpSchema(db);

  return {
    /**
     * Returns whether initial setup is needed and whether TOTP 2FA is active.
     */
    getStatus() {
      ensureTotpSchema(db);
      let totpEnabled = false;
      try {
        const firstUser = db
          ?.prepare('SELECT id, username, totp_enabled FROM users WHERE is_active = 1 LIMIT 1')
          .get() as { id: number; username: string; totp_enabled?: number } | undefined;
        totpEnabled = Boolean(firstUser?.totp_enabled);
      } catch {
        totpEnabled = false;
      }

      return {
        needsSetup: !dependencies.users.hasUsers(),
        isAuthenticated: false,
        totpEnabled,
      };
    },

    /**
     * Registers the initial single-user account.
     */
    async register(usernameInput: unknown, passwordInput: unknown) {
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

        return {
          success: true,
          user: { id: user.id, username: user.username, totpEnabled: false },
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

    /**
     * Authenticates a user by username, password, and optional TOTP/backup code.
     */
    async login(
      usernameInput: unknown,
      passwordInput: unknown,
      totpCodeInput: unknown = undefined,
      clientIp?: string,
    ) {
      const username = typeof usernameInput === 'string' ? usernameInput.trim() : '';
      const password = typeof passwordInput === 'string' ? passwordInput : '';
      const totpCode = typeof totpCodeInput === 'string' ? totpCodeInput.trim() : '';
      const ipKey = clientIp ? `ip:${clientIp}` : undefined;
      const userKey = username ? `user:${username.toLowerCase()}` : undefined;

      if (isTotpRateLimited(ipKey, userKey)) {
        throw new AppError(
          'Too many failed authentication attempts. Please wait 5 minutes before trying again.',
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
        recordTotpFailure(ipKey, userKey);
        throw new AppError('Invalid username or password', {
          code: 'AUTH_INVALID_CREDENTIALS',
          statusCode: 401,
        });
      }

      ensureTotpSchema(db);
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
          throw new AppError('Two-factor authentication (TOTP) 6-digit code is required.', {
            code: 'AUTH_TOTP_REQUIRED',
            statusCode: 401,
            details: { totpRequired: true },
          });
        }

        const verification = verifyTotpOrConsumeBackupCode(
          db,
          numericUserId(user.id),
          secRow.totp_secret,
          secRow.totp_backup_codes,
          totpCode,
        );

        if (!verification.valid) {
          recordTotpFailure(ipKey, userKey);
          throw new AppError('Invalid TOTP 6-digit code or backup recovery code.', {
            code: 'AUTH_TOTP_INVALID',
            statusCode: 401,
            details: { totpRequired: true },
          });
        }
      }

      clearTotpFailures(ipKey, userKey);
      dependencies.users.updateLastLogin(numericUserId(user.id));
      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          totpEnabled: Boolean(secRow?.totp_enabled),
        },
        token: dependencies.generateToken(user),
      };
    },

    /**
     * Returns the currently authenticated user's profile and TOTP status.
     */
    getCurrentUser(user: unknown) {
      if (user && typeof user === 'object' && 'id' in user && db) {
        ensureTotpSchema(db);
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

    /**
     * Issues a replacement JWT token for an authenticated user.
     */
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

    /**
     * Completes client-initiated logout.
     */
    logout() {
      return { success: true, message: 'Logged out successfully' };
    },
  };
}
