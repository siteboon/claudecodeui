import { providerModelsDb, sessionsDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { IProvider } from '@/shared/interfaces.js';
import type {
  CustomProviderModelInput,
  CustomProviderModelRecord,
  LLMProvider,
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
  ProviderCatalogSyncPlan,
  ProviderSessionModel,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/** Session-row access the service needs, narrowed so tests can stub it. */
type ProviderModelsSessionStore = {
  getSessionById(sessionId: string): { model: string | null; effort: string | null } | null;
  setSessionModel(sessionId: string, model: string): void;
  setSessionEffort(sessionId: string, effort: string): void;
};

/** SQLite catalog operations used by the Providers service and its unit fakes. */
type ProviderModelsCatalogStore = Pick<
  typeof providerModelsDb,
  | 'listCustomProviderModels'
  | 'getCustomProviderModel'
  | 'findCustomProviderModelByModelId'
  | 'createCustomProviderModel'
  | 'updateCustomProviderModel'
  | 'deleteCustomProviderModel'
  | 'replaceCustomProviderModels'
>;

type ProviderModelsServiceDependencies = {
  resolveProvider?: (provider: LLMProvider) => Pick<IProvider, 'models'>;
  catalog?: ProviderModelsCatalogStore;
  sessions?: ProviderModelsSessionStore;
};

const toCustomProviderModelOption = (
  record: CustomProviderModelRecord,
): ProviderModelOption => ({
  value: record.modelId,
  label: record.model,
  recordId: record.recordId,
  isCustom: true,
});

const mergeProviderModels = (
  predefined: ProviderModelsDefinition,
  custom: CustomProviderModelRecord[],
): ProviderModelsDefinition => {
  return {
    OPTIONS: [
      ...predefined.OPTIONS.map((option) => ({ ...option, isCustom: false })),
      ...custom.map(toCustomProviderModelOption),
    ],
    DEFAULT: predefined.DEFAULT,
  };
};

const normalizeCustomModelInput = (input: CustomProviderModelInput): CustomProviderModelInput => ({
  id: input.id.trim(),
  model: input.model.trim(),
});

const isUniqueConstraintError = (error: unknown): boolean => (
  error !== null
  && error !== undefined
  && typeof error === 'object'
  && 'code' in error
  && String(error.code).startsWith('SQLITE_CONSTRAINT')
);

/**
 * Creates the provider model application service used by Providers routes,
 * Commands, and provider runtimes.
 *
 * Curated adapter definitions stay source-controlled and are merged at read
 * time with custom SQLite rows. This deliberately has no predefined-model
 * persistence, memory cache, disk cache, TTL, or provider-native discovery.
 * Tests inject a small custom-model store through the same boundary.
 */
export const createProviderModelsService = (dependencies: ProviderModelsServiceDependencies = {}) => {
  const resolveProvider = dependencies.resolveProvider ?? providerRegistry.resolveProvider;
  const catalog = dependencies.catalog ?? providerModelsDb;
  const sessions = dependencies.sessions ?? sessionsDb;

  const getProviderModels = async (provider: LLMProvider): Promise<ProviderModelsDefinition> => {
    const predefined = await resolveProvider(provider).models.getSupportedModels();
    return mergeProviderModels(predefined, catalog.listCustomProviderModels(provider));
  };

  const getCurrentActiveModel = async (
    provider: LLMProvider,
    sessionId?: string,
  ): Promise<ProviderCurrentActiveModel> => resolveProvider(provider).models.getCurrentActiveModel(sessionId);

  const readCustomModel = (
    provider: LLMProvider,
    recordId: number,
  ): CustomProviderModelRecord => {
    const existing = catalog.getCustomProviderModel(provider, recordId);
    if (!existing) {
      throw new AppError('Model not found.', {
        code: 'MODEL_NOT_FOUND',
        statusCode: 404,
      });
    }

    return existing;
  };

  const assertModelIdAvailable = (
    provider: LLMProvider,
    predefined: ProviderModelsDefinition,
    modelId: string,
    currentRecordId?: number,
  ): void => {
    if (predefined.OPTIONS.some((option) => option.value === modelId)) {
      throw new AppError(`A ${provider} model with this ID already exists.`, {
        code: 'MODEL_ID_ALREADY_EXISTS',
        statusCode: 409,
      });
    }

    const duplicate = catalog.findCustomProviderModelByModelId(provider, modelId);
    if (duplicate && duplicate.recordId !== currentRecordId) {
      throw new AppError(`A ${provider} model with this ID already exists.`, {
        code: 'MODEL_ID_ALREADY_EXISTS',
        statusCode: 409,
      });
    }
  };

  const createCustomModel = async (
    provider: LLMProvider,
    input: CustomProviderModelInput,
  ): Promise<{ model: ProviderModelOption; models: ProviderModelsDefinition }> => {
    const predefined = await resolveProvider(provider).models.getSupportedModels();
    const normalized = normalizeCustomModelInput(input);
    assertModelIdAvailable(provider, predefined, normalized.id);

    try {
      const created = catalog.createCustomProviderModel(provider, normalized);
      return {
        model: toCustomProviderModelOption(created),
        models: mergeProviderModels(predefined, catalog.listCustomProviderModels(provider)),
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError(`A ${provider} model with this ID already exists.`, {
          code: 'MODEL_ID_ALREADY_EXISTS',
          statusCode: 409,
        });
      }
      throw error;
    }
  };

  const updateCustomModel = async (
    provider: LLMProvider,
    recordId: number,
    input: CustomProviderModelInput,
  ): Promise<{ model: ProviderModelOption; models: ProviderModelsDefinition }> => {
    const predefined = await resolveProvider(provider).models.getSupportedModels();
    readCustomModel(provider, recordId);
    const normalized = normalizeCustomModelInput(input);
    assertModelIdAvailable(provider, predefined, normalized.id, recordId);

    try {
      const updated = catalog.updateCustomProviderModel(provider, recordId, normalized);
      if (!updated) {
        throw new AppError('Model not found.', {
          code: 'MODEL_NOT_FOUND',
          statusCode: 404,
        });
      }

      return {
        model: toCustomProviderModelOption(updated),
        models: mergeProviderModels(predefined, catalog.listCustomProviderModels(provider)),
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError(`A ${provider} model with this ID already exists.`, {
          code: 'MODEL_ID_ALREADY_EXISTS',
          statusCode: 409,
        });
      }
      throw error;
    }
  };

  const deleteCustomModel = async (
    provider: LLMProvider,
    recordId: number,
  ): Promise<{ model: ProviderModelOption; models: ProviderModelsDefinition }> => {
    const predefined = await resolveProvider(provider).models.getSupportedModels();
    readCustomModel(provider, recordId);
    const removed = catalog.deleteCustomProviderModel(provider, recordId, predefined.DEFAULT);
    if (!removed) {
      throw new AppError('Model not found.', {
        code: 'MODEL_NOT_FOUND',
        statusCode: 404,
      });
    }

    return {
      model: toCustomProviderModelOption(removed),
      models: mergeProviderModels(predefined, catalog.listCustomProviderModels(provider)),
    };
  };

  /**
   * Loads the external model catalog a provider CLI reads from a
   * user-configured file, or throws when the provider has no such source or
   * the configured file is unusable.
   */
  const readExternalCatalogOrThrow = async (
    provider: LLMProvider,
  ): Promise<ProviderModelsDefinition> => {
    const models = resolveProvider(provider).models;
    if (!models.readExternalCatalog) {
      throw new AppError(`${provider} does not support syncing an external model catalog.`, {
        code: 'CATALOG_SYNC_UNSUPPORTED',
        statusCode: 404,
      });
    }

    const definition = await models.readExternalCatalog();
    if (!definition || definition.OPTIONS.length === 0) {
      throw new AppError(
        'No usable Codex model catalog is configured. Set model_catalog_json in ~/.codex/config.toml first.',
        {
          code: 'CODEX_CATALOG_UNAVAILABLE',
          statusCode: 400,
        },
      );
    }

    return definition;
  };

  /**
   * Diffs stored custom rows against the provider's external catalog.
   *
   * Catalog entries whose id the curated predefined list already offers are
   * skipped instead of stored, matching the single-row create path that
   * rejects such ids. Everything else is added, renamed when the display name
   * changed, or removed when the catalog no longer lists it.
   */
  const buildCatalogSyncPlan = (
    provider: LLMProvider,
    predefined: ProviderModelsDefinition,
    external: ProviderModelsDefinition,
  ): ProviderCatalogSyncPlan => {
    const existingById = new Map(
      catalog.listCustomProviderModels(provider).map((record) => [record.modelId, record]),
    );
    const predefinedIds = new Set(predefined.OPTIONS.map((option) => option.value));
    const additions: ProviderCatalogSyncPlan['additions'] = [];
    const updates: ProviderCatalogSyncPlan['updates'] = [];
    const skipped: ProviderCatalogSyncPlan['skipped'] = [];

    for (const option of external.OPTIONS) {
      if (predefinedIds.has(option.value)) {
        skipped.push({ id: option.value, model: option.label, reason: 'builtin' });
        continue;
      }

      const existing = existingById.get(option.value);
      const entry = {
        id: option.value,
        model: option.label,
        ...(existing && existing.model !== option.label ? { previousModel: existing.model } : {}),
      };
      if (!existing) {
        additions.push(entry);
      } else if (existing.model !== option.label) {
        updates.push(entry);
      }
    }

    const keptIds = new Set(external.OPTIONS.map((option) => option.value));
    const removals = [...existingById.values()]
      .filter((record) => !keptIds.has(record.modelId))
      .map((record) => ({ id: record.modelId, model: record.model }));

    return { provider, additions, updates, removals, skipped };
  };

  /**
   * Returns the diff a catalog sync would apply, without touching the store.
   */
  const previewCatalogSync = async (provider: LLMProvider): Promise<ProviderCatalogSyncPlan> => {
    const [predefined, external] = await Promise.all([
      resolveProvider(provider).models.getSupportedModels(),
      readExternalCatalogOrThrow(provider),
    ]);
    return buildCatalogSyncPlan(provider, predefined, external);
  };

  /**
   * Replaces the provider's custom rows with the external catalog entries and
   * returns the applied plan plus the refreshed merged catalog.
   */
  const applyCatalogSync = async (
    provider: LLMProvider,
  ): Promise<{ plan: ProviderCatalogSyncPlan; models: ProviderModelsDefinition }> => {
    const models = resolveProvider(provider).models;
    const predefined = await models.getSupportedModels();
    const external = await readExternalCatalogOrThrow(provider);
    const plan = buildCatalogSyncPlan(provider, predefined, external);
    const skippedIds = new Set(plan.skipped.map((entry) => entry.id));
    const finalEntries = external.OPTIONS
      .filter((option) => !skippedIds.has(option.value))
      .map((option) => ({ id: option.value, model: option.label }));

    catalog.replaceCustomProviderModels(provider, finalEntries, predefined.DEFAULT);

    return {
      plan,
      models: mergeProviderModels(predefined, catalog.listCustomProviderModels(provider)),
    };
  };

  const readRecordedSessionSelection = (
    sessionId: string,
  ): { model: string | null; effort: string | null } | null => {
    const session = sessions.getSessionById(sessionId);
    if (!session) {
      return null;
    }

    return {
      model: session.model?.trim() || null,
      effort: session.effort?.trim() || null,
    };
  };

  /**
   * Records the model one session runs with.
   *
   * Called from the active-model route when the user picks a model and from
   * `chat.send` on every turn, so the row always matches what the session last
   * ran with. Sessions the app has not created yet (no row) are ignored rather
   * than treated as an error: the client keeps its own pending selection and
   * the value lands on the row with the first send.
   */
  const setSessionModel = (
    provider: LLMProvider,
    sessionId: string,
    model: string,
  ): ProviderSessionModel | null => {
    const normalizedSessionId = sessionId.trim();
    const normalizedModel = model.trim();
    if (!normalizedSessionId || !normalizedModel) {
      return null;
    }

    const recordedSelection = readRecordedSessionSelection(normalizedSessionId);
    if (!recordedSelection) {
      return null;
    }

    sessions.setSessionModel(normalizedSessionId, normalizedModel);
    return {
      provider,
      sessionId: normalizedSessionId,
      model: normalizedModel,
      effort: recordedSelection.effort,
      source: 'session',
    };
  };

  /**
   * Records the reasoning effort one session runs with.
   *
   * Like `setSessionModel`, this ignores an id that has not been allocated by
   * the session gateway yet. The websocket send path records it once the row
   * exists, so a pre-session composer choice is not lost.
   */
  const setSessionEffort = (
    provider: LLMProvider,
    sessionId: string,
    effort: string,
  ): { provider: LLMProvider; sessionId: string; effort: string; source: 'session' } | null => {
    const normalizedSessionId = sessionId.trim();
    const normalizedEffort = effort.trim();
    if (!normalizedSessionId || !normalizedEffort) {
      return null;
    }

    if (!readRecordedSessionSelection(normalizedSessionId)) {
      return null;
    }

    sessions.setSessionEffort(normalizedSessionId, normalizedEffort);
    return {
      provider,
      sessionId: normalizedSessionId,
      effort: normalizedEffort,
      source: 'session',
    };
  };

  /**
   * Answers "which model is this session using?" for every display surface.
   *
   * Precedence, highest first:
   *   1. the model recorded on the session row;
   *   2. the provider's own session state for externally-created sessions;
   *   3. `requestedModel`, the client's current default;
   *   4. the source-controlled provider catalog default.
   */
  const resolveSessionModel = async (
    provider: LLMProvider,
    options: { sessionId?: string | null; requestedModel?: string | null } = {},
  ): Promise<ProviderSessionModel> => {
    const normalizedSessionId = typeof options.sessionId === 'string' ? options.sessionId.trim() : '';
    const normalizedRequestedModel = typeof options.requestedModel === 'string'
      ? options.requestedModel.trim()
      : '';

    if (normalizedSessionId) {
      const recordedSelection = readRecordedSessionSelection(normalizedSessionId);
      if (recordedSelection?.model) {
        return {
          provider,
          sessionId: normalizedSessionId,
          model: recordedSelection.model,
          effort: recordedSelection.effort,
          source: 'session',
        };
      }

      const providerCatalog = await getProviderModels(provider);
      const providerModel = await getCurrentActiveModel(provider, normalizedSessionId);
      const resolvedProviderModel = providerModel.model?.trim();
      if (resolvedProviderModel && resolvedProviderModel !== providerCatalog.DEFAULT) {
        return {
          provider,
          sessionId: normalizedSessionId,
          model: resolvedProviderModel,
          effort: recordedSelection?.effort ?? null,
          source: 'provider',
        };
      }

      return {
        provider,
        sessionId: normalizedSessionId,
        model: normalizedRequestedModel || providerCatalog.DEFAULT,
        effort: recordedSelection?.effort ?? null,
        source: normalizedRequestedModel ? 'session' : 'default',
      };
    }

    if (normalizedRequestedModel) {
      return {
        provider,
        sessionId: null,
        model: normalizedRequestedModel,
        effort: null,
        source: 'session',
      };
    }

    const providerCatalog = await getProviderModels(provider);
    return {
      provider,
      sessionId: null,
      model: providerCatalog.DEFAULT,
      effort: null,
      source: 'default',
    };
  };

  /**
   * Picks the model one resumed provider run should use.
   *
   * Provider-global state is deliberately ignored because it must never
   * override the model explicitly selected in the composer.
   */
  const resolveResumeModel = async (
    provider: LLMProvider,
    sessionId: string | undefined,
    requestedModel?: string | null,
  ): Promise<string | undefined> => {
    void provider;
    const normalizedRequestedModel = typeof requestedModel === 'string' ? requestedModel.trim() : '';
    const normalizedSessionId = sessionId?.trim();
    if (!normalizedSessionId) {
      return normalizedRequestedModel || undefined;
    }

    const recordedModel = readRecordedSessionSelection(normalizedSessionId)?.model;
    return recordedModel || normalizedRequestedModel || undefined;
  };

  return {
    getProviderModels,
    createCustomModel,
    updateCustomModel,
    deleteCustomModel,
    previewCatalogSync,
    applyCatalogSync,
    setSessionModel,
    setSessionEffort,
    resolveSessionModel,
    resolveResumeModel,
  };
};

/** Shared Providers service used by routes, Commands, and provider runtimes. */
export const providerModelsService = createProviderModelsService();
