import assert from 'node:assert/strict';
import test from 'node:test';

import { executeModelsCommand } from '../commands.js';

test('models command returns available models only for the active provider', async () => {
  const result = await executeModelsCommand([], {
    provider: 'codex',
    model: 'gpt-5.4',
  });

  assert.equal(result.type, 'builtin');
  assert.equal(result.action, 'models');
  assert.equal(result.data.current.provider, 'codex');
  assert.equal(result.data.current.model, 'gpt-5.4');
  assert.deepEqual(Object.keys(result.data.available), ['codex']);
  assert.deepEqual(result.data.available.codex, result.data.availableModels);
  assert.ok(result.data.availableModels.includes('gpt-5.4'));
  assert.equal(result.data.available.claude, undefined);
  assert.equal(result.data.available.cursor, undefined);
});

test('models command falls back to claude for unsupported providers', async () => {
  const result = await executeModelsCommand([], {
    provider: 'unknown-provider',
  });

  assert.equal(result.data.current.provider, 'claude');
  assert.deepEqual(Object.keys(result.data.available), ['claude']);
});
