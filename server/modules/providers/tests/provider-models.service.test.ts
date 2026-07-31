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
  LLMProvider,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
} from '@/shared/types.js';

const createModels = (value: string): ProviderModelsDefinition => ({
  OPTIONS: [{ value, label: value }],
  DEFAULT: value,
});

const createCurrentActiveModel = (model: string): ProviderCurrentActiveModel => ({
  model,
});

/** In-memory stand-in for the `sessions` table rows the service reads and writes. */
const createSessionStore = (rows: Record<string, string | null> = {}) => {
  const sessions = new Map(Object.entries(rows));
  return {
    sessions,
    getSessionById: (sessionId: string) =>
      (sessions.has(sessionId) ? { model: sessions.get(sessionId) ?? null } : null),
    setSessionModel: (sessionId: string, model: string) => {
      sessions.set(sessionId, model);
    },
  };
};

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

test('resolveSessionModel asks the provider adapter for the session it was given', async () => {
  const calls: Array<{ provider: LLMProvider; sessionId?: string }> = [];
  const service = createProviderModelsService({
    sessions: createSessionStore({ 'session-123': null }),
    resolveProvider: (provider) => ({
      models: {
        getSupportedModels: async () => createModels(`${provider}-models`),
        getCurrentActiveModel: async (sessionId) => {
          calls.push({ provider, sessionId });
          return createCurrentActiveModel(`${provider}-${sessionId}`);
        },
      },
    }),
  });

  const resolved = await service.resolveSessionModel('opencode', { sessionId: 'session-123' });

  assert.deepEqual(calls, [{ provider: 'opencode', sessionId: 'session-123' }]);
  assert.equal(resolved.model, 'opencode-session-123');
});
test('setSessionModel records the model on the session row', async () => {
  const sessions = createSessionStore({ 'session-1': null });
  const service = createProviderModelsService({
    sessions,
    resolveProvider: (provider) => ({
      models: {
        getSupportedModels: async () => createModels(`${provider}-models`),
        getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
      },
    }),
  });

  const stored = service.setSessionModel('claude', 'session-1', 'opus');

  assert.deepEqual(stored, {
    provider: 'claude',
    sessionId: 'session-1',
    model: 'opus',
    source: 'session',
  });
  assert.equal(sessions.sessions.get('session-1'), 'opus');
});

test('setSessionModel ignores sessions that have no row yet', async () => {
  const sessions = createSessionStore();
  const service = createProviderModelsService({
    sessions,
    resolveProvider: (provider) => ({
      models: {
        getSupportedModels: async () => createModels(`${provider}-models`),
        getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
      },
    }),
  });

  assert.equal(service.setSessionModel('claude', 'missing-session', 'opus'), null);
  assert.equal(sessions.sessions.size, 0);
});

test('resolveSessionModel prefers the recorded session model over everything else', async () => {
  const service = createProviderModelsService({
    sessions: createSessionStore({ 'session-1': 'haiku' }),
    resolveProvider: (provider) => ({
      models: {
        getSupportedModels: async () => createModels(`${provider}-models`),
        getCurrentActiveModel: async () => createCurrentActiveModel('provider-reported'),
      },
    }),
  });

  const resolved = await service.resolveSessionModel('claude', {
    sessionId: 'session-1',
    requestedModel: 'sonnet',
  });

  assert.equal(resolved.model, 'haiku');
  assert.equal(resolved.source, 'session');
});

test('resolveSessionModel falls back to provider session state for sessions the app never recorded', async () => {
  const service = createProviderModelsService({
    sessions: createSessionStore({ 'session-1': null }),
    resolveProvider: (provider) => ({
      models: {
        getSupportedModels: async () => createModels(`${provider}-models`),
        getCurrentActiveModel: async () => createCurrentActiveModel('provider-reported'),
      },
    }),
  });

  const resolved = await service.resolveSessionModel('opencode', {
    sessionId: 'session-1',
    requestedModel: 'requested',
  });

  assert.equal(resolved.model, 'provider-reported');
  assert.equal(resolved.source, 'provider');
});

test('resolveSessionModel uses the requested model when the provider only reports its catalog default', async () => {
  const service = createProviderModelsService({
    cachePath: createEphemeralCachePath(),
    sessions: createSessionStore({ 'session-1': null }),
    resolveProvider: () => ({
      models: {
        getSupportedModels: async () => createModels('default'),
        getCurrentActiveModel: async () => createCurrentActiveModel('default'),
      },
    }),
  });

  const resolved = await service.resolveSessionModel('claude', {
    sessionId: 'session-1',
    requestedModel: 'haiku',
  });

  assert.equal(resolved.model, 'haiku');
  assert.equal(resolved.source, 'session');
});

test('resolveSessionModel answers with the requested model for a chat that has no session yet', async () => {
  const service = createProviderModelsService({
    sessions: createSessionStore(),
    resolveProvider: (provider) => ({
      models: {
        getSupportedModels: async () => createModels(`${provider}-models`),
        getCurrentActiveModel: async () => createCurrentActiveModel('provider-reported'),
      },
    }),
  });

  const resolved = await service.resolveSessionModel('codex', { requestedModel: 'gpt-5.5' });

  assert.equal(resolved.model, 'gpt-5.5');
  assert.equal(resolved.sessionId, null);
  assert.equal(resolved.source, 'session');
});

test('resolveSessionModel falls back to the catalog default with nothing else to go on', async () => {
  const service = createProviderModelsService({
    cachePath: createEphemeralCachePath(),
    sessions: createSessionStore(),
    resolveProvider: (provider) => ({
      models: {
        getSupportedModels: async () => createModels(`${provider}-models`),
        getCurrentActiveModel: async () => createCurrentActiveModel('provider-reported'),
      },
    }),
  });

  const resolved = await service.resolveSessionModel('codex');

  assert.equal(resolved.model, 'codex-models');
  assert.equal(resolved.source, 'default');
});

test('resolveResumeModel prefers the recorded session model over the requested one', async () => {
  const service = createProviderModelsService({
    sessions: createSessionStore({ 'session-456': 'composer-2' }),
    resolveProvider: (provider) => ({
      models: {
        getSupportedModels: async () => createModels(`${provider}-models`),
        getCurrentActiveModel: async () => createCurrentActiveModel(`${provider}-active`),
      },
    }),
  });

  const model = await service.resolveResumeModel('cursor', 'session-456', 'composer-2-fast');
  assert.equal(model, 'composer-2');
});

test('resolveResumeModel never lets provider session state override the requested model', async () => {
  let providerLookups = 0;
  const service = createProviderModelsService({
    sessions: createSessionStore({ 'session-456': null }),
    resolveProvider: (provider) => ({
      models: {
        getSupportedModels: async () => createModels(`${provider}-models`),
        getCurrentActiveModel: async () => {
          providerLookups += 1;
          return createCurrentActiveModel('global-config-model');
        },
      },
    }),
  });

  const model = await service.resolveResumeModel('codex', 'session-456', 'gpt-5.5');

  assert.equal(model, 'gpt-5.5');
  assert.equal(providerLookups, 0);
});
