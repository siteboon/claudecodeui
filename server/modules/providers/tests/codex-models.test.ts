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

test('lists GPT-6.1 Sol with its supported reasoning efforts', () => {
  const sol = findCodexModel('gpt-6.1-sol');
  assert.equal(sol?.label, 'GPT-6.1 Sol');
  assert.equal(sol?.effort?.default, 'medium');
  assert.deepEqual(
    sol?.effort?.values.map((effort) => effort.value),
    ['low', 'medium', 'high', 'xhigh', 'max'],
  );
});

test('bundles the Codex version verified to run GPT-6.1 Sol with a ChatGPT login', () => {
  // 0.156.1 returns model_not_found for GPT-6.1 Sol with the same login that
  // succeeds on 0.164.0. Check the SDK-resolved CLI too: its runtime dependency
  // can be nested and older than the app-server CLI at the project root.
  const { version } = require('@openai/codex/package.json') as { version: string };
  const [major, minor] = version.split('.').map(Number);
  assert.ok(major > 0 || minor >= 164, `bundled @openai/codex ${version} predates verified 0.164.0`);

  const sdkRequire = createRequire(import.meta.resolve('@openai/codex-sdk'));
  const sdkCli = sdkRequire('@openai/codex/package.json') as { version: string };
  assert.equal(sdkCli.version, version, 'conversation SDK and app-server must use the same CLI version');
});
