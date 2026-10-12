import { appConfigDb, providerModelsDb, sessionsDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import type { IProvider } from '@/shared/interfaces.js';
import type {
  CustomProviderModelInput,
  CustomProviderModelRecord,
  LLMProvider,
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
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
>;

/** App-wide key-value settings, narrowed to what the "custom models only" flag needs. */
type ProviderModelsSettingsStore = Pick<typeof appConfigDb, 'get' | 'set'>;

type ProviderModelsServiceDependencies = {
  resolveProvider?: (provider: LLMProvider) => Pick<IProvider, 'models'>;
  catalog?: ProviderModelsCatalogStore;
  sessions?: ProviderModelsSessionStore;
  settings?: ProviderModelsSettingsStore;
};

/**
 * `app_config` key of one provider's "use only my models" flag. It is app-wide
 * like the custom rows it filters, which carry no user id either.
 */
const customModelsOnlyConfigKey = (provider: LLMProvider): string => (
  `provider_models_custom_only:${provider}`
);

/**
 * Converts a stored custom row into a catalog option.
 *
 * `effort` is emitted in the same shape predefined models use, so the composer
 * and every runtime's effort validation treat declared levels identically.
 * Rows without declared levels omit `effort` on purpose: the composer then
 * hides Reasoning and runtimes send no effort, instead of guessing levels the
 * model might reject.
 */
const toCustomProviderModelOption = (
  record: CustomProviderModelRecord,
): ProviderModelOption => ({
  value: record.modelId,
  label: record.model,
  recordId: record.recordId,
  isCustom: true,
  ...(record.effort
    ? {
      effort: {
        ...(record.effort.default ? { default: record.effort.default } : {}),
        values: record.effort.values.map((value) => ({ value })),
      },
    }
    : {}),
});

/**
 * Effort levels a custom model of this provider may declare, weakest first:
 * the levels its runtime can pass on, from the capability matrix. Empty
 * (Cursor) means no effort support at all.
 *
 * Deliberately not derived from the predefined models: OpenCode narrows its
 * catalog to the upstream providers this machine has connected, and only its
 * OpenCode Go models declare effort, so a catalog-derived set would vanish for
 * Zen, Anthropic, or OpenAI users and change with unrelated credentials.
 */
const readCustomModelEffortLevels = (provider: LLMProvider): string[] => (
  providerCapabilitiesService.getProviderCapabilities(provider).effortLevels
);

/**
 * Builds the catalog every picker, command, and runtime reads.
 *
 * Built-in models come first, then custom ones. With `customModelsOnly` set the
 * built-ins are left out and the first custom model becomes the default, so a
 * provider pointed at a gateway lists only what that gateway serves. The flag
 * only applies while at least one custom model exists: an empty catalog would
 * leave the composer and the runtimes with no model at all.
 */
const mergeProviderModels = (
  provider: LLMProvider,
  predefined: ProviderModelsDefinition,
  custom: CustomProviderModelRecord[],
  customModelsOnly: boolean,
): ProviderModelsDefinition => {
  const customOptions = custom.map(toCustomProviderModelOption);
  const listOnlyCustomModels = customModelsOnly && customOptions.length > 0;
  return {
    OPTIONS: listOnlyCustomModels
      ? customOptions
      : [
        ...predefined.OPTIONS.map((option) => ({ ...option, isCustom: false })),
        ...customOptions,
      ],
    DEFAULT: listOnlyCustomModels ? customOptions[0].value : predefined.DEFAULT,
    // Copied so no caller can mutate the shared capability matrix.
    EFFORT_LEVELS: [...readCustomModelEffortLevels(provider)],
    CUSTOM_MODELS_ONLY: customModelsOnly,
  };
};

const normalizeCustomModelInput = (input: CustomProviderModelInput): CustomProviderModelInput => ({
  id: input.id.trim(),
  model: input.model.trim(),
  ...(input.effort === undefined ? {} : { effort: input.effort }),
});

const assertEffortLevelsSupported = (
  provider: LLMProvider,
  input: CustomProviderModelInput,
): void => {
  const declaredLevels = input.effort?.values ?? [];
  if (declaredLevels.length === 0) {
    return;
  }

  const supportedLevels = readCustomModelEffortLevels(provider);
  if (supportedLevels.length === 0) {
    throw new AppError(`${provider} models do not support reasoning effort.`, {
      code: 'MODEL_EFFORT_NOT_SUPPORTED',
      statusCode: 400,
    });
  }

  const unsupportedLevel = declaredLevels.find((level) => !supportedLevels.includes(level));
  if (unsupportedLevel) {
    throw new AppError(
      `"${unsupportedLevel}" is not a ${provider} effort level. Use one of: ${supportedLevels.join(', ')}.`,
      {
        code: 'INVALID_MODEL_EFFORT',
        statusCode: 400,
      },
    );
  }
};

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
  const settings = dependencies.settings ?? appConfigDb;

  const isCustomModelsOnly = (provider: LLMProvider): boolean => (
    settings.get(customModelsOnlyConfigKey(provider)) === 'true'
  );

  /** Merges the adapter catalog with the provider's stored custom rows and flag. */
  const readMergedCatalog = (
    provider: LLMProvider,
    predefined: ProviderModelsDefinition,
  ): ProviderModelsDefinition => mergeProviderModels(
    provider,
    predefined,
    catalog.listCustomProviderModels(provider),
    isCustomModelsOnly(provider),
  );

  const getProviderModels = async (provider: LLMProvider): Promise<ProviderModelsDefinition> => {
    const predefined = await resolveProvider(provider).models.getSupportedModels();
    return readMergedCatalog(provider, predefined);
  };

  /**
   * Turns "use only my models" on or off for one provider and returns the
   * catalog it produces. Turning it on with no custom models is allowed: the
   * built-ins stay listed until the first custom model is added.
   */
  const setCustomModelsOnly = async (
    provider: LLMProvider,
    enabled: boolean,
  ): Promise<ProviderModelsDefinition> => {
    const predefined = await resolveProvider(provider).models.getSupportedModels();
    settings.set(customModelsOnlyConfigKey(provider), enabled ? 'true' : 'false');
    return readMergedCatalog(provider, predefined);
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
    assertEffortLevelsSupported(provider, normalized);

    try {
      const created = catalog.createCustomProviderModel(provider, normalized);
      return {
        model: toCustomProviderModelOption(created),
        models: readMergedCatalog(provider, predefined),
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
    assertEffortLevelsSupported(provider, normalized);

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
        models: readMergedCatalog(provider, predefined),
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
    // Sessions on the deleted model move to the default of the catalog left
    // behind: the first remaining custom model (the new DEFAULT) while only
    // custom models are listed, or the built-in default once none remain.
    const fallbackModelId = mergeProviderModels(
      provider,
      predefined,
      catalog.listCustomProviderModels(provider).filter((record) => record.recordId !== recordId),
      isCustomModelsOnly(provider),
    ).DEFAULT;
    const removed = catalog.deleteCustomProviderModel(provider, recordId, fallbackModelId);
    if (!removed) {
      throw new AppError('Model not found.', {
        code: 'MODEL_NOT_FOUND',
        statusCode: 404,
      });
    }

    return {
      model: toCustomProviderModelOption(removed),
      models: readMergedCatalog(provider, predefined),
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

      const predefined = await resolveProvider(provider).models.getSupportedModels();
      const providerCatalog = readMergedCatalog(provider, predefined);
      const providerModel = await getCurrentActiveModel(provider, normalizedSessionId);
      const resolvedProviderModel = providerModel.model?.trim();
      // Adapters answer with their own built-in default when they know nothing
      // about the session. That value, not the merged default (a custom model
      // while only custom models are listed), is what means "no answer".
      if (resolvedProviderModel && resolvedProviderModel !== predefined.DEFAULT) {
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
    setCustomModelsOnly,
    createCustomModel,
    updateCustomModel,
    deleteCustomModel,
    setSessionModel,
    setSessionEffort,
    resolveSessionModel,
    resolveResumeModel,
  };
};

/** Shared Providers service used by routes, Commands, and provider runtimes. */
export const providerModelsService = createProviderModelsService();
