import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildCodexCliEnvironment,
  resolveCodexCredentials,
} from '@/modules/providers/list/codex/codex-credentials.js';

const TEST_ENV_KEY = 'CLOUDCLI_CODEX_TEST_API_KEY';

const withCodexHome = async (runTest: (codexHome: string) => Promise<void>): Promise<void> => {
  const previousCodexHome = process.env.CODEX_HOME;
  const previousTestEnvValue = process.env[TEST_ENV_KEY];
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-credentials-'));

  process.env.CODEX_HOME = tempRoot;
  delete process.env[TEST_ENV_KEY];

  try {
    await runTest(tempRoot);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }

    if (previousTestEnvValue === undefined) {
      delete process.env[TEST_ENV_KEY];
    } else {
      process.env[TEST_ENV_KEY] = previousTestEnvValue;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
};

const writeCustomProviderConfig = async (codexHome: string): Promise<void> => {
  await mkdir(codexHome, { recursive: true });
  await writeFile(
    path.join(codexHome, 'config.toml'),
    [
      'model = "custom-model"',
      'model_provider = "custom_provider"',
      '',
      '[model_providers.custom_provider]',
      'name = "Custom Provider"',
      'base_url = "https://example.com/v1"',
      `env_key = "${TEST_ENV_KEY}"`,
      'wire_api = "responses"',
      '',
    ].join('\n'),
    'utf8',
  );
};

test('Codex credentials resolver preserves official auth.json API key login', { concurrency: false }, async () => {
  await withCodexHome(async (codexHome) => {
    await writeFile(
      path.join(codexHome, 'auth.json'),
      JSON.stringify({ OPENAI_API_KEY: 'official-key' }),
      'utf8',
    );

    const credentials = await resolveCodexCredentials();

    assert.equal(credentials.authenticated, true);
    assert.equal(credentials.method, 'api_key');
    assert.equal(credentials.email, 'API Key Auth');
    assert.equal(credentials.env, undefined);
  });
});

test('Codex credentials resolver recognizes custom provider credentials from process env', { concurrency: false }, async () => {
  await withCodexHome(async (codexHome) => {
    await writeCustomProviderConfig(codexHome);
    process.env[TEST_ENV_KEY] = 'process-secret';

    const credentials = await resolveCodexCredentials();

    assert.equal(credentials.authenticated, true);
    assert.equal(credentials.method, 'custom_provider_env');
    assert.equal(credentials.email, 'custom_provider custom provider');
    assert.deepEqual(credentials.env, { [TEST_ENV_KEY]: 'process-secret' });
  });
});

test('Codex credentials resolver reads custom provider credentials from CODEX_HOME .env', { concurrency: false }, async () => {
  await withCodexHome(async (codexHome) => {
    await writeCustomProviderConfig(codexHome);
    await writeFile(
      path.join(codexHome, '.env'),
      [
        '# unrelated values should be ignored',
        'OTHER_KEY=unused',
        `export ${TEST_ENV_KEY}="env-file-secret"`,
        '',
      ].join('\n'),
      'utf8',
    );

    const credentials = await resolveCodexCredentials();
    const cliEnvironment = buildCodexCliEnvironment(credentials);

    assert.equal(credentials.authenticated, true);
    assert.equal(credentials.method, 'custom_provider_env_file');
    assert.deepEqual(credentials.env, { [TEST_ENV_KEY]: 'env-file-secret' });
    assert.equal(process.env[TEST_ENV_KEY], undefined);
    assert.equal(cliEnvironment?.[TEST_ENV_KEY], 'env-file-secret');
  });
});

test('Codex credentials resolver reports missing custom provider env key value', { concurrency: false }, async () => {
  await withCodexHome(async (codexHome) => {
    await writeCustomProviderConfig(codexHome);

    const credentials = await resolveCodexCredentials();

    assert.equal(credentials.authenticated, false);
    assert.equal(credentials.method, null);
    assert.equal(credentials.error, `Codex provider credential ${TEST_ENV_KEY} missing`);
  });
});
