import assert from 'node:assert/strict';
import test from 'node:test';

import { executeModelsCommand } from '../commands.js';
import { providerModelsService } from '../../modules/providers/services/provider-models.service.js';

test('models command returns available models only for the active provider', async () => {
  const originalGetProviderModels = providerModelsService.getProviderModels;
  const originalGetCurrentActiveModel = providerModelsService.getCurrentActiveModel;
  let getCurrentActiveModelCalls = 0;

  providerModelsService.getProviderModels = async () => ({
    models: {
      OPTIONS: [{ value: 'gpt-5.4', label: 'gpt-5.4' }],
      DEFAULT: 'gpt-5.4',
    },
    cache: {
      updatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-04T00:00:00.000Z',
      source: 'fresh',
    },
  });
  providerModelsService.getCurrentActiveModel = async () => {
    getCurrentActiveModelCalls += 1;
    return {
      model: 'gpt-5.3-codex',
    };
  };

  try {
    const result = await executeModelsCommand([], {
      provider: 'codex',
      model: 'gpt-5.4',
    });

    assert.equal(result.type, 'builtin');
    assert.equal(result.action, 'models');
    assert.equal(result.data.current.provider, 'codex');
    assert.equal(result.data.current.model, 'gpt-5.4');
    assert.deepEqual(Object.keys(result.data.available), ['codex']);
    assert.deepEqual(result.data.available.codex, result.data.availableModels);
    assert.ok(result.data.availableModels.includes('gpt-5.4'));
    assert.equal(result.data.available.claude, undefined);
    assert.equal(result.data.available.cursor, undefined);
    assert.equal(getCurrentActiveModelCalls, 0);
  } finally {
    providerModelsService.getProviderModels = originalGetProviderModels;
    providerModelsService.getCurrentActiveModel = originalGetCurrentActiveModel;
  }
});

test('models command falls back to claude for unsupported providers', async () => {
  const originalGetProviderModels = providerModelsService.getProviderModels;
  const originalGetCurrentActiveModel = providerModelsService.getCurrentActiveModel;

  providerModelsService.getProviderModels = async () => ({
    models: {
      OPTIONS: [{ value: 'default', label: 'Default (recommended)' }],
      DEFAULT: 'default',
    },
    cache: {
      updatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-04T00:00:00.000Z',
      source: 'fresh',
    },
  });
  providerModelsService.getCurrentActiveModel = async () => ({
    model: 'default',
  });

  try {
    const result = await executeModelsCommand([], {
      provider: 'unknown-provider',
    });

    assert.equal(result.data.current.provider, 'claude');
    assert.deepEqual(Object.keys(result.data.available), ['claude']);
  } finally {
    providerModelsService.getProviderModels = originalGetProviderModels;
    providerModelsService.getCurrentActiveModel = originalGetCurrentActiveModel;
  }
});

test('models command prefers the requested catalog model over a raw session model id', async () => {
  const originalGetProviderModels = providerModelsService.getProviderModels;
  const originalGetCurrentActiveModel = providerModelsService.getCurrentActiveModel;

  providerModelsService.getProviderModels = async () => ({
    models: {
      OPTIONS: [
        { value: 'default', label: 'Default (recommended)' },
        { value: 'opus', label: 'Opus' },
      ],
      DEFAULT: 'default',
    },
    cache: {
      updatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-04T00:00:00.000Z',
      source: 'fresh',
    },
  });
  // A normal turn only records the raw provider-native model id, which is not a
  // catalog option value the picker can highlight.
  providerModelsService.getCurrentActiveModel = async () => ({
    model: 'claude-opus-4-8',
  });

  try {
    const result = await executeModelsCommand([], {
      provider: 'claude',
      sessionId: 'session-abc',
      model: 'opus',
    });

    assert.equal(result.data.current.model, 'opus');
  } finally {
    providerModelsService.getProviderModels = originalGetProviderModels;
    providerModelsService.getCurrentActiveModel = originalGetCurrentActiveModel;
  }
});

test('models command keeps a catalog session model (picker override) over the requested model', async () => {
  const originalGetProviderModels = providerModelsService.getProviderModels;
  const originalGetCurrentActiveModel = providerModelsService.getCurrentActiveModel;

  providerModelsService.getProviderModels = async () => ({
    models: {
      OPTIONS: [
        { value: 'default', label: 'Default (recommended)' },
        { value: 'opus', label: 'Opus' },
        { value: 'haiku', label: 'Haiku' },
      ],
      DEFAULT: 'default',
    },
    cache: {
      updatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-04T00:00:00.000Z',
      source: 'fresh',
    },
  });
  // A picker override / explicit "set model" line resolves to a catalog value
  // and must win over the composer's (possibly stale) requested model.
  providerModelsService.getCurrentActiveModel = async () => ({
    model: 'haiku',
  });

  try {
    const result = await executeModelsCommand([], {
      provider: 'claude',
      sessionId: 'session-abc',
      model: 'opus',
    });

    assert.equal(result.data.current.model, 'haiku');
  } finally {
    providerModelsService.getProviderModels = originalGetProviderModels;
    providerModelsService.getCurrentActiveModel = originalGetCurrentActiveModel;
  }
});
