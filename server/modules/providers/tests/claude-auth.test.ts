import assert from 'node:assert/strict';
import test from 'node:test';

import spawn from 'cross-spawn';

import { ClaudeProviderAuth } from '@/modules/providers/list/claude/claude-auth.provider.js';

const createSpawnSync = (
  authResult: Record<string, unknown>,
): typeof spawn.sync => ((_: string, args: readonly string[]) => {
  if (args[0] === '--version') {
    return { status: 0 };
  }

  return authResult;
}) as unknown as typeof spawn.sync;

test('Claude auth status recognizes a macOS Keychain-backed login', async () => {
  const auth = new ClaudeProviderAuth(createSpawnSync({
    status: 0,
    stdout: JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      email: 'person@example.com',
    }),
  }));

  assert.deepEqual(await auth.getStatus(), {
    installed: true,
    provider: 'claude',
    authenticated: true,
    email: 'person@example.com',
    method: 'cli:claude.ai',
    error: undefined,
  });
});

test('Claude auth status honors logged-out JSON even when the CLI exits with status 1', async () => {
  const auth = new ClaudeProviderAuth(createSpawnSync({
    status: 1,
    stdout: JSON.stringify({ loggedIn: false }),
  }));

  const status = await auth.getStatus();

  assert.equal(status.authenticated, false);
  assert.equal(status.email, null);
  assert.match(status.error ?? '', /not authenticated/i);
});

test('Claude auth status surfaces a CLI timeout instead of reporting Keychain users as logged out', async () => {
  const auth = new ClaudeProviderAuth(createSpawnSync({
    status: null,
    error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
  }));

  const status = await auth.getStatus();

  assert.equal(status.authenticated, false);
  assert.match(status.error ?? '', /Unable to check Claude CLI authentication status/);
});
