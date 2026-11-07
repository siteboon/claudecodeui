import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';
import type { RequestHandler } from 'express';

import { createAuthRouter } from '../auth.routes.js';
import { createAuthService } from '../auth.service.js';

type AuthDependencies = Parameters<typeof createAuthService>[0];

const USER_ID = 7;
const VALID_TOKEN = 'valid-token';

/**
 * Stands in for the JWT middleware: only VALID_TOKEN authenticates, and a
 * rejection carries the same status and header the real middleware sends, so
 * the route's dependence on it is exercised without signing real tokens.
 */
const fakeAuthenticateToken: RequestHandler = (req, res, next) => {
  if (req.headers.authorization !== `Bearer ${VALID_TOKEN}`) {
    res.setHeader('X-Auth-Error', 'invalid-token');
    res.status(401).json({ error: 'Access denied. No token provided.', code: 'AUTH_TOKEN_INVALID' });
    return;
  }
  (req as express.Request & { user?: unknown }).user = { id: USER_ID, username: 'alice' };
  next();
};

/** Serves the auth routes over a service whose password store is an in-memory map. */
async function withAuthServer(
  run: (baseUrl: string, hashes: Map<number, string>) => Promise<void>,
): Promise<void> {
  const hashes = new Map<number, string>([[USER_ID, 'hash(old-secret)']]);
  const unexpected = () => {
    throw new Error('Unexpected auth dependency call');
  };
  const dependencies: AuthDependencies = {
    users: {
      hasUsers: () => true,
      createUser: unexpected,
      getUserByUsername: unexpected,
      updateLastLogin: unexpected,
      getPasswordHashById: (userId) => hashes.get(userId),
      updatePasswordHash: (userId, passwordHash) => { hashes.set(userId, passwordHash); },
    },
    transaction: { begin: unexpected, commit: unexpected, rollback: unexpected },
    hashPassword: async (password) => `hash(${password})`,
    comparePassword: async (password, passwordHash) => passwordHash === `hash(${password})`,
    generateToken: unexpected,
  };

  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(createAuthService(dependencies), fakeAuthenticateToken));
  app.use((error: { statusCode?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.statusCode ?? 500).json({ success: false, error: { code: error.code } });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`, hashes);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

const changePassword = (baseUrl: string, body: unknown, token: string | null = VALID_TOKEN) => fetch(
  `${baseUrl}/api/auth/change-password`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  },
);

test('POST /change-password stores the new hash for the signed-in user', async () => {
  await withAuthServer(async (baseUrl, hashes) => {
    const response = await changePassword(baseUrl, { currentPassword: 'old-secret', newPassword: 'new-secret' });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.equal(hashes.get(USER_ID), 'hash(new-secret)');
  });
});

test('POST /change-password requires authentication and leaves the password alone', async () => {
  await withAuthServer(async (baseUrl, hashes) => {
    const response = await changePassword(
      baseUrl,
      { currentPassword: 'old-secret', newPassword: 'new-secret' },
      null,
    );

    assert.equal(response.status, 401);
    assert.equal(hashes.get(USER_ID), 'hash(old-secret)');
  });
});

test('POST /change-password answers a wrong current password with 400, not a session-ending 401', async () => {
  await withAuthServer(async (baseUrl, hashes) => {
    const response = await changePassword(baseUrl, { currentPassword: 'wrong', newPassword: 'new-secret' });

    // The client ends the session on a 401 carrying X-Auth-Error; a typo here must not sign the user out.
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('X-Auth-Error'), null);
    assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_INVALID_CURRENT_PASSWORD' } });
    assert.equal(hashes.get(USER_ID), 'hash(old-secret)');
  });
});

test('POST /change-password rejects non-string fields as missing credentials', async () => {
  await withAuthServer(async (baseUrl, hashes) => {
    const response = await changePassword(baseUrl, { currentPassword: 123, newPassword: ['new-secret'] });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_CREDENTIALS_REQUIRED' } });
    assert.equal(hashes.get(USER_ID), 'hash(old-secret)');
  });
});

test('POST /change-password rejects a new password below the minimum length', async () => {
  await withAuthServer(async (baseUrl, hashes) => {
    const response = await changePassword(baseUrl, { currentPassword: 'old-secret', newPassword: '12345' });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_CREDENTIALS_TOO_SHORT' } });
    assert.equal(hashes.get(USER_ID), 'hash(old-secret)');
  });
});
