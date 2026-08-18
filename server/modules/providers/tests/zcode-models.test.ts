import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
  ZCodeProviderModels,
  readZCodeSessionModelFromDb,
  resolveZCodeModelRef,
} from '@/modules/providers/list/zcode/zcode-models.provider.js';

/** Redirects ZCODE_STORAGE_DIR to a temp dir for fixture isolation. */
const withZCodeStorage = async (runTest: (storageDir: string) => Promise<void>): Promise<void> => {
  const previous = process.env.ZCODE_STORAGE_DIR;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'zcode-models-'));
  process.env.ZCODE_STORAGE_DIR = tempDir;

  try {
    await runTest(tempDir);
  } finally {
    if (previous === undefined) {
      delete process.env.ZCODE_STORAGE_DIR;
    } else {
      process.env.ZCODE_STORAGE_DIR = previous;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
};

test('getSupportedModels falls back to the builtin catalog without a config', async () => {
  await withZCodeStorage(async () => {
    const models = new ZCodeProviderModels();
    const definition = await models.getSupportedModels();

    assert.equal(definition.DEFAULT, 'GLM-5.3');
    assert.equal(definition.OPTIONS[0].value, 'GLM-5.3');
    assert.deepEqual(
      definition.OPTIONS[0].effort?.values.map((value) => value.value),
      ['low', 'high', 'max']
    );
  });
});

test('getSupportedModels parses the v2 config provider catalog', async () => {
  await withZCodeStorage(async (storageDir) => {
    const v2Dir = path.join(storageDir, 'v2');
    await mkdir(v2Dir, { recursive: true });
    await writeFile(
      path.join(v2Dir, 'config.json'),
      JSON.stringify({
        provider: {
          'builtin:bigmodel-coding-plan': {
            kind: 'anthropic',
            models: {
              'GLM-5.3': {
                reasoning: { variants: ['max', 'low'] },
                limit: { context: 1000000, output: 128000 },
              },
            },
          },
        },
      }),
      'utf8'
    );

    const models = new ZCodeProviderModels();
    const definition = await models.getSupportedModels();

    assert.equal(definition.OPTIONS.length, 1);
    assert.equal(definition.DEFAULT, 'GLM-5.3');
    assert.equal(definition.OPTIONS[0].description, 'ZCode model with 1000K context, 128K output');
    // Variants are normalized to sorted effort values.
    assert.deepEqual(
      definition.OPTIONS[0].effort?.values.map((value) => value.value),
      ['low', 'max']
    );
  });
});

test('readZCodeSessionModelFromDb returns the latest message model', async () => {
  await withZCodeStorage(async (storageDir) => {
    const dbDir = path.join(storageDir, 'cli', 'db');
    await mkdir(dbDir, { recursive: true });

    const db = new Database(path.join(dbDir, 'db.sqlite'));
    try {
      db.exec(`
        CREATE TABLE message (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL,
          data TEXT NOT NULL,
          sequence INTEGER
        );
      `);
      const insert = db.prepare(
        'INSERT INTO message (id, session_id, time_created, time_updated, data, sequence) VALUES (?, ?, ?, ?, ?, ?)'
      );
      insert.run('m1', 'sess_m', 1000, 1000, JSON.stringify({ role: 'user' }), 0);
      insert.run('m2', 'sess_m', 2000, 2000, JSON.stringify({ role: 'assistant', modelID: 'GLM-4.7' }), 1);
    } finally {
      db.close();
    }

    assert.equal(readZCodeSessionModelFromDb('sess_m'), 'GLM-4.7');
    assert.equal(readZCodeSessionModelFromDb('sess_unknown'), null);
  });
});

test('readZCodeSessionModelFromDb returns null without a database', async () => {
  await withZCodeStorage(async () => {
    assert.equal(readZCodeSessionModelFromDb('sess_any'), null);
  });
});

test('resolveZCodeModelRef parses full ref and bare model key', async () => {
  // Case 1: Full ref with slash
  const full = resolveZCodeModelRef('builtin:zai/GLM-5.3');
  assert.deepEqual(full, {
    providerId: 'builtin:zai',
    modelId: 'GLM-5.3',
  });

  // Case 2: Bare model with config
  await withZCodeStorage(async (storageDir) => {
    const v2Dir = path.join(storageDir, 'v2');
    await mkdir(v2Dir, { recursive: true });
    await writeFile(
      path.join(v2Dir, 'config.json'),
      JSON.stringify({
        provider: {
          'builtin:custom-provider': {
            enabled: true,
            models: {
              'GLM-5.3': {},
            },
          },
        },
      }),
      'utf8'
    );

    const resolved = resolveZCodeModelRef('GLM-5.3');
    assert.deepEqual(resolved, {
      providerId: 'builtin:custom-provider',
      modelId: 'GLM-5.3',
    });
  });
});

