import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import { OpenCodeProviderAuth } from '@/modules/providers/list/opencode/opencode-auth.provider.js';

// A placeholder, never a real key: the assertions check it never leaks into the status.
const FAKE_KEY = 'fake-opencode-test-key-0000';
const SET_VAR = 'CLOUDCLI_TEST_OPENCODE_SET_KEY';
const UNSET_VAR = 'CLOUDCLI_TEST_OPENCODE_UNSET_KEY';
const BLANK_VAR = 'CLOUDCLI_TEST_OPENCODE_BLANK_KEY';

const AUTH_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENCODE_CONFIG',
  'OPENCODE_CONFIG_CONTENT',
  SET_VAR,
  UNSET_VAR,
  BLANK_VAR,
];

type Setup = (homeDir: string, configDir: string) => Promise<void>;

/**
 * Reads the status against a throwaway home with every credential variable
 * cleared, so the result depends on the fixture alone. The CLI probe is
 * stubbed: installation is not what these cases are about.
 */
const readStatus = async (setUp: Setup) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-auth-'));
  const configDir = path.join(homeDir, '.config', 'opencode');
  const originalHomedir = os.homedir;
  const originalEnv = AUTH_ENV_KEYS.map((key) => [key, process.env[key]] as const);
  (os as any).homedir = () => homeDir;
  for (const key of AUTH_ENV_KEYS) {
    delete process.env[key];
  }

  try {
    await mkdir(configDir, { recursive: true });
    await setUp(homeDir, configDir);
    const auth = new OpenCodeProviderAuth();
    mock.method(auth, 'checkInstalled', () => ({ installed: true, exitCode: 0, version: 'test' }));
    return await auth.getStatus();
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

const writeConfig = (configDir: string, config: unknown, fileName = 'opencode.json') =>
  writeFile(path.join(configDir, fileName), JSON.stringify(config), 'utf8');

const v2Config = (apiKey: unknown) => ({
  providers: { res: { settings: { apiKey }, models: { 'gemini-4-argon': {} } } },
});

const writeKeyFile = async (filePath: string, content = FAKE_KEY): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
};

const assertAuthenticated = (status: Awaited<ReturnType<typeof readStatus>>, providerId = 'res') => {
  assert.equal(status.authenticated, true);
  assert.equal(status.method, 'config_file');
  assert.equal(status.email, `${providerId} credentials`);
  assert.equal(JSON.stringify(status).includes(FAKE_KEY), false);
};

const assertNotAuthenticated = (status: Awaited<ReturnType<typeof readStatus>>) => {
  assert.equal(status.authenticated, false);
  assert.equal(status.method, null);
  assert.equal(status.error, 'OpenCode not configured');
  assert.equal(JSON.stringify(status).includes(FAKE_KEY), false);
};

test('OpenCode authenticates the reporter\'s v2 config with a non-empty key file', async () => {
  assertAuthenticated(await readStatus(async (homeDir, configDir) => {
    await writeKeyFile(path.join(homeDir, '.config', 'opencode', 'res.key'));
    await writeConfig(configDir, v2Config('{file:~/.config/opencode/res.key}'));
  }));
});

test('OpenCode authenticates literal, {env:} and v1 options.apiKey credentials', async () => {
  assertAuthenticated(await readStatus((_, configDir) => writeConfig(configDir, v2Config(FAKE_KEY))));

  assertAuthenticated(await readStatus(async (_, configDir) => {
    process.env[SET_VAR] = FAKE_KEY;
    await writeConfig(configDir, v2Config(`  {env:${SET_VAR}}  `));
  }));

  assertAuthenticated(await readStatus((_, configDir) => writeConfig(
    configDir,
    { provider: { 'my-proxy': { options: { apiKey: FAKE_KEY } } } },
  )), 'my-proxy');
});

test('OpenCode authenticates a commented .jsonc config with trailing commas', async () => {
  assertAuthenticated(await readStatus((_, configDir) => writeFile(
    path.join(configDir, 'opencode.jsonc'),
    `{
      // v2 shape
      "providers": {
        "res": { "settings": { "apiKey": "${FAKE_KEY}", }, }, /* trailing */
      },
    }`,
    'utf8',
  )));
});

test('OpenCode resolves {file:} paths from inline and OPENCODE_CONFIG config', async () => {
  assertAuthenticated(await readStatus(async (homeDir) => {
    await writeKeyFile(path.join(homeDir, 'keys', 'res.key'));
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(v2Config('{file:~/keys/res.key}'));
  }));

  assertAuthenticated(await readStatus(async (homeDir) => {
    const keyPath = path.join(homeDir, 'keys', 'res.key');
    await writeKeyFile(keyPath);
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(v2Config(`{file:${keyPath}}`));
  }));

  // A relative path resolves against the directory of the file that holds it.
  assertAuthenticated(await readStatus(async (homeDir) => {
    const customDir = path.join(homeDir, 'custom');
    await writeKeyFile(path.join(customDir, 'secrets', 'res.key'));
    await writeConfig(customDir, v2Config('{file:secrets/res.key}'), 'custom.json');
    process.env.OPENCODE_CONFIG = path.join(customDir, 'custom.json');
  }));
});

test('OpenCode does not count {file:} targets that are empty, directories or missing', async () => {
  assertNotAuthenticated(await readStatus(async (homeDir, configDir) => {
    await writeKeyFile(path.join(homeDir, 'empty.key'), '');
    await writeConfig(configDir, v2Config('{file:~/empty.key}'));
  }));

  assertNotAuthenticated(await readStatus(async (homeDir, configDir) => {
    await mkdir(path.join(homeDir, 'key-dir'));
    await writeConfig(configDir, v2Config('{file:~/key-dir}'));
  }));

  assertNotAuthenticated(await readStatus((_, configDir) =>
    writeConfig(configDir, v2Config('{file:~/missing.key}'))));

  // Inline config has no directory to resolve a relative path against, so a
  // key file that would match against the home directory still does not count.
  assertNotAuthenticated(await readStatus(async (homeDir) => {
    await writeKeyFile(path.join(homeDir, 'res.key'));
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(v2Config('{file:res.key}'));
  }));
});

test('OpenCode does not count unset, blank or mixed tokens, or keyless providers', async () => {
  for (const apiKey of [`{env:${UNSET_VAR}}`, `{env:${BLANK_VAR}}`, `sk-{env:${UNSET_VAR}}`, '   ', 42]) {
    assertNotAuthenticated(await readStatus(async (_, configDir) => {
      process.env[BLANK_VAR] = '   ';
      await writeConfig(configDir, v2Config(apiKey));
    }));
  }

  assertNotAuthenticated(await readStatus((_, configDir) =>
    writeConfig(configDir, { providers: { res: { models: { 'gemini-4-argon': {} } } } })));
});

test('OpenCode still reports a malformed auth.json before looking at config', async () => {
  const status = await readStatus(async (homeDir, configDir) => {
    const authDir = path.join(homeDir, '.local', 'share', 'opencode');
    await mkdir(authDir, { recursive: true });
    await writeFile(path.join(authDir, 'auth.json'), '{ not json', 'utf8');
    await writeConfig(configDir, v2Config(FAKE_KEY));
  });

  assert.equal(status.authenticated, false);
  assert.notEqual(status.error, 'OpenCode not configured');
  assert.equal(JSON.stringify(status).includes(FAKE_KEY), false);
});
