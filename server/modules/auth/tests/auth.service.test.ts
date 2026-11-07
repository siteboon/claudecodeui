import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/shared/utils.js';

import { createAuthService } from '../auth.service.js';

type AuthDependencies = Parameters<typeof createAuthService>[0];

function createDependencies(overrides: Partial<AuthDependencies> = {}): AuthDependencies {
  return {
    users: {
      hasUsers: () => false,
      createUser: (username, passwordHash) => ({ id: 1, username, password_hash: passwordHash }),
      getUserByUsername: () => undefined,
      updateLastLogin: () => undefined,
      getPasswordHashById: () => undefined,
      updatePasswordHash: () => undefined,
    },
    transaction: {
      begin: () => undefined,
      commit: () => undefined,
      rollback: () => undefined,
    },
    hashPassword: async () => 'hashed-password',
    comparePassword: async () => false,
    generateToken: () => 'signed-token',
    ...overrides,
  };
}

test('register hashes credentials and commits through injected dependencies', async () => {
  const operations: string[] = [];
  const service = createAuthService(createDependencies({
    transaction: {
      begin: () => operations.push('begin'),
      commit: () => operations.push('commit'),
      rollback: () => operations.push('rollback'),
    },
    hashPassword: async (password) => {
      operations.push(`hash:${password}`);
      return 'hash';
    },
    users: {
      hasUsers: () => false,
      createUser: (username, passwordHash) => {
        operations.push(`create:${username}:${passwordHash}`);
        return { id: 1, username, password_hash: passwordHash };
      },
      getUserByUsername: () => undefined,
      updateLastLogin: (userId) => operations.push(`login:${userId}`),
      getPasswordHashById: () => undefined,
      updatePasswordHash: () => undefined,
    },
  }));

  const result = await service.register('alice', 'secret12');

  assert.equal(result.token, 'signed-token');
  assert.deepEqual(operations, ['begin', 'hash:secret12', 'create:alice:hash', 'commit', 'login:1']);
});

test('login rejects an invalid password without issuing a token', async () => {
  let tokenIssued = false;
  const service = createAuthService(createDependencies({
    users: {
      hasUsers: () => true,
      createUser: () => { throw new Error('unused'); },
      getUserByUsername: () => ({ id: 1, username: 'alice', password_hash: 'hash' }),
      updateLastLogin: () => undefined,
      getPasswordHashById: () => undefined,
      updatePasswordHash: () => undefined,
    },
    comparePassword: async () => false,
    generateToken: () => {
      tokenIssued = true;
      return 'token';
    },
  }));

  await assert.rejects(
    service.login('alice', 'wrong-password'),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_INVALID_CREDENTIALS',
  );
  assert.equal(tokenIssued, false);
});

test('refreshSession issues a replacement token for the authenticated user', () => {
  let tokenUser: { id: number | bigint; username: string } | undefined;
  const service = createAuthService(createDependencies({
    generateToken: (user) => {
      tokenUser = user;
      return 'replacement-token';
    },
  }));

  const result = service.refreshSession({ id: 7, username: 'alice' });

  assert.deepEqual(result, { token: 'replacement-token' });
  assert.deepEqual(tokenUser, { id: 7, username: 'alice' });
});

function createPasswordChangeDependencies(updates: string[]): AuthDependencies {
  const base = createDependencies();
  return {
    ...base,
    users: {
      ...base.users,
      getPasswordHashById: (userId) => (userId === 1 ? 'old-hash' : undefined),
      updatePasswordHash: (userId, passwordHash) => updates.push(`${userId}:${passwordHash}`),
    },
    comparePassword: async (password, passwordHash) => password === 'old-secret' && passwordHash === 'old-hash',
    hashPassword: async (password) => `hash(${password})`,
  };
}

test('changePassword stores a new hash after verifying the current password', async () => {
  const updates: string[] = [];
  const service = createAuthService(createPasswordChangeDependencies(updates));

  const result = await service.changePassword({ id: 1, username: 'alice' }, 'old-secret', 'new-secret');

  assert.deepEqual(result, { success: true });
  assert.deepEqual(updates, ['1:hash(new-secret)']);
});

test('changePassword rejects an incorrect current password without updating', async () => {
  const updates: string[] = [];
  const service = createAuthService(createPasswordChangeDependencies(updates));

  await assert.rejects(
    service.changePassword({ id: 1, username: 'alice' }, 'wrong', 'new-secret'),
    (error: unknown) => error instanceof AppError
      && error.code === 'AUTH_INVALID_CURRENT_PASSWORD'
      && error.statusCode === 400,
  );
  assert.deepEqual(updates, []);
});

test('changePassword enforces the registration minimum length', async () => {
  const updates: string[] = [];
  const service = createAuthService(createPasswordChangeDependencies(updates));

  await assert.rejects(
    service.changePassword({ id: 1, username: 'alice' }, 'old-secret', '12345'),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_CREDENTIALS_TOO_SHORT',
  );
  assert.deepEqual(updates, []);
});

test('changePassword requires an authenticated user', async () => {
  const service = createAuthService(createPasswordChangeDependencies([]));

  await assert.rejects(
    service.changePassword(undefined, 'old-secret', 'new-secret'),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_USER_REQUIRED',
  );
});

test('changePassword requires both the current and the new password', async () => {
  const updates: string[] = [];
  const service = createAuthService(createPasswordChangeDependencies(updates));

  await assert.rejects(
    service.changePassword({ id: 1, username: 'alice' }, '', 'new-secret'),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_CREDENTIALS_REQUIRED',
  );
  await assert.rejects(
    service.changePassword({ id: 1, username: 'alice' }, 'old-secret', undefined),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_CREDENTIALS_REQUIRED',
  );
  assert.deepEqual(updates, []);
});

test('changePassword treats a user with no stored hash as an incorrect current password', async () => {
  const updates: string[] = [];
  const service = createAuthService(createPasswordChangeDependencies(updates));

  // User 2 has no hash in the fake store (deactivated or deleted after the token was issued).
  await assert.rejects(
    service.changePassword({ id: 2, username: 'bob' }, 'old-secret', 'new-secret'),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_INVALID_CURRENT_PASSWORD',
  );
  assert.deepEqual(updates, []);
});
