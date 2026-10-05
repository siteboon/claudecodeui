import { createRequire } from 'node:module';

import { getConnection, userDb } from '@/modules/database/index.js';
import { IS_PLATFORM } from '@/shared/utils.js';

import { authenticateToken, generateToken } from './auth.middleware.js';
import { createAuthRouter } from './auth.routes.js';
import { createAuthService } from './auth.service.js';
import { createCasService, readCasConfig } from './cas.service.js';

type BcryptAdapter = {
  hash(password: string, saltRounds: number): Promise<string>;
  compare(password: string, passwordHash: string): Promise<boolean>;
};

// bcrypt does not ship TypeScript declarations in this project, so the
// composition root narrows its CommonJS runtime surface before injecting it.
const require = createRequire(import.meta.url);
const bcrypt = require('bcrypt') as BcryptAdapter;
const databaseConnection = getConnection();

// Shared by the password and CAS services so both read, create and update
// accounts the same way and hash passwords with the same cost.
const users = {
  hasUsers: () => userDb.hasUsers(),
  getFirstUser: () => userDb.getFirstUser(),
  getUserById: (userId: number) => userDb.getUserById(userId),
  getUserByUsername: (username: string) => userDb.getUserByUsername(username),
  createUser: (username: string, passwordHash: string) => userDb.createUser(username, passwordHash),
  updateLastLogin: (userId: number) => userDb.updateLastLogin(userId),
};
const transaction = {
  begin: () => databaseConnection.prepare('BEGIN').run(),
  commit: () => databaseConnection.prepare('COMMIT').run(),
  rollback: () => databaseConnection.prepare('ROLLBACK').run(),
};
const hashPassword = (password: string) => bcrypt.hash(password, 12);

const authService = createAuthService({
  users,
  transaction,
  hashPassword,
  comparePassword: (password, passwordHash) => bcrypt.compare(password, passwordHash),
  generateToken,
});

// CAS single sign-on is opt-in: it stays off unless CAS_SERVER_URL,
// CAS_SERVICE_URL and CAS_ALLOWED_USERS are all set and valid.
const casSettings = readCasConfig(process.env, { isPlatform: IS_PLATFORM });
for (const warning of casSettings.warnings) {
  console.warn(warning);
}

const casService = casSettings.config
  ? createCasService({ config: casSettings.config, users, transaction, hashPassword, generateToken })
  : null;
if (casSettings.config) {
  console.log(`[CAS] CAS sign-in enabled for ${casSettings.config.allowedUsers.size} allowed user(s)`);
}

/** Auth router assembled for the server entrypoint. */
export const authRoutes = createAuthRouter(authService, authenticateToken, casService);
