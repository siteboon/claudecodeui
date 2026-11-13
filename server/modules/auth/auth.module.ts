import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import { appConfigDb, getConnection, userDb } from '@/modules/database/index.js';

import {
  AUTH_TOKEN_GENERATION_KEY,
  authenticateToken,
  generateToken,
} from './auth.middleware.js';
import { createAuthRouter } from './auth.routes.js';
import { createAuthService } from './auth.service.js';

type BcryptAdapter = {
  hash(password: string, saltRounds: number): Promise<string>;
  compare(password: string, passwordHash: string): Promise<boolean>;
};

// bcrypt does not ship TypeScript declarations in this project, so the
// composition root narrows its CommonJS runtime surface before injecting it.
const require = createRequire(import.meta.url);
const bcrypt = require('bcrypt') as BcryptAdapter;
const databaseConnection = getConnection();

const authService = createAuthService({
  users: {
    hasUsers: () => userDb.hasUsers(),
    createUser: (username, passwordHash) => userDb.createUser(username, passwordHash),
    getUserByUsername: (username) => userDb.getUserByUsername(username),
    getUserAuthById: (userId) => userDb.getUserAuthById(userId),
    updatePasswordHash: (userId, passwordHash) => userDb.updatePasswordHash(userId, passwordHash),
    updateLastLogin: (userId) => userDb.updateLastLogin(userId),
  },
  authConfig: {
    setTokenGeneration: (value) => appConfigDb.set(AUTH_TOKEN_GENERATION_KEY, value),
  },
  transaction: {
    begin: () => databaseConnection.prepare('BEGIN').run(),
    commit: () => databaseConnection.prepare('COMMIT').run(),
    rollback: () => databaseConnection.prepare('ROLLBACK').run(),
  },
  isPlatform: process.env.VITE_IS_PLATFORM === 'true',
  createTokenGeneration: randomUUID,
  hashPassword: (password) => bcrypt.hash(password, 12),
  comparePassword: (password, passwordHash) => bcrypt.compare(password, passwordHash),
  generateToken,
});

/** Auth router assembled for the server entrypoint. */
export const authRoutes = createAuthRouter(authService, authenticateToken);
