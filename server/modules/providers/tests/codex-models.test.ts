import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CODEX_PREDEFINED_MODELS } from '@/modules/providers/list/codex/codex-models.provider.js';

const require = createRequire(import.meta.url);

const findCodexModel = (value: string) =>
  CODEX_PREDEFINED_MODELS.OPTIONS.find((option) => option.value === value);

/**
 * Runs the Codex CLI that chats spawn, with a throwaway CODEX_HOME so no user
 * config or login is read. The SDK spawns the native binary of the
 * `@openai/codex-<platform>` package installed next to the `@openai/codex` it
 * resolves; that package's own launcher, resolved the same way, runs it too.
 */
const runChatCodexCli = async (args: string[]): Promise<string> => {
  const sdkRequire = createRequire(import.meta.resolve('@openai/codex-sdk'));
  const packageJsonPath = sdkRequire.resolve('@openai/codex/package.json');
  const { bin } = sdkRequire('@openai/codex/package.json') as { bin: { codex: string } };
  const codexHome = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-codex-models-'));
  try {
    return execFileSync(process.execPath, [path.join(path.dirname(packageJsonPath), bin.codex), ...args], {
      encoding: 'utf8',
      env: { ...process.env, CODEX_HOME: codexHome },
      // Piped, not inherited: the CLI warns on stderr that it skips its helper
      // binaries under a temp CODEX_HOME, which these commands do not need.
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
};

test('lists GPT-6 Sol and GPT-6 Luna with the effort levels the Codex CLI accepts', () => {
  const sol = findCodexModel('gpt-6-sol');
  assert.equal(sol?.label, 'GPT-6 Sol');
  assert.equal(sol?.effort?.default, 'medium');
  assert.deepEqual(
    sol?.effort?.values.map((effort) => effort.value),
    ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  );

  const luna = findCodexModel('gpt-6-luna');
  assert.equal(luna?.label, 'GPT-6 Luna');
  assert.equal(luna?.effort?.default, 'medium');
  assert.deepEqual(
    luna?.effort?.values.map((effort) => effort.value),
    ['low', 'medium', 'high', 'xhigh', 'max'],
  );
});

test('lists GPT-6.1 Sol and GPT-6.1 Terra with the effort levels the Codex CLI accepts', () => {
  const sol = findCodexModel('gpt-6.1-sol');
  assert.equal(sol?.label, 'GPT-6.1 Sol');
  assert.equal(sol?.effort?.default, 'low');
  assert.deepEqual(
    sol?.effort?.values.map((effort) => effort.value),
    ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  );

  const terra = findCodexModel('gpt-6.1-terra');
  assert.equal(terra?.label, 'GPT-6.1 Terra');
  assert.equal(terra?.effort?.default, 'low');
  assert.deepEqual(
    terra?.effort?.values.map((effort) => effort.value),
    ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  );
});

test('lists only models the bundled Codex CLI has metadata for', async () => {
  // Any other model still runs, but on fallback metadata: the CLI warns "Model
  // metadata ... not found" (the chat never shows it), sends no default effort
  // and leaves tools such as apply_patch out. Codex 0.158.0 dropped gpt-5.4
  // from its bundled catalog. The CLI also matches a model by slug prefix,
  // which hands it another model's metadata, so each entry must be a slug.
  const { models } = JSON.parse(await runChatCodexCli(['debug', 'models', '--bundled'])) as {
    models: Array<{ slug: string }>;
  };
  const bundledSlugs = new Set(models.map((model) => model.slug));
  assert.deepEqual(
    CODEX_PREDEFINED_MODELS.OPTIONS
      .map((option) => option.value)
      .filter((value) => !bundledSlugs.has(value)),
    [],
  );
});

test('defaults Codex chats to a model the picker lists', () => {
  assert.ok(
    CODEX_PREDEFINED_MODELS.OPTIONS.some((option) => option.value === CODEX_PREDEFINED_MODELS.DEFAULT),
    `DEFAULT ${CODEX_PREDEFINED_MODELS.DEFAULT} is not a listed Codex model`,
  );
});

test('bundles a Codex CLI new enough to know the GPT-6.1 Sol and Terra models', () => {
  // The GPT-6.1 models entered the CLI's bundled catalog in 0.160.0. An older
  // CLI still sends the request, but on fallback metadata: it warns
  // "Model metadata ... not found" and quietly drops `ultra` to a lower tier.
  const { version } = require('@openai/codex/package.json') as { version: string };
  const [major, minor] = version.split('.').map(Number);
  assert.ok(major > 0 || minor >= 160, `bundled @openai/codex ${version} predates 0.160.0`);
});

test('bundles a Codex CLI new enough to know the GPT-6 Sol and Luna models', () => {
  // Codex only ships metadata for gpt-6-sol / gpt-6-luna from 0.155.0 on. An
  // older CLI still sends the request, but on fallback metadata: it warns
  // "Model metadata ... not found" and quietly drops `ultra` to `medium`.
  const { version } = require('@openai/codex/package.json') as { version: string };
  const [major, minor] = version.split('.').map(Number);
  assert.ok(major > 0 || minor >= 155, `bundled @openai/codex ${version} predates 0.155.0`);
});
