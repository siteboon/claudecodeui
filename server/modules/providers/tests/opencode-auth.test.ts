import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { OpenCodeProviderAuth } from '@/modules/providers/list/opencode/opencode-auth.provider.js';

const OPENCODE_ENV_CREDENTIAL_KEYS = [
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY',
  'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'WALLY_API_KEY',
  // Location overrides would otherwise point the auth read at a real store.
  'OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_CONFIG_DIR',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
];

// Isolate every auth store and env key; never probe a real CLI or user home.
const withOpenCodeAuth = async (
  env: Record<string, string>,
  store: 'missing' | 'malformed' | 'unreadable' | 'valid',
  runTest: (auth: OpenCodeProviderAuth) => Promise<void>,
): Promise<void> => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'oc-auth-'));
  const originalHomedir = os.homedir;
  const originalEnv = OPENCODE_ENV_CREDENTIAL_KEYS.map(key => [key, process.env[key]] as const);
  (os as any).homedir = () => homeDir;
  for (const key of OPENCODE_ENV_CREDENTIAL_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  try {
    const authPath = path.join(homeDir, '.local', 'share', 'opencode', 'auth.json');
    if (store !== 'missing') {
      await mkdir(path.dirname(authPath), { recursive: true });
      if (store === 'unreadable') {
        // Reading a directory as a file deterministically fails with EISDIR.
        await mkdir(authPath);
      } else {
        await writeFile(authPath, store === 'malformed'
          ? '{broken'
          : JSON.stringify({ anthropic: { type: 'api', key: 'fake-stored-key' } }));
      }
    }
    const auth = new OpenCodeProviderAuth();
    auth.checkInstalled = () => ({ installed: true, exitCode: 0, version: 'test-version' });
    await runTest(auth);
  } finally {
    (os as any).homedir = originalHomedir;
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(homeDir, { recursive: true, force: true });
  }
};

for (const store of ['missing', 'malformed', 'unreadable'] as const) {
  test(`OpenCode authenticates Wally-only env with ${store} auth.json`, async () => {
    await withOpenCodeAuth({ WALLY_API_KEY: ' fake-wally-key ' }, store, async auth => {
      const status = await auth.getStatus();
      assert.equal(status.authenticated, true);
      assert.equal(status.email, 'WALLY_API_KEY');
      assert.equal(status.method, 'environment');
      assert.equal(status.error, undefined);
    });
  });
}

for (const wallyKey of [undefined, '', '  \t ']) {
  test(`OpenCode does not authenticate an unset or blank Wally key (${JSON.stringify(wallyKey)})`, async () => {
    await withOpenCodeAuth(wallyKey === undefined ? {} : { WALLY_API_KEY: wallyKey }, 'missing', async auth => {
      const status = await auth.getStatus();
      assert.equal(status.authenticated, false);
      assert.equal(status.error, 'OpenCode not configured');
    });
  });
}

test('OpenCode retains the OpenAI env login control', async () => {
  await withOpenCodeAuth({ OPENAI_API_KEY: 'fake-openai-key' }, 'missing', async auth => {
    const status = await auth.getStatus();
    assert.equal(status.authenticated, true);
    assert.equal(status.email, 'OPENAI_API_KEY');
    assert.equal(status.method, 'environment');
  });
});

for (const store of ['malformed', 'unreadable'] as const) {
  test(`OpenCode retains ${store} auth-store errors without a Wally login`, async () => {
    await withOpenCodeAuth({ OPENAI_API_KEY: 'fake-openai-key', WALLY_API_KEY: '  ' }, store, async auth => {
      const status = await auth.getStatus();
      assert.equal(status.authenticated, false);
      assert.ok(status.error);
      assert.notEqual(status.error, 'OpenCode not configured');
    });
  });
}

test('OpenCode retains valid auth-store precedence over a Wally key', async () => {
  await withOpenCodeAuth({ WALLY_API_KEY: 'fake-wally-key' }, 'valid', async auth => {
    const status = await auth.getStatus();
    assert.equal(status.authenticated, true);
    assert.equal(status.email, 'anthropic credentials');
    assert.equal(status.method, 'credentials_file');
  });
});
