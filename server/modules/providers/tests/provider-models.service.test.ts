import assert from 'node:assert/strict';
import test from 'node:test';

import { createProviderModelsService } from '@/modules/providers/services/provider-models.service.js';
import type {
  CustomProviderModelInput,
  CustomProviderModelRecord,
  LLMProvider,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const createModels = (value: string): ProviderModelsDefinition => ({
  OPTIONS: [{ value, label: value }],
  DEFAULT: value,
});

const createCurrentActiveModel = (model: string): ProviderCurrentActiveModel => ({ model });

/** In-memory stand-in for the `sessions` table rows the service reads and writes. */
const createSessionStore = (
  rows: Record<string, string | null> = {},
  efforts: Record<string, string | null> = {},
) => {
  const sessions = new Map(Object.entries(rows).map(([sessionId, model]) => [
    sessionId,
    { model, effort: efforts[sessionId] ?? null },
  ]));
  return {
    sessions,
    getSessionById: (sessionId: string) =>
      sessions.get(sessionId) ?? null,
    setSessionModel: (sessionId: string, model: string) => {
      const session = sessions.get(sessionId);
      if (session) {
        session.model = model;
      }
    },
    setSessionEffort: (sessionId: string, effort: string) => {
      const session = sessions.get(sessionId);
      if (session) {
        session.effort = effort;
      }
    },
  };
};

const createCatalogStore = () => {
  const rows = new Map<LLMProvider, CustomProviderModelRecord[]>();
  // Model ids the service asked the repository to move deleted models' sessions to.
  const deleteFallbacks: string[] = [];
  let nextRecordId = 1;
  const readRows = (provider: LLMProvider) => rows.get(provider) ?? [];

  return {
    rows,
    deleteFallbacks,
    listCustomProviderModels(provider: LLMProvider) {
      return [...readRows(provider)];
    },
    getCustomProviderModel(provider: LLMProvider, recordId: number) {
      return readRows(provider).find((record) => record.recordId === recordId) ?? null;
    },
    findCustomProviderModelByModelId(provider: LLMProvider, modelId: string) {
      return readRows(provider).find((record) => record.modelId === modelId) ?? null;
    },
    createCustomProviderModel(provider: LLMProvider, input: CustomProviderModelInput) {
      const record: CustomProviderModelRecord = {
        recordId: nextRecordId++,
        provider,
        modelId: input.id,
        model: input.model,
        sortOrder: readRows(provider).length,
        effort: input.effort ?? null,
      };
      rows.set(provider, [...readRows(provider), record]);
      return record;
    },
    updateCustomProviderModel(
      provider: LLMProvider,
      recordId: number,
      input: CustomProviderModelInput,
    ) {
      const existing = readRows(provider).find((record) => record.recordId === recordId);
      if (!existing) {
        return null;
      }
      const updated = {
        ...existing,
        modelId: input.id,
        model: input.model,
        // Mirrors the repository: an omitted effort keeps the stored levels.
        effort: input.effort === undefined ? existing.effort : input.effort,
      };
      rows.set(provider, readRows(provider).map((record) => (
        record.recordId === recordId ? updated : record
      )));
      return updated;
    },
    deleteCustomProviderModel(provider: LLMProvider, recordId: number, fallbackModelId: string) {
      const existing = readRows(provider).find((record) => record.recordId === recordId);
      if (!existing) {
        return null;
      }
      deleteFallbacks.push(fallbackModelId);
      rows.set(provider, readRows(provider).filter((record) => record.recordId !== recordId));
      return existing;
    },
  };
};

/** In-memory stand-in for the `app_config` key-value table. */
const createSettingsStore = () => {
  const values = new Map<string, string>();
  return {
    values,
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

const createTestService = (options: {
  catalog?: ReturnType<typeof createCatalogStore>;
  sessions?: ReturnType<typeof createSessionStore>;
  settings?: ReturnType<typeof createSettingsStore>;
  activeModel?: (provider: LLMProvider, sessionId?: string) => string;
  onCatalogRead?: (provider: LLMProvider) => void;
} = {}) => {
  const catalog = options.catalog ?? createCatalogStore();
  const sessions = options.sessions ?? createSessionStore();
  const settings = options.settings ?? createSettingsStore();
  const service = createProviderModelsService({
    catalog,
    sessions,
    settings,
    resolveProvider: (provider) => ({
      models: {
        getSupportedModels: async () => {
          options.onCatalogRead?.(provider);
          return createModels(`${provider}-default`);
        },
        getCurrentActiveModel: async (sessionId) => createCurrentActiveModel(
          options.activeModel?.(provider, sessionId) ?? `${provider}-default`,
        ),
      },
    }),
  });

  return { service, catalog, sessions, settings };
};

test('provider catalogs merge source-controlled defaults with custom persistence rows', async () => {
  const calls: LLMProvider[] = [];
  const { service, catalog } = createTestService({ onCatalogRead: (provider) => calls.push(provider) });

  const models = await service.getProviderModels('codex');

  assert.deepEqual(calls, ['codex']);
  assert.equal(models.DEFAULT, 'codex-default');
  assert.deepEqual(models.OPTIONS[0], {
    value: 'codex-default',
    label: 'codex-default',
    isCustom: false,
  });
  assert.deepEqual(catalog.rows.get('codex'), undefined);
});

test('the custom-models-only flag is off by default and leaves the merged catalog unchanged', async () => {
  const { service } = createTestService();
  await service.createCustomModel('claude', { model: 'Gateway', id: 'gateway-model' });

  const models = await service.getProviderModels('claude');

  assert.deepEqual(models.OPTIONS.map((option) => option.value), ['claude-default', 'gateway-model']);
  assert.equal(models.DEFAULT, 'claude-default');
  assert.equal(models.CUSTOM_MODELS_ONLY, false);
});

test('custom-models-only lists just the custom models and makes the first one the default', async () => {
  const { service, settings } = createTestService();
  await service.createCustomModel('claude', { model: 'Gateway Sonnet', id: 'gateway-sonnet' });
  await service.createCustomModel('claude', { model: 'Gateway Haiku', id: 'gateway-haiku' });

  const toggled = await service.setCustomModelsOnly('claude', true);

  assert.deepEqual(toggled.OPTIONS.map((option) => option.value), ['gateway-sonnet', 'gateway-haiku']);
  assert.equal(toggled.OPTIONS.every((option) => option.isCustom), true);
  assert.equal(toggled.DEFAULT, 'gateway-sonnet');
  assert.equal(toggled.CUSTOM_MODELS_ONLY, true);
  assert.deepEqual(await service.getProviderModels('claude'), toggled);
  assert.equal(settings.values.get('provider_models_custom_only:claude'), 'true');

  // The flag is per provider: Codex keeps its built-ins.
  const codex = await service.getProviderModels('codex');
  assert.equal(codex.DEFAULT, 'codex-default');
  assert.equal(codex.CUSTOM_MODELS_ONLY, false);

  // Turning it off restores the merged catalog.
  const restored = await service.setCustomModelsOnly('claude', false);
  assert.deepEqual(
    restored.OPTIONS.map((option) => option.value),
    ['claude-default', 'gateway-sonnet', 'gateway-haiku'],
  );
  assert.equal(restored.DEFAULT, 'claude-default');
});

test('custom-models-only never leaves a provider with an empty catalog', async () => {
  const { service } = createTestService();

  const enabledWithoutModels = await service.setCustomModelsOnly('opencode', true);
  assert.deepEqual(enabledWithoutModels.OPTIONS.map((option) => option.value), ['opencode-default']);
  assert.equal(enabledWithoutModels.DEFAULT, 'opencode-default');
  assert.equal(enabledWithoutModels.CUSTOM_MODELS_ONLY, true);

  // The flag stays on, so the first custom model takes over as soon as it exists.
  const created = await service.createCustomModel('opencode', { model: 'Router', id: 'router/model' });
  assert.deepEqual(created.models.OPTIONS.map((option) => option.value), ['router/model']);
  assert.equal(created.models.DEFAULT, 'router/model');

  // Deleting the last custom model brings the built-ins back.
  const removed = await service.deleteCustomModel('opencode', created.model.recordId as number);
  assert.deepEqual(removed.models.OPTIONS.map((option) => option.value), ['opencode-default']);
  assert.equal(removed.models.DEFAULT, 'opencode-default');
});

test('deleting a custom model moves its sessions to the default of the catalog left behind', async () => {
  const { service, catalog } = createTestService();
  const first = await service.createCustomModel('codex', { model: 'First', id: 'gateway-first' });
  const second = await service.createCustomModel('codex', { model: 'Second', id: 'gateway-second' });

  // Flag off: sessions fall back to the built-in default, as before.
  await service.deleteCustomModel('codex', second.model.recordId as number);
  assert.deepEqual(catalog.deleteFallbacks, ['codex-default']);

  // Flag on: sessions fall back to the first remaining custom model (the new
  // DEFAULT), never to a built-in the picker no longer lists.
  const third = await service.createCustomModel('codex', { model: 'Third', id: 'gateway-third' });
  const fourth = await service.createCustomModel('codex', { model: 'Fourth', id: 'gateway-fourth' });
  await service.setCustomModelsOnly('codex', true);
  // Deleting the last one in the list goes back to the first, not a neighbour.
  await service.deleteCustomModel('codex', fourth.model.recordId as number);
  assert.deepEqual(catalog.deleteFallbacks, ['codex-default', 'gateway-first']);
  // Deleting the current default promotes the next one in list order.
  const removed = await service.deleteCustomModel('codex', first.model.recordId as number);
  assert.deepEqual(catalog.deleteFallbacks, ['codex-default', 'gateway-first', 'gateway-third']);
  assert.equal(removed.models.DEFAULT, 'gateway-third');

  // Deleting the last one falls back to the built-in default again.
  await service.deleteCustomModel('codex', third.model.recordId as number);
  assert.deepEqual(
    catalog.deleteFallbacks,
    ['codex-default', 'gateway-first', 'gateway-third', 'codex-default'],
  );
});

test('custom-models-only makes the first custom model the session fallback', async () => {
  const { service } = createTestService({
    sessions: createSessionStore({ 'session-1': null, 'session-on-built-in': 'claude-default' }),
  });
  await service.createCustomModel('claude', { model: 'Gateway', id: 'gateway-model' });
  await service.setCustomModelsOnly('claude', true);

  // No session: the catalog default is the custom model.
  const withoutSession = await service.resolveSessionModel('claude');
  assert.equal(withoutSession.model, 'gateway-model');
  assert.equal(withoutSession.source, 'default');

  // An unrecorded session whose adapter only knows its built-in default must
  // not report that built-in as the session's own model.
  const unrecorded = await service.resolveSessionModel('claude', { sessionId: 'session-1' });
  assert.equal(unrecorded.model, 'gateway-model');
  assert.equal(unrecorded.source, 'default');

  // A session that already ran on a now-hidden built-in keeps its recorded
  // model; hiding built-ins never rewrites existing sessions.
  const recorded = await service.resolveSessionModel('claude', { sessionId: 'session-on-built-in' });
  assert.equal(recorded.model, 'claude-default');
  assert.equal(recorded.source, 'session');
  assert.equal(
    await service.resolveResumeModel('claude', 'session-on-built-in', 'gateway-model'),
    'claude-default',
  );
});

test('custom models can be created, edited, and deleted', async () => {
  const { service } = createTestService();
  const created = await service.createCustomModel('claude', {
    model: 'My Claude',
    id: 'claude-my-model',
  });
  const recordId = created.model.recordId as number;

  assert.equal(created.model.isCustom, true);
  assert.equal(created.models.OPTIONS.at(-1)?.value, 'claude-my-model');

  const updated = await service.updateCustomModel('claude', recordId, {
    model: 'My Better Claude',
    id: 'claude-my-model-v2',
  });
  assert.equal(updated.model.label, 'My Better Claude');
  assert.equal(updated.model.value, 'claude-my-model-v2');

  const removed = await service.deleteCustomModel('claude', recordId);
  assert.equal(removed.model.value, 'claude-my-model-v2');
  assert.equal(removed.models.OPTIONS.some((option) => option.recordId === recordId), false);
});

test('custom models carry declared effort levels into the merged catalog', async () => {
  const { service } = createTestService();

  const created = await service.createCustomModel('claude', {
    model: 'My Custom Model',
    id: 'my-custom-model',
    effort: { values: ['low', 'max'], default: 'max' },
  });
  const expectedEffort = { default: 'max', values: [{ value: 'low' }, { value: 'max' }] };
  assert.deepEqual(created.model.effort, expectedEffort);

  const catalog = await service.getProviderModels('claude');
  const merged = catalog.OPTIONS.find((option) => option.value === 'my-custom-model');
  assert.deepEqual(merged?.effort, expectedEffort);

  // A rename that does not mention effort (an older client) keeps the levels.
  const renamed = await service.updateCustomModel('claude', created.model.recordId as number, {
    model: 'Renamed',
    id: 'my-custom-model',
  });
  assert.deepEqual(renamed.model.effort, expectedEffort);

  const cleared = await service.updateCustomModel('claude', created.model.recordId as number, {
    model: 'Renamed',
    id: 'my-custom-model',
    effort: null,
  });
  assert.equal('effort' in cleared.model, false);
});

test('custom models without declared effort levels expose no effort', async () => {
  const { service } = createTestService();

  const created = await service.createCustomModel('codex', { model: 'Plain', id: 'plain-model' });

  assert.equal('effort' in created.model, false);
});

test('custom effort levels must be levels the provider supports', async () => {
  const { service } = createTestService();

  await assert.rejects(
    () => service.createCustomModel('codex', {
      model: 'Unknown level',
      id: 'unknown-level',
      effort: { values: ['low', 'turbo'] },
    }),
    (error) => error instanceof AppError
      && error.code === 'INVALID_MODEL_EFFORT'
      && error.statusCode === 400,
  );

  await assert.rejects(
    () => service.createCustomModel('cursor', {
      model: 'Cursor effort',
      id: 'cursor-effort',
      effort: { values: ['low'] },
    }),
    (error) => error instanceof AppError
      && error.code === 'MODEL_EFFORT_NOT_SUPPORTED'
      && error.statusCode === 400,
  );
});

test('allowed effort levels come from the provider, not from the built-in models this machine sees', async () => {
  // The fake adapters' built-in models declare no effort at all, which is what
  // the real OpenCode adapter returns once it narrows its catalog to OpenCode
  // Zen, Anthropic, or OpenAI: only its OpenCode Go models declare effort.
  const { service } = createTestService();

  const created = await service.createCustomModel('opencode', {
    model: 'Router model',
    id: 'openrouter/router-model',
    effort: { values: ['none', 'high'] },
  });
  assert.deepEqual(created.model.effort, { values: [{ value: 'none' }, { value: 'high' }] });

  // Every merged catalog carries the provider's levels for the model library,
  // weakest first, and an empty list where effort is unsupported.
  const expectedLevels: Record<LLMProvider, string[]> = {
    claude: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
    codex: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    cursor: [],
    opencode: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'thinking'],
  };
  for (const [provider, levels] of Object.entries(expectedLevels) as Array<[LLMProvider, string[]]>) {
    assert.deepEqual((await service.getProviderModels(provider)).EFFORT_LEVELS, levels, provider);
  }
  assert.deepEqual(created.models.EFFORT_LEVELS, expectedLevels.opencode);
});

test('duplicate model ids are rejected within one provider', async () => {
  const { service } = createTestService();
  await service.createCustomModel('cursor', { model: 'First', id: 'custom-id' });

  await assert.rejects(
    () => service.createCustomModel('cursor', { model: 'Second', id: 'custom-id' }),
    (error) => error instanceof AppError
      && error.code === 'MODEL_ID_ALREADY_EXISTS'
      && error.statusCode === 409,
  );

  await assert.rejects(
    () => service.createCustomModel('cursor', {
      model: 'Duplicate built-in',
      id: 'cursor-default',
    }),
    (error) => error instanceof AppError
      && error.code === 'MODEL_ID_ALREADY_EXISTS'
      && error.statusCode === 409,
  );
});

test('predefined models have no database record or mutation target', async () => {
  const { service, catalog } = createTestService();
  const models = await service.getProviderModels('opencode');
  assert.equal(models.OPTIONS[0]?.recordId, undefined);
  assert.equal(models.OPTIONS[0]?.isCustom, false);
  assert.deepEqual(catalog.rows.get('opencode'), undefined);

  await assert.rejects(
    () => service.updateCustomModel('opencode', 999, { model: 'Changed', id: 'changed' }),
    (error) => error instanceof AppError && error.code === 'MODEL_NOT_FOUND',
  );
});

test('resolveSessionModel asks the provider adapter for the requested session', async () => {
  const calls: Array<{ provider: LLMProvider; sessionId?: string }> = [];
  const { service } = createTestService({
    sessions: createSessionStore({ 'session-123': null }),
    activeModel: (provider, sessionId) => {
      calls.push({ provider, sessionId });
      return `${provider}-${sessionId}`;
    },
  });

  const resolved = await service.resolveSessionModel('opencode', { sessionId: 'session-123' });

  assert.deepEqual(calls, [{ provider: 'opencode', sessionId: 'session-123' }]);
  assert.equal(resolved.model, 'opencode-session-123');
});

test('setSessionModel records the model on the session row', () => {
  const sessions = createSessionStore({ 'session-1': null });
  const { service } = createTestService({ sessions });

  const stored = service.setSessionModel('claude', 'session-1', 'opus');

  assert.deepEqual(stored, {
    provider: 'claude',
    sessionId: 'session-1',
    model: 'opus',
    effort: null,
    source: 'session',
  });
  assert.equal(sessions.sessions.get('session-1')?.model, 'opus');
});

test('setSessionModel ignores sessions that have no row yet', () => {
  const sessions = createSessionStore();
  const { service } = createTestService({ sessions });

  assert.equal(service.setSessionModel('claude', 'missing-session', 'opus'), null);
  assert.equal(sessions.sessions.size, 0);
});

test('setSessionEffort records an explicit effort on the session row', () => {
  const sessions = createSessionStore({ 'session-1': 'gpt-5.6-sol' });
  const { service } = createTestService({ sessions });

  const stored = service.setSessionEffort('codex', 'session-1', 'ultra');

  assert.deepEqual(stored, {
    provider: 'codex',
    sessionId: 'session-1',
    effort: 'ultra',
    source: 'session',
  });
  assert.equal(sessions.sessions.get('session-1')?.effort, 'ultra');
});

test('setSessionEffort ignores sessions that have no row yet', () => {
  const sessions = createSessionStore();
  const { service } = createTestService({ sessions });

  assert.equal(service.setSessionEffort('codex', 'missing-session', 'high'), null);
  assert.equal(sessions.sessions.size, 0);
});

test('resolveSessionModel prefers the recorded session model', async () => {
  const { service } = createTestService({
    sessions: createSessionStore({ 'session-1': 'haiku' }, { 'session-1': 'high' }),
    activeModel: () => 'provider-reported',
  });

  const resolved = await service.resolveSessionModel('claude', {
    sessionId: 'session-1',
    requestedModel: 'sonnet',
  });

  assert.equal(resolved.model, 'haiku');
  assert.equal(resolved.effort, 'high');
  assert.equal(resolved.source, 'session');
});

test('resolveSessionModel uses provider session state for unrecorded external sessions', async () => {
  const { service } = createTestService({
    sessions: createSessionStore({ 'session-1': null }),
    activeModel: () => 'provider-reported',
  });

  const resolved = await service.resolveSessionModel('opencode', {
    sessionId: 'session-1',
    requestedModel: 'requested',
  });

  assert.equal(resolved.model, 'provider-reported');
  assert.equal(resolved.source, 'provider');
});

test('resolveSessionModel uses the requested model when provider reports the catalog default', async () => {
  const { service } = createTestService({
    sessions: createSessionStore({ 'session-1': null }),
  });

  const resolved = await service.resolveSessionModel('claude', {
    sessionId: 'session-1',
    requestedModel: 'haiku',
  });

  assert.equal(resolved.model, 'haiku');
  assert.equal(resolved.source, 'session');
});

test('resolveSessionModel returns a requested model before a session exists', async () => {
  const { service } = createTestService();

  const resolved = await service.resolveSessionModel('codex', { requestedModel: 'gpt-5.5' });

  assert.equal(resolved.model, 'gpt-5.5');
  assert.equal(resolved.sessionId, null);
  assert.equal(resolved.source, 'session');
});

test('resolveSessionModel falls back to the provider adapter default', async () => {
  const { service } = createTestService();

  const resolved = await service.resolveSessionModel('codex');

  assert.equal(resolved.model, 'codex-default');
  assert.equal(resolved.source, 'default');
});

test('resolveResumeModel prefers the recorded session model over the requested one', async () => {
  const { service } = createTestService({
    sessions: createSessionStore({ 'session-456': 'composer-2' }),
  });

  const model = await service.resolveResumeModel('cursor', 'session-456', 'composer-2-fast');
  assert.equal(model, 'composer-2');
});

test('resolveResumeModel never consults provider-global state', async () => {
  let providerLookups = 0;
  const { service } = createTestService({
    sessions: createSessionStore({ 'session-456': null }),
    activeModel: () => {
      providerLookups += 1;
      return 'global-config-model';
    },
  });

  const model = await service.resolveResumeModel('codex', 'session-456', 'gpt-5.5');

  assert.equal(model, 'gpt-5.5');
  assert.equal(providerLookups, 0);
});
