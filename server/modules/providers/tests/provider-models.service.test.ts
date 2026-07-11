import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createProviderModelsService,
  PROVIDER_MODELS_CACHE_TTL_MS,
} from '@/modules/providers/services/provider-models.service.js';
import type {
  ProviderChangeActiveModelInput,
  LLMProvider,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import {
  deleteProviderSessionActiveModelChanges,
  readProviderSessionActiveModelChange,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

const createModels = (value: string): ProviderModelsDefinition => ({
  OPTIONS: [{ value, label: value }],
  DEFAULT: value,
});

const createCurrentActiveModel = (model: string): ProviderCurrentActiveModel => ({
  model,
});

const createSessionActiveModelChange = (
  provider: LLMProvider,
  input: ProviderChangeActiveModelInput,
): ProviderSessionActiveModelChange => ({
  provider,
  sessionId: input.sessionId,
  supported: true,
  changed: true,
  model: input.model,
});

const createEphemeralCachePath = (): string => path.join(
  os.tmpdir(),
  `provider-model-cache-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
);

test('provider models service delegates to the resolved provider model adapter', async () => {
  const calls: LLMProvider[] = [];
  const service = createProviderModelsService({
    cachePath: createEphemeralCachePath(),
    resolveProvider: (provider) => {
      calls.push(provider);
      return {
        models: {
          getSupportedModels: async () => createModels(`${provider}-models`),
          getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      };
    },
  });

  const models = await service.getProviderModels('codex', { bypassCache: true });

  assert.deepEqual(calls, ['codex']);
  assert.equal(models.models.DEFAULT, 'codex-models');
  assert.equal(models.cache.source, 'fresh');
});

test('provider models service returns each provider adapter result without rewriting it', async () => {
  const expectedModels: ProviderModelsDefinition = {
    OPTIONS: [
      { value: 'cursor-a', label: 'Cursor A' },
      { value: 'cursor-b', label: 'Cursor B' },
    ],
    DEFAULT: 'cursor-b',
  };

  const service = createProviderModelsService({
    cachePath: createEphemeralCachePath(),
    resolveProvider: () => ({
      models: {
        getSupportedModels: async () => expectedModels,
        getCurrentActiveModel: async () => createCurrentActiveModel('cursor-active'),
        changeActiveModel: async (input) => createSessionActiveModelChange('cursor', input),
      },
    }),
  });

  const models = await service.getProviderModels('cursor', { bypassCache: true });

  assert.deepEqual(models.models, expectedModels);
});

test('provider models are cached for the three-day ttl', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-cache-ttl-'));
  let currentTime = 1_000;
  let loadCount = 0;

  try {
    const service = createProviderModelsService({
      cachePath: path.join(tempRoot, 'models-cache.json'),
      now: () => currentTime,
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => {
            loadCount += 1;
            return createModels(`${provider}-${loadCount}`);
          },
          getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    const first = await service.getProviderModels('codex');
    const cached = await service.getProviderModels('codex');
    assert.equal(loadCount, 1);
    assert.equal(cached.models.DEFAULT, first.models.DEFAULT);
    assert.equal(cached.cache.source, 'memory');

    currentTime += PROVIDER_MODELS_CACHE_TTL_MS - 1;
    await service.getProviderModels('codex');
    assert.equal(loadCount, 1);

    currentTime += 2;
    const refreshed = await service.getProviderModels('codex');
    assert.equal(loadCount, 2);
    assert.equal(refreshed.models.DEFAULT, 'codex-2');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('claude provider models are always loaded directly from the provider', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-cache-claude-direct-'));
  let loadCount = 0;

  try {
    const service = createProviderModelsService({
      cachePath: path.join(tempRoot, 'models-cache.json'),
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => {
            loadCount += 1;
            return createModels(`${provider}-${loadCount}`);
          },
          getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    const first = await service.getProviderModels('claude');
    const second = await service.getProviderModels('claude');

    assert.equal(loadCount, 2);
    assert.equal(first.models.DEFAULT, 'claude-1');
    assert.equal(second.models.DEFAULT, 'claude-2');
    assert.equal(second.cache.source, 'fresh');
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
      resolveProvider: () => ({
        models: {
          getSupportedModels: async () => createModels('cursor-cached'),
          getCurrentActiveModel: async () => createCurrentActiveModel('cursor-active'),
          changeActiveModel: async (input) => createSessionActiveModelChange('cursor', input),
        },
      }),
    });
    await writer.getProviderModels('cursor');

    const reader = createProviderModelsService({
      cachePath,
      resolveProvider: () => ({
        models: {
          getSupportedModels: async () => {
            throw new Error('loader should not be called for persisted cache hits');
          },
          getCurrentActiveModel: async () => createCurrentActiveModel('cursor-active'),
          changeActiveModel: async (input) => createSessionActiveModelChange('cursor', input),
        },
      }),
    });
    const models = await reader.getProviderModels('cursor');
    assert.equal(models.models.DEFAULT, 'cursor-cached');
    assert.equal(models.cache.source, 'disk');
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
      resolveProvider: () => ({
        models: {
          getSupportedModels: async () => {
            loadCount += 1;
            await new Promise((resolve) => setTimeout(resolve, 20));
            return createModels('claude-cached');
          },
          getCurrentActiveModel: async () => createCurrentActiveModel('claude-active'),
          changeActiveModel: async (input) => createSessionActiveModelChange('claude', input),
        },
      }),
    });

    const [first, second] = await Promise.all([
      service.getProviderModels('claude'),
      service.getProviderModels('claude'),
    ]);

    assert.equal(loadCount, 1);
    assert.equal(first.models.DEFAULT, 'claude-cached');
    assert.equal(second.models.DEFAULT, 'claude-cached');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('bypassCache forces a fresh provider fetch and updates cache metadata', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-cache-refresh-'));
  let currentTime = 1_000;
  let loadCount = 0;

  try {
    const service = createProviderModelsService({
      cachePath: path.join(tempRoot, 'models-cache.json'),
      now: () => currentTime,
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => {
            loadCount += 1;
            return createModels(`${provider}-${loadCount}`);
          },
          getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active-${loadCount}`),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    const first = await service.getProviderModels('claude');
    currentTime += 50;
    const refreshed = await service.getProviderModels('claude', { bypassCache: true });

    assert.equal(first.models.DEFAULT, 'claude-1');
    assert.equal(refreshed.models.DEFAULT, 'claude-2');
    assert.equal(refreshed.cache.source, 'fresh');
    assert.notEqual(refreshed.cache.updatedAt, first.cache.updatedAt);
    assert.equal(loadCount, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('provider models service delegates current active model lookups to the provider adapter', async () => {
  const calls: Array<{ provider: LLMProvider; sessionId?: string }> = [];
  const service = createProviderModelsService({
    resolveProvider: (provider) => ({
      models: {
        getSupportedModels: async () => createModels(`${provider}-models`),
        getCurrentActiveModel: async (sessionId) => {
          calls.push({ provider, sessionId });
          return createCurrentActiveModel(`${provider}-${sessionId}`);
        },
        changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
      },
    }),
  });

  const activeModel = await service.getCurrentActiveModel('opencode', 'session-123');

  assert.deepEqual(calls, [{ provider: 'opencode', sessionId: 'session-123' }]);
  assert.equal(activeModel.model, 'opencode-session-123');
});

test('getCurrentActiveModel surfaces a pending session model override before the adapter', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-active-model-'));
  const activeModelChangesPath = path.join(tempRoot, 'session-model-changes.json');

  try {
    let adapterCalls = 0;
    const service = createProviderModelsService({
      activeModelChangesPath,
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => createModels(`${provider}-models`),
          getCurrentActiveModel: async () => {
            adapterCalls += 1;
            return createCurrentActiveModel(`${provider}-active`);
          },
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    await writeProviderSessionActiveModelChange('claude', {
      sessionId: 'session-789',
      model: 'opus',
    }, {
      filePath: activeModelChangesPath,
    });

    // A pending override the user just picked wins over the provider's own
    // (still-stale) transcript until the next resumed turn consumes it.
    const overridden = await service.getCurrentActiveModel('claude', 'session-789');
    assert.equal(overridden.model, 'opus');
    assert.equal(adapterCalls, 0);

    // Sessions without a pending override fall back to the provider adapter.
    const fallback = await service.getCurrentActiveModel('claude', 'session-other');
    assert.equal(fallback.model, 'claude-active');
    assert.equal(adapterCalls, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('provider models service delegates active model change requests to the provider adapter', async () => {
  const calls: Array<{ provider: LLMProvider; input: ProviderChangeActiveModelInput }> = [];
  const service = createProviderModelsService({
    resolveProvider: (provider) => ({
      models: {
        getSupportedModels: async () => createModels(`${provider}-models`),
        getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
        changeActiveModel: async (input) => {
          calls.push({ provider, input });
          return createSessionActiveModelChange(provider, input);
        },
      },
    }),
  });

  const changedModel = await service.changeActiveModel('claude', {
    sessionId: 'session-123',
    model: 'opus',
  });

  assert.deepEqual(calls, [{
    provider: 'claude',
    input: {
      sessionId: 'session-123',
      model: 'opus',
    },
  }]);
  assert.equal(changedModel.changed, true);
  assert.equal(changedModel.model, 'opus');
});

test('resolveResumeModel prefers a stored changed model over the requested one', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-change-'));
  const activeModelChangesPath = path.join(tempRoot, 'session-model-changes.json');

  try {
    const service = createProviderModelsService({
      activeModelChangesPath,
      resolveProvider: (provider) => ({
        models: {
          getSupportedModels: async () => createModels(`${provider}-models`),
          getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
          changeActiveModel: async (input) => createSessionActiveModelChange(provider, input),
        },
      }),
    });

    await writeProviderSessionActiveModelChange('cursor', {
      sessionId: 'session-456',
      model: 'composer-2',
    }, {
      filePath: activeModelChangesPath,
    });

    const model = await service.resolveResumeModel('cursor', 'session-456', 'composer-2-fast');
    assert.equal(model, 'composer-2');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('deleteProviderSessionActiveModelChanges removes only the targeted sessions', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-model-cleanup-'));
  const activeModelChangesPath = path.join(tempRoot, 'session-model-changes.json');

  try {
    const write = (provider: LLMProvider, sessionId: string, model: string) =>
      writeProviderSessionActiveModelChange(provider, { sessionId, model }, { filePath: activeModelChangesPath });
    const read = (provider: LLMProvider, sessionId: string) =>
      readProviderSessionActiveModelChange(provider, sessionId, { filePath: activeModelChangesPath });

    await write('claude', 'session-keep', 'opus');
    await write('claude', 'session-drop', 'sonnet');
    await write('cursor', 'session-drop', 'composer-2'); // same id, different provider

    await deleteProviderSessionActiveModelChanges(['session-drop'], { filePath: activeModelChangesPath });

    // Untouched session survives.
    const kept = await read('claude', 'session-keep');
    assert.equal(kept.changed, true);
    assert.equal(kept.model, 'opus');

    // The deleted session id is removed for every provider.
    assert.equal((await read('claude', 'session-drop')).changed, false);
    assert.equal((await read('cursor', 'session-drop')).changed, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
