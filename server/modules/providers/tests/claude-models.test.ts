import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ClaudeProviderModels,
  CLAUDE_FALLBACK_MODELS,
} from '@/modules/providers/list/claude/claude-models.provider.js';

// Cc-switch keeps the alias→real-model mapping on the *current* claude provider's
// settings_config.env. This helper builds a throwaway cc-switch.db at
// <tempHome>/.cc-switch/cc-switch.db and returns tempHome so the reader (which
// resolves the path from os.homedir()) finds it once homedir is monkeypatched.
const createCcSwitchDbUnderHome = async (
  settingsConfig: Record<string, unknown>,
): Promise<string> => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'ccswitch-home-'));
  await mkdir(path.join(tempHome, '.cc-switch'), { recursive: true });
  const dbPath = path.join(tempHome, '.cc-switch', 'cc-switch.db');
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE providers (
      id TEXT NOT NULL,
      app_type TEXT NOT NULL,
      name TEXT NOT NULL,
      settings_config TEXT NOT NULL,
      is_current BOOLEAN NOT NULL DEFAULT 0,
      PRIMARY KEY (id, app_type)
    );
  `);
  db.prepare(
    'INSERT INTO providers (id, app_type, name, settings_config, is_current) VALUES (?, ?, ?, ?, ?)',
  ).run(
    'test-current',
    'claude',
    'Test Provider',
    JSON.stringify(settingsConfig),
    1,
  );
  db.close();
  return tempHome;
};

const withHomedir = async <T>(tempHome: string, fn: () => Promise<T>): Promise<T> => {
  const originalHomedir = os.homedir;
  os.homedir = () => tempHome;
  try {
    return await fn();
  } finally {
    os.homedir = originalHomedir;
  }
};

// cc-switch integration is opt-in via CLAUDE_CC_SWITCH_MODELS_ENABLED. Tests that
// exercise it set the flag; the rest verify the static fallback is untouched.
const withCcSwitchEnabled = async <T>(fn: () => Promise<T>): Promise<T> => {
  const previous = process.env.CLAUDE_CC_SWITCH_MODELS_ENABLED;
  process.env.CLAUDE_CC_SWITCH_MODELS_ENABLED = 'true';
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_CC_SWITCH_MODELS_ENABLED;
    } else {
      process.env.CLAUDE_CC_SWITCH_MODELS_ENABLED = previous;
    }
  }
};

test('getSupportedModels returns cc-switch aliases with real model names when enabled', async () => {
  const tempHome = await createCcSwitchDbUnderHome({
    env: {
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'ark/GLM-5.2[1M]',
      ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'ark/GLM-5.2',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'ds/deepseek-v4-pro[1M]',
      ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: 'ds/deepseek-v4-pro',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'ds/deepseek-v4-flash',
      ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: 'ds/deepseek-v4-flash',
      ANTHROPIC_DEFAULT_FABLE_MODEL: 'ark/GLM-5.2[1M]',
      ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: 'ark/GLM-5.2',
    },
  });

  await withHomedir(tempHome, async () => {
    await withCcSwitchEnabled(async () => {
      const models = new ClaudeProviderModels();
      const result = await models.getSupportedModels();

      assert.equal(result.DEFAULT, 'default');
      const values = result.OPTIONS.map((option) => option.value);
      assert.deepEqual(values, ['default', 'opus', 'sonnet', 'haiku', 'fable']);

      const opus = result.OPTIONS.find((option) => option.value === 'opus');
      assert.equal(opus?.label, 'Opus · ark/GLM-5.2');
      const sonnet = result.OPTIONS.find((option) => option.value === 'sonnet');
      assert.equal(sonnet?.label, 'Sonnet · ds/deepseek-v4-pro');
    });
  });
});

test('getSupportedModels uses CLAUDE_CC_SWITCH_DB_PATH override', async () => {
  const tempHome = await createCcSwitchDbUnderHome({
    env: { ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'custom-opus' },
  });
  const customDbPath = path.join(tempHome, '.cc-switch', 'cc-switch.db');

  // Point homedir elsewhere so the default path would miss; the override must win.
  await withHomedir(path.join(os.tmpdir(), `other-home-${process.pid}`), async () => {
    process.env.CLAUDE_CC_SWITCH_DB_PATH = customDbPath;
    try {
      await withCcSwitchEnabled(async () => {
        const models = new ClaudeProviderModels();
        const result = await models.getSupportedModels();
        const opus = result.OPTIONS.find((option) => option.value === 'opus');
        assert.equal(opus?.label, 'Opus · custom-opus');
      });
    } finally {
      delete process.env.CLAUDE_CC_SWITCH_DB_PATH;
    }
  });
});

test('getSupportedModels falls back when cc-switch disabled (default)', async () => {
  const tempHome = await createCcSwitchDbUnderHome({
    env: { ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'ark/GLM-5.2' },
  });

  await withHomedir(tempHome, async () => {
    // Disabled by default — even with a valid DB present, the static list wins.
    delete process.env.CLAUDE_CC_SWITCH_MODELS_ENABLED;
    const models = new ClaudeProviderModels();
    const result = await models.getSupportedModels();
    assert.equal(result, CLAUDE_FALLBACK_MODELS);
  });
});

test('getSupportedModels falls back when no alias env is configured', async () => {
  const tempHome = await createCcSwitchDbUnderHome({ env: {} });

  await withHomedir(tempHome, async () => {
    await withCcSwitchEnabled(async () => {
      const models = new ClaudeProviderModels();
      const result = await models.getSupportedModels();
      assert.equal(result, CLAUDE_FALLBACK_MODELS);
    });
  });
});

test('getSupportedModels falls back when cc-switch db is missing', async () => {
  await withHomedir(path.join(os.tmpdir(), `no-ccswitch-${process.pid}`), async () => {
    await withCcSwitchEnabled(async () => {
      const models = new ClaudeProviderModels();
      const result = await models.getSupportedModels();
      assert.equal(result, CLAUDE_FALLBACK_MODELS);
    });
  });
});
