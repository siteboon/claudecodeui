import { AppError } from '@/shared/utils.js';

type AuthUser = {
  id: number | bigint;
  username: string;
};

type AuthLoginUser = AuthUser & { password_hash: string };

type AuthDependencies = {
  users: {
    hasUsers(): boolean;
    createUser(username: string, passwordHash: string): AuthUser;
    getUserByUsername(username: string): AuthLoginUser | undefined;
    getUserAuthById(userId: number): AuthLoginUser | undefined;
    updatePasswordHash(userId: number, passwordHash: string): void;
    updateLastLogin(userId: number): void;
  };
  authConfig: {
    setTokenGeneration(value: string): void;
  };
  transaction: {
    begin(): void;
    commit(): void;
    rollback(): void;
  };
  isPlatform: boolean;
  createTokenGeneration(): string;
  hashPassword(password: string): Promise<string>;
  comparePassword(password: string, passwordHash: string): Promise<boolean>;
  generateToken(user: AuthUser): string;
};

function numericUserId(userId: number | bigint): number {
  return Number(userId);
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

/**
 * Creates the Auth application service around explicit persistence, crypto,
 * transaction, and token dependencies.
 */
export function createAuthService(dependencies: AuthDependencies) {
  return {
    getStatus() {
      return {
        needsSetup: !dependencies.users.hasUsers(),
        isAuthenticated: false,
      };
    },

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

      const passwordHash = await dependencies.hashPassword(password);
      dependencies.transaction.begin();
      try {
        if (dependencies.users.hasUsers()) {
          throw new AppError('User already exists. This is a single-user system.', {
            code: 'AUTH_USER_ALREADY_CONFIGURED',
            statusCode: 403,
          });
        }

        const user = dependencies.users.createUser(username, passwordHash);
        const token = dependencies.generateToken(user);
        dependencies.transaction.commit();
        dependencies.users.updateLastLogin(numericUserId(user.id));

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

    async login(usernameInput: unknown, passwordInput: unknown) {
      const username = typeof usernameInput === 'string' ? usernameInput : '';
      const password = typeof passwordInput === 'string' ? passwordInput : '';
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
        throw new AppError('Invalid username or password', {
          code: 'AUTH_INVALID_CREDENTIALS',
          statusCode: 401,
        });
      }

      dependencies.users.updateLastLogin(numericUserId(user.id));
      return {
        success: true,
        user: { id: user.id, username: user.username },
        token: dependencies.generateToken(user),
      };
    },

    getCurrentUser(user: unknown) {
      return { user };
    },

    async changePassword(userInput: unknown, currentPasswordInput: unknown, newPasswordInput: unknown) {
      if (dependencies.isPlatform) {
        throw new AppError('Password changes are not available in platform mode', {
          code: 'AUTH_PASSWORD_CHANGE_UNAVAILABLE',
          statusCode: 403,
        });
      }

      const currentPassword = typeof currentPasswordInput === 'string' ? currentPasswordInput : '';
      const newPassword = typeof newPasswordInput === 'string' ? newPasswordInput : '';
      if (!currentPassword || !newPassword) {
        throw new AppError('Current password and new password are required', {
          code: 'AUTH_PASSWORDS_REQUIRED',
          statusCode: 400,
        });
      }
      if (newPassword.length < 6) {
        throw new AppError('New password must be at least 6 characters', {
          code: 'AUTH_PASSWORD_TOO_SHORT',
          statusCode: 400,
        });
      }
      if (
        typeof userInput !== 'object'
        || userInput === null
        || !('id' in userInput)
        || (typeof userInput.id !== 'number' && typeof userInput.id !== 'bigint')
      ) {
        throw new AppError('Authenticated user is required', {
          code: 'AUTH_USER_REQUIRED',
          statusCode: 401,
        });
      }

      const user = dependencies.users.getUserAuthById(numericUserId(userInput.id));
      if (!user) {
        throw new AppError('Invalid token. User not found.', {
          code: 'AUTH_TOKEN_INVALID',
          statusCode: 401,
        });
      }
      if (!(await dependencies.comparePassword(currentPassword, user.password_hash))) {
        throw new AppError('Current password is incorrect', {
          code: 'AUTH_CURRENT_PASSWORD_INCORRECT',
          statusCode: 401,
        });
      }

      const passwordHash = await dependencies.hashPassword(newPassword);
      const nextTokenGeneration = dependencies.createTokenGeneration();
      dependencies.transaction.begin();
      try {
        dependencies.users.updatePasswordHash(numericUserId(user.id), passwordHash);
        dependencies.authConfig.setTokenGeneration(nextTokenGeneration);
        dependencies.transaction.commit();
      } catch (error) {
        dependencies.transaction.rollback();
        throw error;
      }

      return { success: true, message: 'Password updated. Please sign in again.' };
    },

    refreshSession(user: unknown) {
      if (
        typeof user !== 'object'
        || user === null
        || !('id' in user)
        || !('username' in user)
        || (typeof user.id !== 'number' && typeof user.id !== 'bigint')
        || typeof user.username !== 'string'
      ) {
        throw new AppError('Authenticated user is required', {
          code: 'AUTH_USER_REQUIRED',
          statusCode: 401,
        });
      }

      return { token: dependencies.generateToken(user as AuthUser) };
    },

    logout() {
      return { success: true, message: 'Logged out successfully' };
    },
  };
}
