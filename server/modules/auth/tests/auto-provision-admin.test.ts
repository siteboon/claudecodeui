import assert from 'node:assert/strict';
import test from 'node:test';

import { autoProvisionAdminUser } from '../auto-provision-admin.js';

type Dependencies = Parameters<typeof autoProvisionAdminUser>[0];

function createDependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    hasUsers: () => false,
    register: async () => undefined,
    generatePassword: () => 'generated-password',
    ...overrides,
  };
}

test('does nothing when disabled', async () => {
  let registered = false;
  const dependencies = createDependencies({
    register: async () => { registered = true; },
  });

  const result = await autoProvisionAdminUser(dependencies, {
    enabled: false,
    username: 'admin',
  });

  assert.equal(result, null);
  assert.equal(registered, false);
});

test('does nothing when a user already exists, even if enabled', async () => {
  let registered = false;
  const dependencies = createDependencies({
    hasUsers: () => true,
    register: async () => { registered = true; },
  });

  const result = await autoProvisionAdminUser(dependencies, {
    enabled: true,
    username: 'admin',
  });

  assert.equal(result, null);
  assert.equal(registered, false);
});

test('generates a password and registers with it when no override is given', async () => {
  const calls: Array<{ username: string; password: string }> = [];
  const dependencies = createDependencies({
    generatePassword: () => 'random-generated-password',
    register: async (username, password) => {
      calls.push({ username, password });
    },
  });

  const result = await autoProvisionAdminUser(dependencies, {
    enabled: true,
    username: 'admin',
  });

  assert.deepEqual(result, { username: 'admin', password: 'random-generated-password' });
  assert.deepEqual(calls, [{ username: 'admin', password: 'random-generated-password' }]);
});

test('uses an explicit password override instead of generating one', async () => {
  let generateCalled = false;
  const calls: Array<{ username: string; password: string }> = [];
  const dependencies = createDependencies({
    generatePassword: () => { generateCalled = true; return 'should-not-be-used'; },
    register: async (username, password) => {
      calls.push({ username, password });
    },
  });

  const result = await autoProvisionAdminUser(dependencies, {
    enabled: true,
    username: 'admin',
    password: 'fixed-password',
  });

  assert.deepEqual(result, { username: 'admin', password: 'fixed-password' });
  assert.deepEqual(calls, [{ username: 'admin', password: 'fixed-password' }]);
  assert.equal(generateCalled, false);
});

test('propagates a register() failure to the caller instead of swallowing it', async () => {
  const dependencies = createDependencies({
    register: async () => {
      throw new Error('username too short');
    },
  });

  await assert.rejects(
    autoProvisionAdminUser(dependencies, { enabled: true, username: 'ad' }),
    (error: unknown) => error instanceof Error && error.message === 'username too short',
  );
});
