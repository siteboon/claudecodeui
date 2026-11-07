import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { OpenCodeProviderAuth } from '@/modules/providers/list/opencode/opencode-auth.provider.js';

const OPENCODE_ENV_CREDENTIAL_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'WALLY_API_KEY',
];

/**
 * Runs one case against an empty OpenCode home with no provider keys set, so
 * the status depends only on the env the case sets. `opencode --version` is
 * stubbed so the CLI does not have to be installed.
 */
const withEmptyOpenCodeHome = async (
  env: Record<string, string>,
  runTest: (auth: OpenCodeProviderAuth) => Promise<void>,
): Promise<void> => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-auth-'));
  const originalHomedir = os.homedir;
  const originalEnv = OPENCODE_ENV_CREDENTIAL_KEYS.map((key) => [key, process.env[key]] as const);

  (os as any).homedir = () => homeDir;
  for (const key of OPENCODE_ENV_CREDENTIAL_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, env);

  try {
    const auth = new OpenCodeProviderAuth();
    auth.checkInstalled = () => ({ installed: true, exitCode: 0, version: '1.18.35' });
    await runTest(auth);
  } finally {
    (os as any).homedir = originalHomedir;
    for (const [key, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(homeDir, { recursive: true, force: true });
  }
};

test('OpenCode with no auth store and no provider key is not configured', async () => {
  await withEmptyOpenCodeHome({}, async (auth) => {
    const status = await auth.getStatus();

    assert.equal(status.authenticated, false);
    assert.equal(status.error, 'OpenCode not configured');
  });
});

test('OpenCode counts a Wally API key in the environment as configured', async () => {
  await withEmptyOpenCodeHome({ WALLY_API_KEY: 'test' }, async (auth) => {
    const status = await auth.getStatus();

    assert.equal(status.authenticated, true);
    assert.equal(status.email, 'WALLY_API_KEY');
    assert.equal(status.method, 'environment');
  });
});
