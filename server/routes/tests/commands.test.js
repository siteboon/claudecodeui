import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeModelsCommand } from '../commands.js';

const withTemporaryModelsCache = async (callback) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'commands-model-cache-'));
  const previousCachePath = process.env.CLOUDCLI_PROVIDER_MODELS_CACHE_PATH;
  process.env.CLOUDCLI_PROVIDER_MODELS_CACHE_PATH = path.join(tempRoot, 'models-cache.json');

  try {
    await callback();
  } finally {
    if (previousCachePath === undefined) {
      delete process.env.CLOUDCLI_PROVIDER_MODELS_CACHE_PATH;
    } else {
      process.env.CLOUDCLI_PROVIDER_MODELS_CACHE_PATH = previousCachePath;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
};

test('models command returns available models only for the active provider', async () => {
  await withTemporaryModelsCache(async () => {
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
});

test('models command falls back to claude for unsupported providers', async () => {
  await withTemporaryModelsCache(async () => {
    const result = await executeModelsCommand([], {
      provider: 'unknown-provider',
    });

    assert.equal(result.data.current.provider, 'claude');
    assert.deepEqual(Object.keys(result.data.available), ['claude']);
  });
});
