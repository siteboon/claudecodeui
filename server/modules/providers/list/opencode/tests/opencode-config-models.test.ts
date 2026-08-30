import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  readConfiguredOpenCodeModels,
  resetOpenCodeConfigModelCache,
} from '@/modules/providers/list/opencode/opencode-config-models.js';

/**
 * Points the reader at a config file written for the test, so no OpenCode
 * installation is needed. `contents === null` leaves the path empty, which is
 * the "no config" case.
 */
async function withOpenCodeConfig(
  contents: string | null,
  runTest: () => Promise<void>,
): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-opencode-config-'));
  const file = path.join(directory, 'opencode.jsonc');
  if (contents !== null) {
    await fs.writeFile(file, contents, 'utf8');
  }

  const previousPath = process.env.OPENCODE_CONFIG;
  const previousFlag = process.env.CLOUDCLI_OPENCODE_CONFIG_MODELS;
  process.env.OPENCODE_CONFIG = file;
  delete process.env.CLOUDCLI_OPENCODE_CONFIG_MODELS;
  resetOpenCodeConfigModelCache();

  try {
    await runTest();
  } finally {
    resetOpenCodeConfigModelCache();
    if (previousPath === undefined) {
      delete process.env.OPENCODE_CONFIG;
    } else {
      process.env.OPENCODE_CONFIG = previousPath;
    }
    if (previousFlag === undefined) {
      delete process.env.CLOUDCLI_OPENCODE_CONFIG_MODELS;
    } else {
      process.env.CLOUDCLI_OPENCODE_CONFIG_MODELS = previousFlag;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('reads the configured models, prefixed by their provider', async () => {
  await withOpenCodeConfig(`{
    // A local Ollama reached over the OpenAI-compatible API.
    "provider": {
      "ollama": {
        "npm": "@ai-sdk/openai-compatible",
        "name": "Ollama (local)",
        "options": {
          // The // in this URL must survive comment stripping.
          "baseURL": "http://127.0.0.1:11434/v1",
          "apiKey": "ollama"
        },
        "models": {
          "qwen3.8:27b": { "name": "qwen3.8:27b (16.5 GB)" },
          "gpt-oss:20b": {},
        },
      },
    },
  }`, async () => {
    const models = await readConfiguredOpenCodeModels();

    assert.deepEqual(models, [
      {
        value: 'ollama/gpt-oss:20b',
        label: 'gpt-oss:20b',
        description: 'Ollama (local)',
        isCustom: false,
      },
      {
        value: 'ollama/qwen3.8:27b',
        label: 'qwen3.8:27b (16.5 GB)',
        description: 'Ollama (local)',
        isCustom: false,
      },
    ]);
  });
});

test('covers every configured provider, not just a local one', async () => {
  await withOpenCodeConfig(`{
    "provider": {
      "openrouter": { "models": { "z-ai/glm-5.2:free": { "name": "GLM 5.2 (free)" } } },
      "ollama": { "models": { "gemma4:26b": {} } }
    }
  }`, async () => {
    const models = await readConfiguredOpenCodeModels();

    assert.deepEqual(models.map((model) => model.value), [
      'ollama/gemma4:26b',
      'openrouter/z-ai/glm-5.2:free',
    ]);
    assert.equal(models[1].description, 'openrouter');
  });
});

test('yields nothing when there is no config, and nothing when it is broken', async () => {
  await withOpenCodeConfig(null, async () => {
    assert.deepEqual(await readConfiguredOpenCodeModels(), []);
  });

  await withOpenCodeConfig('{ "provider": { "ollama": ', async () => {
    assert.deepEqual(await readConfiguredOpenCodeModels(), []);
  });
});

test('yields nothing for a config without models', async () => {
  await withOpenCodeConfig('{ "model": "openrouter/z-ai/glm-5.2:free" }', async () => {
    assert.deepEqual(await readConfiguredOpenCodeModels(), []);
  });
});

test('stays out of the way when reading the config is switched off', async () => {
  await withOpenCodeConfig('{ "provider": { "ollama": { "models": { "gpt-oss:20b": {} } } } }', async () => {
    process.env.CLOUDCLI_OPENCODE_CONFIG_MODELS = '0';
    resetOpenCodeConfigModelCache();

    assert.deepEqual(await readConfiguredOpenCodeModels(), []);
  });
});
