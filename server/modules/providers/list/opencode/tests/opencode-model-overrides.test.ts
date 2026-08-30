import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getOverridesEnv,
  readModelOverrides,
  writeModelOverride,
} from '@/modules/providers/list/opencode/opencode-model-overrides.js';
import {
  readModelCapabilities,
  resetModelCapabilityCache,
} from '@/modules/providers/list/opencode/opencode-model-capabilities.js';

/** Runs the test against an overrides file and catalog of its own. */
async function withTempEnvironment(
  catalog: unknown | null,
  runTest: (paths: { overrides: string; directory: string }) => Promise<void>,
): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-opencode-settings-'));
  const overrides = path.join(directory, 'opencode-overrides.json');
  const catalogPath = path.join(directory, 'models.json');
  if (catalog !== null) {
    await fs.writeFile(catalogPath, JSON.stringify(catalog), 'utf8');
  }

  const previous = {
    overrides: process.env.CLOUDCLI_OPENCODE_OVERRIDES,
    catalog: process.env.CLOUDCLI_OPENCODE_CATALOG,
    userConfig: process.env.OPENCODE_CONFIG,
  };
  process.env.CLOUDCLI_OPENCODE_OVERRIDES = overrides;
  process.env.CLOUDCLI_OPENCODE_CATALOG = catalogPath;
  delete process.env.OPENCODE_CONFIG;
  resetModelCapabilityCache();

  const restore = (name: 'CLOUDCLI_OPENCODE_OVERRIDES' | 'CLOUDCLI_OPENCODE_CATALOG' | 'OPENCODE_CONFIG', value?: string) => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  };

  try {
    await runTest({ overrides, directory });
  } finally {
    resetModelCapabilityCache();
    restore('CLOUDCLI_OPENCODE_OVERRIDES', previous.overrides);
    restore('CLOUDCLI_OPENCODE_CATALOG', previous.catalog);
    restore('OPENCODE_CONFIG', previous.userConfig);
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('writes the shape OpenCode merges: options for sampling, limit for the answer', async () => {
  await withTempEnvironment(null, async ({ overrides }) => {
    await writeModelOverride('ollama/qwen3.8:27b', { temperature: 0.2, topP: 0.9, maxOutput: 4096 });

    const written = JSON.parse(await fs.readFile(overrides, 'utf8'));
    assert.deepEqual(written, {
      provider: {
        ollama: {
          models: {
            'qwen3.8:27b': {
              options: { temperature: 0.2, top_p: 0.9 },
              limit: { output: 4096 },
            },
          },
        },
      },
    });

    assert.deepEqual(await readModelOverrides(), {
      'ollama/qwen3.8:27b': { temperature: 0.2, topP: 0.9, maxOutput: 4096 },
    });
  });
});

test('a model id may contain a slash of its own', async () => {
  await withTempEnvironment(null, async () => {
    await writeModelOverride('openrouter/z-ai/glm-5.2:free', { temperature: 0.5 });

    assert.deepEqual(await readModelOverrides(), {
      'openrouter/z-ai/glm-5.2:free': { temperature: 0.5 },
    });
  });
});

test('clearing a field removes it, and the last one takes the model with it', async () => {
  await withTempEnvironment(null, async ({ overrides }) => {
    await writeModelOverride('ollama/gpt-oss:20b', { temperature: 0.3, maxOutput: 2048 });
    await writeModelOverride('ollama/gpt-oss:20b', { maxOutput: 2048 });

    assert.deepEqual(await readModelOverrides(), {
      'ollama/gpt-oss:20b': { maxOutput: 2048 },
    });

    await writeModelOverride('ollama/gpt-oss:20b', {});

    assert.deepEqual(await readModelOverrides(), {});
    // The empty provider goes as well, so the file does not collect husks.
    assert.deepEqual(JSON.parse(await fs.readFile(overrides, 'utf8')), { provider: {} });
  });
});

test('overrides of other models survive a write', async () => {
  await withTempEnvironment(null, async () => {
    await writeModelOverride('ollama/gpt-oss:20b', { temperature: 0.3 });
    await writeModelOverride('ollama/qwen3.8:27b', { temperature: 0.7 });

    assert.deepEqual(await readModelOverrides(), {
      'ollama/gpt-oss:20b': { temperature: 0.3 },
      'ollama/qwen3.8:27b': { temperature: 0.7 },
    });
  });
});

test('the overlay is only handed over when the user did not set OPENCODE_CONFIG', async () => {
  await withTempEnvironment(null, async ({ overrides }) => {
    // Nothing written yet: nothing to hand over.
    assert.deepEqual(await getOverridesEnv(), {});

    await writeModelOverride('ollama/gpt-oss:20b', { temperature: 0.3 });
    assert.deepEqual(await getOverridesEnv(), { OPENCODE_CONFIG: overrides });

    process.env.OPENCODE_CONFIG = 'C:/eigene/config.json';
    assert.deepEqual(await getOverridesEnv(), {});
  });
});

test('capabilities come per model, and an unknown model has none', async () => {
  await withTempEnvironment({
    anthropic: {
      models: {
        'claude-opus-4-8': { temperature: false, reasoning: true, limit: { context: 1000000, output: 128000 } },
      },
    },
    openai: {
      models: { 'gpt-4o': { temperature: true, reasoning: false, limit: { context: 128000, output: 16384 } } },
    },
  }, async () => {
    const capabilities = await readModelCapabilities([
      'anthropic/claude-opus-4-8',
      'openai/gpt-4o',
      'ollama/qwen3.8:27b',
    ]);

    assert.equal(capabilities['anthropic/claude-opus-4-8'].temperature, false);
    assert.equal(capabilities['anthropic/claude-opus-4-8'].maxOutput, 128000);
    assert.equal(capabilities['openai/gpt-4o'].temperature, true);
    // Not in the catalog - a local model, for instance.
    assert.equal(capabilities['ollama/qwen3.8:27b'], undefined);
  });
});

test('a missing catalog is not an error', async () => {
  await withTempEnvironment(null, async () => {
    assert.deepEqual(await readModelCapabilities(['openai/gpt-4o']), {});
  });
});
