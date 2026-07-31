import assert from 'node:assert/strict';
import test from 'node:test';

import { createUserService } from '../user.service.js';

type UserDependencies = Parameters<typeof createUserService>[0];

function createDependencies(overrides: Partial<UserDependencies> = {}): UserDependencies {
  return {
    users: {
      getGitConfig: () => undefined,
      updateGitConfig: () => undefined,
      completeOnboarding: () => undefined,
      hasCompletedOnboarding: () => false,
    },
    readSystemGitConfig: async () => ({ git_name: null, git_email: null }),
    applyGlobalGitConfig: async () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
    ...overrides,
  };
}

test('getGitConfig imports system configuration when the repository is empty', async () => {
  const updates: unknown[][] = [];
  const service = createUserService(createDependencies({
    users: {
      getGitConfig: () => undefined,
      updateGitConfig: (...args) => updates.push(args),
      completeOnboarding: () => undefined,
      hasCompletedOnboarding: () => false,
    },
    readSystemGitConfig: async () => ({ git_name: 'Alice', git_email: 'alice@example.com' }),
  }));

  const result = await service.getGitConfig(7);

  assert.equal(result.gitName, 'Alice');
  assert.deepEqual(updates, [[7, 'Alice', 'alice@example.com']]);
});

test('updateGitConfig persists valid input and invokes the Git adapter', async () => {
  const operations: string[] = [];
  const service = createUserService(createDependencies({
    users: {
      getGitConfig: () => undefined,
      updateGitConfig: (_id, name, email) => operations.push(`persist:${name}:${email}`),
      completeOnboarding: () => undefined,
      hasCompletedOnboarding: () => false,
    },
    applyGlobalGitConfig: async (name, email) => {
      operations.push(`git:${name}:${email}`);
    },
  }));

  await service.updateGitConfig(1, 'Alice', 'alice@example.com');
  assert.deepEqual(operations, [
    'persist:Alice:alice@example.com',
    'git:Alice:alice@example.com',
  ]);
});
