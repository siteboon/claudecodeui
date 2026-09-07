import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ProviderModelsDefinition } from '@/shared/types.js';
import {
  CodexProviderModels,
  CODEX_PREDEFINED_MODELS,
} from '@/modules/providers/list/codex/codex-models.provider.js';

const makeAdapter = async (): Promise<{
  adapter: CodexProviderModels;
  homeDir: string;
  configPath: string;
}> => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'codex-models-'));
  const configPath = path.join(homeDir, 'config.toml');
  const adapter = new CodexProviderModels({ configPath });
  return { adapter, homeDir, configPath };
};

const writeConfig = async (configPath: string, config: string): Promise<void> => {
  await writeFile(configPath, config, 'utf8');
};

const writeCatalog = async (homeDir: string, models: unknown[]): Promise<string> => {
  const catalogPath = path.join(homeDir, 'models-catalog.json');
  await writeFile(catalogPath, JSON.stringify({ models }), 'utf8');
  return catalogPath;
};

const catalogConfig = (catalogPath: string, model?: string): string => {
  const modelLine = model ? 'model = "' + model + '"\n' : '';
  return modelLine + 'model_catalog_json = "' + catalogPath + '"\n';
};

const runWithDir = async (
  build: (ctx: { homeDir: string; configPath: string }) => Promise<void>,
  assertModels: (models: ProviderModelsDefinition) => Promise<void> | void,
): Promise<void> => {
  const { adapter, homeDir, configPath } = await makeAdapter();
  try {
    await build({ homeDir, configPath });
    await assertModels(await adapter.getSupportedModels());
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
};

test('Codex models fall back to the curated catalog when config.toml is missing', async () => {
  await runWithDir(async () => undefined, async (models) => {
    assert.deepEqual(models, CODEX_PREDEFINED_MODELS);
  });
});

test('Codex models fall back to the curated catalog when no model_catalog_json is set', async () => {
  await runWithDir(async ({ configPath }) => {
    await writeConfig(configPath, 'model = "gpt-5.6-sol"\n');
  }, async (models) => {
    assert.deepEqual(models, CODEX_PREDEFINED_MODELS);
  });
});

test('Codex models fall back to the curated catalog when config.toml is malformed', async () => {
  await runWithDir(async ({ configPath }) => {
    await writeConfig(configPath, 'model = = definitely not toml\n');
  }, async (models) => {
    assert.deepEqual(models, CODEX_PREDEFINED_MODELS);
  });
});

test('Codex models fall back when the catalog file is missing or unusable', async () => {
  const cases: Array<{
    name: string;
    build: (ctx: { homeDir: string; configPath: string }) => Promise<void>;
  }> = [
    {
      name: 'missing catalog file',
      build: async ({ homeDir, configPath }) => {
        await writeConfig(configPath, catalogConfig(path.join(homeDir, 'missing.json')));
      },
    },
    {
      name: 'catalog file is not valid JSON',
      build: async ({ homeDir, configPath }) => {
        await writeFile(path.join(homeDir, 'broken.json'), 'not json {', 'utf8');
        await writeConfig(configPath, catalogConfig(path.join(homeDir, 'broken.json')));
      },
    },
    {
      name: 'catalog root has no models array',
      build: async ({ homeDir, configPath }) => {
        await writeFile(path.join(homeDir, 'broken.json'), JSON.stringify({ versions: [] }), 'utf8');
        await writeConfig(configPath, catalogConfig(path.join(homeDir, 'broken.json')));
      },
    },
    {
      name: 'catalog models array is empty',
      build: async ({ homeDir, configPath }) => {
        const catalogPath = await writeCatalog(homeDir, []);
        await writeConfig(configPath, catalogConfig(catalogPath));
      },
    },
  ];

  for (const entry of cases) {
    await test(entry.name, async () => {
      await runWithDir(entry.build, async (models) => {
        assert.deepEqual(models, CODEX_PREDEFINED_MODELS);
      });
    });
  }
});

test('Codex models serve the model_catalog_json entries with their metadata', async () => {
  await runWithDir(async ({ homeDir, configPath }) => {
    const catalogPath = await writeCatalog(homeDir, [
      {
        slug: 'deepseek/deepseek-v4-flash',
        display_name: 'DeepSeek V4 Flash',
        description: 'Fast open-weights coding model.',
        default_reasoning_level: 'medium',
        supported_reasoning_levels: [
          { effort: 'low', description: 'Fast responses' },
          { effort: 'medium' },
        ],
        visibility: 'list',
      },
      {
        slug: 'internal/do-not-show',
        display_name: 'Internal',
        visibility: 'hide',
      },
      {
        slug: 'internal/not-for-picker',
        display_name: 'Not For Picker',
        visibility: 'none',
      },
      {
        slug: '',
        display_name: 'Missing slug',
      },
      {
        slug: 'deepseek/deepseek-v4-flash',
        display_name: 'Duplicate slug',
      },
    ]);
    await writeConfig(configPath, catalogConfig(catalogPath, 'deepseek/deepseek-v4-flash'));
  }, async (models) => {
    assert.deepEqual(models, {
      OPTIONS: [
        {
          value: 'deepseek/deepseek-v4-flash',
          label: 'DeepSeek V4 Flash',
          description: 'Fast open-weights coding model.',
          effort: {
            default: 'medium',
            values: [
              { value: 'low', description: 'Fast responses' },
              { value: 'medium' },
            ],
          },
        },
      ],
      DEFAULT: 'deepseek/deepseek-v4-flash',
    });
  });
});

test('Codex models keep the curated default when the catalog lists it and config.model is unset', async () => {
  await runWithDir(async ({ homeDir, configPath }) => {
    const catalogPath = await writeCatalog(homeDir, [
      { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6 Sol' },
      { slug: 'third-party/model', display_name: 'Third-Party Model' },
    ]);
    await writeConfig(configPath, catalogConfig(catalogPath));
  }, async (models) => {
    assert.equal(models.DEFAULT, 'gpt-5.6-sol');
    assert.deepEqual(models.OPTIONS.map((option) => option.value), [
      'gpt-5.6-sol',
      'third-party/model',
    ]);
  });
});

test('Codex models append config.model when the catalog omits it and make it the default', async () => {
  await runWithDir(async ({ homeDir, configPath }) => {
    const catalogPath = await writeCatalog(homeDir, [
      { slug: 'provider/alpha', display_name: 'Alpha' },
    ]);
    await writeConfig(configPath, catalogConfig(catalogPath, 'provider/custom-default'));
  }, async (models) => {
    assert.deepEqual(models.OPTIONS.map((option) => option.value), [
      'provider/alpha',
      'provider/custom-default',
    ]);
    assert.equal(models.DEFAULT, 'provider/custom-default');
  });
});

test('Codex models use the first catalog entry as the default when no better candidate exists', async () => {
  await runWithDir(async ({ homeDir, configPath }) => {
    const catalogPath = await writeCatalog(homeDir, [
      { slug: 'provider/first', display_name: 'First' },
      { slug: 'provider/second', display_name: 'Second' },
    ]);
    await writeConfig(configPath, catalogConfig(catalogPath));
  }, async (models) => {
    assert.equal(models.DEFAULT, 'provider/first');
  });
});
