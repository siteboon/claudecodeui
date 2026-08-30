import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  readConfiguredModelContextLimits,
  readConfiguredOpenCodeModels,
  resetOpenCodeConfigModelCache,
} from '@/modules/providers/list/opencode/opencode-config-models.js';

type Files = {
  /** `<config home>/opencode/opencode.jsonc` */
  jsonc?: string;
  /** `<config home>/opencode/opencode.json` */
  json?: string;
  /** A file pointed at by `OPENCODE_CONFIG`. */
  explicit?: string;
};

/**
 * Runs the reader against config files written for the test.
 *
 * `XDG_CONFIG_HOME` is always redirected, so a real OpenCode installation on
 * the machine running the tests cannot leak into the result.
 */
async function withOpenCodeConfig(files: Files, runTest: () => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-opencode-config-'));
  const directory = path.join(root, 'opencode');
  await fs.mkdir(directory, { recursive: true });

  if (files.jsonc !== undefined) {
    await fs.writeFile(path.join(directory, 'opencode.jsonc'), files.jsonc, 'utf8');
  }
  if (files.json !== undefined) {
    await fs.writeFile(path.join(directory, 'opencode.json'), files.json, 'utf8');
  }

  const explicitPath = path.join(root, 'explicit.json');
  if (files.explicit !== undefined) {
    await fs.writeFile(explicitPath, files.explicit, 'utf8');
  }

  const previous = {
    configHome: process.env.XDG_CONFIG_HOME,
    explicit: process.env.OPENCODE_CONFIG,
    flag: process.env.CLOUDCLI_OPENCODE_CONFIG_MODELS,
  };
  process.env.XDG_CONFIG_HOME = root;
  if (files.explicit === undefined) {
    delete process.env.OPENCODE_CONFIG;
  } else {
    process.env.OPENCODE_CONFIG = explicitPath;
  }
  delete process.env.CLOUDCLI_OPENCODE_CONFIG_MODELS;
  resetOpenCodeConfigModelCache();

  const restore = (name: 'XDG_CONFIG_HOME' | 'OPENCODE_CONFIG' | 'CLOUDCLI_OPENCODE_CONFIG_MODELS', value?: string) => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  };

  try {
    await runTest();
  } finally {
    resetOpenCodeConfigModelCache();
    restore('XDG_CONFIG_HOME', previous.configHome);
    restore('OPENCODE_CONFIG', previous.explicit);
    restore('CLOUDCLI_OPENCODE_CONFIG_MODELS', previous.flag);
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('reads the configured models, prefixed by their provider', async () => {
  await withOpenCodeConfig({
    jsonc: `{
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
    }`,
  }, async () => {
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
  await withOpenCodeConfig({
    jsonc: `{
      "provider": {
        "openrouter": { "models": { "z-ai/glm-5.2:free": { "name": "GLM 5.2 (free)" } } },
        "ollama": { "models": { "gemma4:26b": {} } }
      }
    }`,
  }, async () => {
    const models = await readConfiguredOpenCodeModels();

    assert.deepEqual(models.map((model) => model.value), [
      'ollama/gemma4:26b',
      'openrouter/z-ai/glm-5.2:free',
    ]);
    assert.equal(models[1].description, 'openrouter');
  });
});

test('merges every config file OpenCode reads, the explicit one last', async () => {
  // Measured against `opencode models`: json and jsonc side by side both
  // contribute, and OPENCODE_CONFIG adds to the global config rather than
  // replacing it.
  await withOpenCodeConfig({
    json: '{ "provider": { "a": { "models": { "from-json:1b": {} } } } }',
    jsonc: '{ "provider": { "b": { "models": { "from-jsonc:1b": {} } } } }',
    explicit: `{
      "provider": {
        "c": { "models": { "from-explicit:1b": {} } },
        "b": { "name": "wins", "models": { "from-jsonc:1b": { "name": "later read" } } }
      }
    }`,
  }, async () => {
    const models = await readConfiguredOpenCodeModels();

    assert.deepEqual(models.map((model) => model.value), [
      'a/from-json:1b',
      'b/from-jsonc:1b',
      'c/from-explicit:1b',
    ]);
    // The explicit file is read last, so its label is the one that survives.
    assert.equal(models[1].label, 'later read');
  });
});

test('keeps the other files when one of them is broken', async () => {
  await withOpenCodeConfig({
    json: '{ "provider": { "a": ',
    jsonc: '{ "provider": { "b": { "models": { "intact:1b": {} } } } }',
  }, async () => {
    const models = await readConfiguredOpenCodeModels();

    assert.deepEqual(models.map((model) => model.value), ['b/intact:1b']);
  });
});

test('yields nothing without a config, and nothing for a config without models', async () => {
  await withOpenCodeConfig({}, async () => {
    assert.deepEqual(await readConfiguredOpenCodeModels(), []);
  });

  await withOpenCodeConfig({ jsonc: '{ "model": "openrouter/z-ai/glm-5.2:free" }' }, async () => {
    assert.deepEqual(await readConfiguredOpenCodeModels(), []);
  });
});

test('stays out of the way when reading the config is switched off', async () => {
  await withOpenCodeConfig({
    jsonc: '{ "provider": { "ollama": { "models": { "gpt-oss:20b": {} } } } }',
  }, async () => {
    process.env.CLOUDCLI_OPENCODE_CONFIG_MODELS = '0';
    resetOpenCodeConfigModelCache();

    assert.deepEqual(await readConfiguredOpenCodeModels(), []);
  });
});

test('context windows follow read-last-wins, including a later entry that drops one', async () => {
  await withOpenCodeConfig({
    json: '{ "provider": { "ollama": { "models": { "keeps:8b": { "limit": { "context": 8192 } }, "loses:8b": { "limit": { "context": 4096 } } } } } }',
    explicit: `{
      "provider": {
        "ollama": {
          "models": {
            "keeps:8b": { "limit": { "context": 131072 } },
            "loses:8b": {}
          }
        }
      }
    }`,
  }, async () => {
    const limits = await readConfiguredModelContextLimits();

    // The explicit file is read last and raises this one.
    assert.equal(limits['ollama/keeps:8b'], 131072);
    // It also describes this model without a limit, so the earlier value is
    // gone rather than left standing for an entry that no longer states it.
    assert.equal('ollama/loses:8b' in limits, false);
  });
});
