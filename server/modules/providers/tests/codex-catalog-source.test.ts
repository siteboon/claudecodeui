import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CodexProviderModels } from '@/modules/providers/list/codex/codex-models.provider.js';

const writeConfig = async (configPath: string, config: string): Promise<void> => {
  await writeFile(configPath, config, 'utf8');
};

const catalogLine = (homeDir: string, models: unknown[]): Promise<string> => {
  const catalogPath = path.join(homeDir, 'models-catalog.json');
  return writeFile(catalogPath, JSON.stringify({ models }), 'utf8').then(() => catalogPath);
};

const makeAdapter = async (config: string | null) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'codex-catalog-source-'));
  const configPath = path.join(homeDir, 'config.toml');
  if (config !== null) {
    await writeConfig(configPath, config);
  }
  return { adapter: new CodexProviderModels({ configPath }), homeDir };
};

test('Codex external catalog is null when config or catalog is unusable', async () => {
  const cases: Array<{ name: string; config: string | null; setup?: string }> = [
    { name: 'no config file', config: null },
    { name: 'no model_catalog_json key', config: 'model = "gpt-5.6-sol"\n' },
    { name: 'catalog file missing', config: 'model_catalog_json = "/no/such/catalog.json"\n' },
    { name: 'catalog is not valid JSON', config: '' },
    { name: 'catalog has no models array', config: '' },
    { name: 'catalog lists no visible models', config: '' },
  ];
  for (const entry of cases) {
    await test(entry.name, async () => {
      const { adapter, homeDir } = await makeAdapter(entry.config);
      try {
        if (entry.name === 'catalog is not valid JSON') {
          await writeFile(path.join(homeDir, 'catalog.json'), 'not json {', 'utf8');
          await writeConfig(path.join(homeDir, 'config.toml'), 'model_catalog_json = "' + path.join(homeDir, 'catalog.json') + '"\n');
        } else if (entry.name === 'catalog has no models array') {
          const catalogPath = path.join(homeDir, 'catalog.json');
          await writeFile(catalogPath, JSON.stringify({ versions: [] }), 'utf8');
          await writeConfig(path.join(homeDir, 'config.toml'), 'model_catalog_json = "' + catalogPath + '"\n');
        } else if (entry.name === 'catalog lists no visible models') {
          const catalogPath = await catalogLine(homeDir, [
            { slug: 'vendor/hidden', visibility: 'hide' },
            { slug: 'vendor/none', visibility: 'none' },
            { slug: 'vendor/missing-visibility' },
          ]);
          await writeConfig(path.join(homeDir, 'config.toml'), 'model_catalog_json = "' + catalogPath + '"\n');
        }
        assert.equal(await adapter.readExternalCatalog(), null);
      } finally {
        await rm(homeDir, { recursive: true, force: true });
      }
    });
  }
});

test('Codex external catalog lists only picker-visible entries with metadata', async () => {
  const { adapter, homeDir } = await makeAdapter(null);
  try {
    const catalogPath = await catalogLine(homeDir, [
      {
        slug: 'vendor/alpha',
        display_name: 'Alpha Model',
        description: 'A listed model',
        default_reasoning_level: 'medium',
        supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium', description: 'Default' }],
        visibility: 'list',
      },
      { slug: 'vendor/dup', visibility: 'list' },
      { slug: 'vendor/dup', visibility: 'list' },
      { slug: 'vendor/hidden', visibility: 'hide' },
      { slug: 'vendor/none', visibility: 'none' },
      { slug: 'vendor/undeclared' },
    ]);
    await writeConfig(path.join(homeDir, 'config.toml'), 'model_catalog_json = "' + catalogPath + '"\n');

    const models = await adapter.readExternalCatalog();
    assert.deepEqual(models?.OPTIONS, [
      {
        value: 'vendor/alpha',
        label: 'Alpha Model',
        description: 'A listed model',
        effort: {
          default: 'medium',
          values: [{ value: 'low' }, { value: 'medium', description: 'Default' }],
        },
      },
      { value: 'vendor/dup', label: 'vendor/dup' },
    ]);
    assert.equal(models?.DEFAULT, 'vendor/alpha');
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('Codex external catalog keeps a configured default out of OPTIONS when it is not list-visible', async () => {
  const { adapter, homeDir } = await makeAdapter(null);
  try {
    const catalogPath = await catalogLine(homeDir, [
      { slug: 'vendor/alpha', visibility: 'list' },
      { slug: 'vendor/hidden-default', visibility: 'hide' },
    ]);
    const config = 'model = "vendor/hidden-default"'
      + String.fromCharCode(10)
      + 'model_catalog_json = "' + catalogPath + '"';
    await writeConfig(path.join(homeDir, 'config.toml'), config);

    const models = await adapter.readExternalCatalog();
    assert.deepEqual(models?.OPTIONS.map((option) => option.value), ['vendor/alpha']);
    assert.equal(models?.DEFAULT, 'vendor/hidden-default');
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
