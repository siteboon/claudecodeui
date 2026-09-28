import crypto from 'node:crypto';
import { createRequire } from 'node:module';

import { getConnection, userDb, userPreferencesDb } from '@/modules/database/index.js';

import { authenticateToken, generateToken } from './auth.middleware.js';
import { createAuthRouter } from './auth.routes.js';
import { createAuthService } from './auth.service.js';
import { autoProvisionAdminUser } from './auto-provision-admin.js';

type BcryptAdapter = {
  hash(password: string, saltRounds: number): Promise<string>;
  compare(password: string, passwordHash: string): Promise<boolean>;
};

// bcrypt does not ship TypeScript declarations in this project, so the
// composition root narrows its CommonJS runtime surface before injecting it.
const require = createRequire(import.meta.url);
const bcrypt = require('bcrypt') as BcryptAdapter;
const databaseConnection = getConnection();

// Lets a deployment (e.g. a sandbox kit with no one around to click through
// the settings dialog) default the one user this system will ever create to
// running Claude Code without permission prompts, instead of the client's
// historical skipPermissions: false.
const defaultUserPreferences = process.env.CLOUDCLI_DEFAULT_CLAUDE_SKIP_PERMISSIONS === 'true'
  ? { claudePermissions: { allowedTools: [], disallowedTools: [], skipPermissions: true } }
  : undefined;

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
  preferences: {
    savePreferences: (userId, updates) => userPreferencesDb.savePreferences(userId, updates),
  },
  defaultUserPreferences,
});

/** Auth router assembled for the server entrypoint. */
export const authRoutes = createAuthRouter(authService, authenticateToken);

/**
 * Called once at server boot. Only acts when CLOUDCLI_AUTO_CREATE_ADMIN is
 * set and no user exists yet — the sbx kit's disposable sandboxes turn this
 * on so a freshly created sandbox has a ready-to-use account instead of
 * requiring a human to complete the SetupForm before anyone can sign in.
 */
export async function autoProvisionAdminUserIfConfigured() {
  return autoProvisionAdminUser(
    {
      hasUsers: () => userDb.hasUsers(),
      register: (username, password) => authService.register(username, password),
      generatePassword: () => crypto.randomBytes(16).toString('hex'),
    },
    {
      enabled: process.env.CLOUDCLI_AUTO_CREATE_ADMIN === 'true',
      username: process.env.CLOUDCLI_ADMIN_USERNAME || 'admin',
      password: process.env.CLOUDCLI_ADMIN_PASSWORD || undefined,
    },
  );
}
