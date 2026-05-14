import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createProviderModelsService,
  PROVIDER_MODELS_CACHE_TTL_MS,
} from '@/modules/providers/services/provider-models.service.js';
import type { LLMProvider, ProviderModelsDefinition } from '@/shared/types.js';

const createModels = (value: string): ProviderModelsDefinition => ({
  OPTIONS: [{ value, label: value }],
  DEFAULT: value,
});

test('provider models are cached for the two-day ttl', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-cache-ttl-'));
  let currentTime = 1_000;
  let loadCount = 0;

  try {
    const service = createProviderModelsService({
      cachePath: path.join(tempRoot, 'models-cache.json'),
      now: () => currentTime,
      loadModels: async (provider: LLMProvider) => {
        loadCount += 1;
        return createModels(`${provider}-${loadCount}`);
      },
    });

    const first = await service.getProviderModels('codex');
    const cached = await service.getProviderModels('codex');
    assert.equal(loadCount, 1);
    assert.equal(cached.DEFAULT, first.DEFAULT);

    currentTime += PROVIDER_MODELS_CACHE_TTL_MS - 1;
    await service.getProviderModels('codex');
    assert.equal(loadCount, 1);

    currentTime += 2;
    const refreshed = await service.getProviderModels('codex');
    assert.equal(loadCount, 2);
    assert.equal(refreshed.DEFAULT, 'codex-2');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('provider model cache is persisted across service instances', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-cache-file-'));
  const cachePath = path.join(tempRoot, 'models-cache.json');

  try {
    const writer = createProviderModelsService({
      cachePath,
      loadModels: async () => createModels('gemini-cached'),
    });
    await writer.getProviderModels('gemini');

    const reader = createProviderModelsService({
      cachePath,
      loadModels: async () => {
        throw new Error('loader should not be called for persisted cache hits');
      },
    });
    const models = await reader.getProviderModels('gemini');
    assert.equal(models.DEFAULT, 'gemini-cached');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('concurrent provider model requests share one load operation', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-cache-pending-'));
  let loadCount = 0;

  try {
    const service = createProviderModelsService({
      cachePath: path.join(tempRoot, 'models-cache.json'),
      loadModels: async () => {
        loadCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return createModels('claude-cached');
      },
    });

    const [first, second] = await Promise.all([
      service.getProviderModels('claude'),
      service.getProviderModels('claude'),
    ]);

    assert.equal(loadCount, 1);
    assert.equal(first.DEFAULT, 'claude-cached');
    assert.equal(second.DEFAULT, 'claude-cached');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('opencode model cache is scoped by workspace cwd', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-cache-opencode-'));
  const workspaceA = path.join(tempRoot, 'workspace-a');
  const workspaceB = path.join(tempRoot, 'workspace-b');
  let loadCount = 0;

  try {
    await mkdir(workspaceA, { recursive: true });
    await mkdir(workspaceB, { recursive: true });

    const service = createProviderModelsService({
      cachePath: path.join(tempRoot, 'models-cache.json'),
      loadModels: async () => {
        loadCount += 1;
        return createModels(`opencode-${loadCount}`);
      },
    });

    await service.getProviderModels('opencode', { cwd: workspaceA });
    await service.getProviderModels('opencode', { cwd: workspaceA });
    await service.getProviderModels('opencode', { cwd: workspaceB });

    assert.equal(loadCount, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
