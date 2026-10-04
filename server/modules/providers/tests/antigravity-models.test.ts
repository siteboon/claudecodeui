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

test('fallback catalog includes every model family reported for Free and Plus accounts', () => {
  const ids = new Set(ANTIGRAVITY_FALLBACK_MODELS.OPTIONS.map((model) => model.value));
  for (const version of ['3.8', '3.7', '3.6']) {
    for (const effort of ['high', 'medium', 'low']) {
      assert.ok(ids.has(`gemini-${version}-flash-${effort}`));
    }
  }
  for (const id of ['gemini-3.1-pro-high', 'gemini-3.1-pro-low',
    'claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium']) {
    assert.ok(ids.has(id));
  }
});

test('live subscription catalogs are queried again after an account change', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-account-models-'));
  const executablePath = path.join(tempRoot, process.platform === 'win32' ? 'agy.cmd' : 'agy');
  const catalogPath = path.join(tempRoot, 'models.txt');
  const previousPath = process.env.AGY_CLI_PATH;

  try {
    if (process.platform === 'win32') {
      await writeFile(executablePath, '@echo off\r\ntype "%~dp0models.txt"\r\n', 'utf8');
    } else {
      await writeFile(executablePath, '#!/bin/sh\ncat "$(dirname "$0")/models.txt"\n', 'utf8');
      await chmod(executablePath, 0o755);
    }
    process.env.AGY_CLI_PATH = executablePath;
    const adapter = new AntigravityProviderModels();
    await writeFile(catalogPath, 'gemini-3.7-flash-low\tGemini 3.7 Flash (Low)\n', 'utf8');
    assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map((model) => model.value),
      ['gemini-3.7-flash-low']);

    await writeFile(catalogPath, 'claude-sonnet-5-5\tClaude Sonnet 5.5 (Thinking)\n'
      + 'claude-opus-5-5-thinking\tClaude Opus 5.5 (Thinking)\n', 'utf8');
    const subscribed = await adapter.getSupportedModels();
    assert.equal(subscribed.DEFAULT, 'claude-sonnet-5-5');
    assert.deepEqual(subscribed.OPTIONS.map((model) => model.value),
      ['claude-sonnet-5-5', 'claude-opus-5-5-thinking']);

    await writeFile(catalogPath, 'gemini-3.6-flash-medium\tGemini 3.6 Flash (Medium)\n', 'utf8');
    assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map((model) => model.value),
      ['gemini-3.6-flash-medium']);
  } finally {
    if (previousPath === undefined) delete process.env.AGY_CLI_PATH;
    else process.env.AGY_CLI_PATH = previousPath;
    await rm(tempRoot, { recursive: true, force: true });
  }
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
