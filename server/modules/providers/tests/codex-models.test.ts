import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { CODEX_PREDEFINED_MODELS } from '@/modules/providers/list/codex/codex-models.provider.js';

const require = createRequire(import.meta.url);

const findCodexModel = (value: string) =>
  CODEX_PREDEFINED_MODELS.OPTIONS.find((option) => option.value === value);

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

test('bundles a Codex CLI new enough to know the GPT-6.1 Sol and Terra models', () => {
  // The GPT-6.1 models entered the CLI's bundled catalog in 0.160.0. An older
  // CLI still sends the request, but on fallback metadata: it warns
  // "Model metadata ... not found" and quietly drops `ultra` to a lower tier.
  const { version } = require('@openai/codex/package.json') as { version: string };
  const [major, minor] = version.split('.').map(Number);
  assert.ok(major > 0 || minor >= 160, `bundled @openai/codex ${version} predates 0.160.0`);
});

test('drops the models ChatGPT-account Codex no longer serves', () => {
  // The Responses backend rejects GPT-5.5-and-below for ChatGPT-account auth
  // ("The 'gpt-5.5' model is not supported when using Codex with a ChatGPT
  // account"), and no bundled CLI catalog still ships metadata for
  // gpt-5.4 / gpt-5.4-mini. Keeping them in the picker only offered turns
  // that fail outright or run on fallback metadata.
  const values = CODEX_PREDEFINED_MODELS.OPTIONS.map((option) => option.value);
  for (const retired of ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini']) {
    assert.ok(!values.includes(retired), `${retired} should no longer be listed`);
  }
});

test('bundles a Codex CLI new enough to know the GPT-6 Sol and Luna models', () => {
  // Codex only ships metadata for gpt-6-sol / gpt-6-luna from 0.155.0 on. An
  // older CLI still sends the request, but on fallback metadata: it warns
  // "Model metadata ... not found" and quietly drops `ultra` to `medium`.
  const { version } = require('@openai/codex/package.json') as { version: string };
  const [major, minor] = version.split('.').map(Number);
  assert.ok(major > 0 || minor >= 155, `bundled @openai/codex ${version} predates 0.155.0`);
});
