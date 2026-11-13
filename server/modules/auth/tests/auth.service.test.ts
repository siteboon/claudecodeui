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
      getUserAuthById: () => undefined,
      updatePasswordHash: () => undefined,
      updateLastLogin: () => undefined,
    },
    authConfig: {
      setTokenGeneration: () => undefined,
    },
    transaction: {
      begin: () => undefined,
      commit: () => undefined,
      rollback: () => undefined,
    },
    isPlatform: false,
    createTokenGeneration: () => 'token-generation',
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
      getUserAuthById: () => undefined,
      updatePasswordHash: () => undefined,
      updateLastLogin: (userId) => operations.push(`login:${userId}`),
    },
  }));

  const result = await service.register('alice', 'secret12');

  assert.equal(result.token, 'signed-token');
  assert.deepEqual(operations, ['hash:secret12', 'begin', 'create:alice:hash', 'commit', 'login:1']);
});

test('login rejects an invalid password without issuing a token', async () => {
  let tokenIssued = false;
  const service = createAuthService(createDependencies({
    users: {
      hasUsers: () => true,
      createUser: () => { throw new Error('unused'); },
      getUserByUsername: () => ({ id: 1, username: 'alice', password_hash: 'hash' }),
      getUserAuthById: () => undefined,
      updatePasswordHash: () => undefined,
      updateLastLogin: () => undefined,
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

test('changePassword stores the new hash and rotates the token generation', async () => {
  const operations: string[] = [];
  const service = createAuthService(createDependencies({
    users: {
      hasUsers: () => true,
      createUser: () => { throw new Error('unused'); },
      getUserByUsername: () => undefined,
      getUserAuthById: () => ({ id: 7, username: 'alice', password_hash: 'current-hash' }),
      updatePasswordHash: (userId, passwordHash) => operations.push(`password:${userId}:${passwordHash}`),
      updateLastLogin: () => undefined,
    },
    authConfig: {
      setTokenGeneration: (value) => operations.push(`generation:${value}`),
    },
    transaction: {
      begin: () => operations.push('begin'),
      commit: () => operations.push('commit'),
      rollback: () => operations.push('rollback'),
    },
    comparePassword: async (password, passwordHash) => (
      password === 'current-password' && passwordHash === 'current-hash'
    ),
    hashPassword: async (password) => `hash:${password}`,
    createTokenGeneration: () => 'next-generation',
  }));

  const result = await service.changePassword(
    { id: 7, username: 'alice' },
    'current-password',
    'replacement-password',
  );

  assert.deepEqual(result, {
    success: true,
    message: 'Password updated. Please sign in again.',
  });
  assert.deepEqual(operations, [
    'begin',
    'password:7:hash:replacement-password',
    'generation:next-generation',
    'commit',
  ]);
});

test('changePassword rejects the wrong current password before changing state', async () => {
  let transactionStarted = false;
  const service = createAuthService(createDependencies({
    users: {
      hasUsers: () => true,
      createUser: () => { throw new Error('unused'); },
      getUserByUsername: () => undefined,
      getUserAuthById: () => ({ id: 7, username: 'alice', password_hash: 'current-hash' }),
      updatePasswordHash: () => { throw new Error('must not update'); },
      updateLastLogin: () => undefined,
    },
    transaction: {
      begin: () => { transactionStarted = true; },
      commit: () => undefined,
      rollback: () => undefined,
    },
  }));

  await assert.rejects(
    service.changePassword({ id: 7 }, 'wrong-password', 'replacement-password'),
    (error: unknown) => error instanceof AppError
      && error.code === 'AUTH_CURRENT_PASSWORD_INCORRECT',
  );
  assert.equal(transactionStarted, false);
});

test('changePassword validates its input before reading account state', async () => {
  let userRead = false;
  const service = createAuthService(createDependencies({
    users: {
      hasUsers: () => true,
      createUser: () => { throw new Error('unused'); },
      getUserByUsername: () => undefined,
      getUserAuthById: () => {
        userRead = true;
        return undefined;
      },
      updatePasswordHash: () => undefined,
      updateLastLogin: () => undefined,
    },
  }));

  await assert.rejects(
    service.changePassword({ id: 7 }, '', 'short'),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_PASSWORDS_REQUIRED',
  );
  await assert.rejects(
    service.changePassword({ id: 7 }, 'current-password', 'short'),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_PASSWORD_TOO_SHORT',
  );
  assert.equal(userRead, false);
});

test('changePassword requires an authenticated user', async () => {
  const service = createAuthService(createDependencies());

  await assert.rejects(
    service.changePassword(undefined, 'current-password', 'replacement-password'),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_USER_REQUIRED',
  );
});

test('changePassword rejects a token whose user no longer exists', async () => {
  const service = createAuthService(createDependencies());

  await assert.rejects(
    service.changePassword({ id: 7 }, 'current-password', 'replacement-password'),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_TOKEN_INVALID',
  );
});

test('changePassword is unavailable in platform mode', async () => {
  const service = createAuthService(createDependencies({ isPlatform: true }));

  await assert.rejects(
    service.changePassword({ id: 7 }, 'current-password', 'replacement-password'),
    (error: unknown) => error instanceof AppError
      && error.code === 'AUTH_PASSWORD_CHANGE_UNAVAILABLE',
  );
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
