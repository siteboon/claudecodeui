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

const authService = createAuthService({
  users: {
    hasUsers: () => userDb.hasUsers(),
    createUser: (username, passwordHash) => userDb.createUser(username, passwordHash),
    getUserByUsername: (username) => userDb.getUserByUsername(username),
    updateLastLogin: (userId) => userDb.updateLastLogin(userId),
  },
  transaction: {
    begin: () => databaseConnection.prepare('BEGIN').run(),
    commit: () => databaseConnection.prepare('COMMIT').run(),
    rollback: () => databaseConnection.prepare('ROLLBACK').run(),
  },
  hashPassword: (password) => bcrypt.hash(password, 12),
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
  ? createCasService({
    config: casSettings.config,
    users: {
      hasUsers: () => userDb.hasUsers(),
      getFirstUser: () => userDb.getFirstUser(),
      getUserById: (userId) => userDb.getUserById(userId),
      createUser: (username, passwordHash) => userDb.createUser(username, passwordHash),
      updateLastLogin: (userId) => userDb.updateLastLogin(userId),
    },
    transaction: {
      begin: () => databaseConnection.prepare('BEGIN').run(),
      commit: () => databaseConnection.prepare('COMMIT').run(),
      rollback: () => databaseConnection.prepare('ROLLBACK').run(),
    },
    hashPassword: (password) => bcrypt.hash(password, 12),
    generateToken,
  })
  : null;
if (casSettings.config) {
  console.log(`[CAS] CAS sign-in enabled for ${casSettings.config.allowedUsers.size} allowed user(s)`);
}

/** Auth router assembled for the server entrypoint. */
export const authRoutes = createAuthRouter(authService, authenticateToken, casService);
