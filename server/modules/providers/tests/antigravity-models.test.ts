import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ANTIGRAVITY_FALLBACK_MODELS,
  AntigravityProviderModels,
  parseAntigravityModelsStdout,
} from '@/modules/providers/list/antigravity/antigravity-models.provider.js';

test('parseAntigravityModelsStdout converts agy model lines to model options', () => {
  const models = parseAntigravityModelsStdout(`
gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)
claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)

legacy-model
`);

  assert.equal(models.DEFAULT, 'gemini-3.8-flash-medium');
  assert.deepEqual(models.OPTIONS, [
    {
      value: 'gemini-3.8-flash-medium',
      label: 'Gemini 3.8 Flash (Medium)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6 (Thinking)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'legacy-model',
      label: 'legacy-model',
      description: 'Antigravity CLI model',
    },
  ]);
});

test('parseAntigravityModelsStdout falls back when agy returns no models', () => {
  assert.deepEqual(parseAntigravityModelsStdout(''), ANTIGRAVITY_FALLBACK_MODELS);
});

test('Antigravity model discovery uses AGY_CLI_PATH', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-models-'));
  const executablePath = path.join(tempRoot, process.platform === 'win32' ? 'agy.cmd' : 'agy');
  const previousPath = process.env.AGY_CLI_PATH;

  try {
    if (process.platform === 'win32') {
      await writeFile(executablePath, '@echo custom-model\\tCustom Model\r\n', 'utf8');
    } else {
      await writeFile(executablePath, '#!/bin/sh\nprintf "custom-model\\tCustom Model\\n"\n', 'utf8');
      await chmod(executablePath, 0o755);
    }
    process.env.AGY_CLI_PATH = executablePath;

    const models = await new AntigravityProviderModels().getSupportedModels();
    assert.equal(models.DEFAULT, 'custom-model');
    assert.deepEqual(models.OPTIONS[0], {
      value: 'custom-model',
      label: 'Custom Model',
      description: 'Antigravity CLI model',
    });
  } finally {
    if (previousPath === undefined) {
      delete process.env.AGY_CLI_PATH;
    } else {
      process.env.AGY_CLI_PATH = previousPath;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});
