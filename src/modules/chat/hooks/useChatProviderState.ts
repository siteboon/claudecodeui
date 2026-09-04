import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { authenticatedFetch } from '@/shared/api';
import type { PendingPermissionRequest, PermissionMode } from '@/shared/types';
import type {
  ProjectSession,
  LLMProvider,
  Project,
  CustomProviderModelInput,
  ProviderModelActions,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types';
import {
  DEFAULT_EFFORT_VALUE,
  FALLBACK_PROVIDER_EFFORT_VALUES,
  toProviderEffortOptions,
} from '@/modules/chat/constants/providerEffort';

const FALLBACK_DEFAULT_MODEL: Record<LLMProvider, string> = {
  claude: 'default',
  cursor: 'gpt-5.3-codex',
  codex: 'gpt-5.4',
  opencode: 'anthropic/claude-sonnet-4-5',
  antigravity: 'gemini-3.7-flash',
};

const PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode', 'antigravity'];

const readStoredProvider = (): LLMProvider => {
  const storedProvider = localStorage.getItem('selected-provider');
  return PROVIDERS.includes(storedProvider as LLMProvider)
    ? storedProvider as LLMProvider
    : 'claude';
};

/**
 * Fallback permission-mode matrix used only until the backend capability
 * matrix (`GET /api/providers/capabilities`) has loaded. The backend is the
 * source of truth; this mirror exists so the composer renders sensibly on
 * first paint and when the capabilities request fails.
 */
const FALLBACK_PERMISSION_MODES: Record<LLMProvider, PermissionMode[]> = {
  claude: ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'],
  cursor: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
  codex: ['default', 'acceptEdits', 'bypassPermissions'],
  opencode: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
  antigravity: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
};

type ProviderCapabilities = {
  provider: LLMProvider;
  permissionModes: string[];
  defaultPermissionMode: string;
  supportsImages: boolean;
  supportsFiles: boolean;
  supportsAbort: boolean;
  supportsPermissionRequests: boolean;
  supportsTokenUsage: boolean;
  supportsEffort?: boolean;
  supportsMessageEditing?: boolean;
  supportsSessionForking?: boolean;
};

type ProviderCapabilitiesApiResponse = {
  success?: boolean;
  data?: {
    providers?: ProviderCapabilities[];
  };
};

type UseChatProviderStateArgs = {
  selectedSession: ProjectSession | null;
  selectedProject: Project | null;
}

type ProviderModelsApiResponse = {
  success?: boolean;
  data?: {
    models?: ProviderModelsDefinition;
  };
};

type ProviderModelMutationApiResponse = {
  success?: boolean;
  data?: {
    model?: ProviderModelOption;
    models?: ProviderModelsDefinition;
  };
  error?: {
    message?: string;
  };
};

type SessionSelectionApiResponse = {
  success?: boolean;
  data?: {
    provider?: LLMProvider;
    sessionId?: string | null;
    model?: string | null;
    effort?: string | null;
    /**
     * `session` and `provider` are real answers for this session; `default`
     * means the backend had nothing recorded and returned the catalog default,
     * which the composer replaces with the user's per-provider selection.
     */
    source?: 'session' | 'provider' | 'default';
  };
};

type SessionProviderSelection = {
  provider: LLMProvider;
  sessionId: string;
  model: string | null;
  effort: string | null;
};

const getSessionSelectionKey = (provider: LLMProvider, sessionId: string): string => (
  `${provider}:${sessionId}`
);

export function useChatProviderState({ selectedSession, selectedProject: _selectedProject }: UseChatProviderStateArgs) {
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [provider, setProvider] = useState<LLMProvider>(readStoredProvider);
  // One map for the per-provider default model, mirroring the upstream
  // providerModels API. Each provider keeps its own `<provider>-model`
  // storage key so selections made before the merge still resolve.
  const [providerModels, setProviderModels] = useState<Record<LLMProvider, string>>(() => (
    PROVIDERS.reduce<Record<LLMProvider, string>>((acc, targetProvider) => {
      acc[targetProvider] = localStorage.getItem(`${targetProvider}-model`) || FALLBACK_DEFAULT_MODEL[targetProvider];
      return acc;
    }, {} as Record<LLMProvider, string>)
  ));
  const [providerEfforts, setProviderEfforts] = useState<Partial<Record<LLMProvider, string>>>(() => {
    return PROVIDERS.reduce<Partial<Record<LLMProvider, string>>>((acc, targetProvider) => {
      acc[targetProvider] = localStorage.getItem(`${targetProvider}-effort`) || DEFAULT_EFFORT_VALUE;
      return acc;
    }, {});
  });

  /**
   * Backend-owned capability matrix keyed by provider. Drives the permission
   * mode picker (and is the extension point for future per-provider UI
   * differences) so the frontend stays free of hardcoded provider branching.
   * Null until `/api/providers/capabilities` resolves; the static fallback
   * map covers that window.
   */
  const [providerCapabilities, setProviderCapabilities] = useState<
    Partial<Record<LLMProvider, ProviderCapabilities>> | null
  >(null);

  const [providerModelCatalog, setProviderModelCatalog] = useState<
    Partial<Record<LLMProvider, ProviderModelsDefinition>>
  >({});
  const [providerModelsLoading, setProviderModelsLoading] = useState(true);

  const providerModelsRequestIdRef = useRef(0);
  const sessionSelectionLoadRequestIdRef = useRef(0);
  const sessionModelMutationIdRef = useRef(0);
  const sessionEffortMutationIdRef = useRef(0);

  const setProviderModel = useCallback((targetProvider: LLMProvider, model: string) => {
    setProviderModels((previous) => (
      previous[targetProvider] === model
        ? previous
        : { ...previous, [targetProvider]: model }
    ));
    localStorage.setItem(`${targetProvider}-model`, model);
  }, []);

  const setStoredProviderEffort = useCallback((targetProvider: LLMProvider, effort: string) => {
    setProviderEfforts((previous) => (
      previous[targetProvider] === effort
        ? previous
        : { ...previous, [targetProvider]: effort }
    ));
    localStorage.setItem(`${targetProvider}-effort`, effort);
  }, []);

  const loadProviderModels = useCallback(async () => {
    const requestId = providerModelsRequestIdRef.current + 1;
    providerModelsRequestIdRef.current = requestId;
    setProviderModelsLoading(true);

    try {
      const results = await Promise.all(
        PROVIDERS.map(async (p) => {
          const response = await authenticatedFetch(`/api/providers/${p}/models`);
          const body = (await response.json()) as ProviderModelsApiResponse;
          if (!body.success || !body.data?.models) {
            return null;
          }

          return body.data.models;
        }),
      );

      if (providerModelsRequestIdRef.current !== requestId) {
        return;
      }

      const nextCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>> = {};

      PROVIDERS.forEach((p, i) => {
        const entry = results[i];
        if (!entry) {
          return;
        }

        nextCatalog[p] = entry;
      });

      setProviderModelCatalog(nextCatalog);
    } catch (error) {
      console.error('Error loading provider models:', error);
    } finally {
      if (providerModelsRequestIdRef.current === requestId) {
        setProviderModelsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadProviderModels();
  }, [loadProviderModels]);

  useEffect(() => {
    let cancelled = false;

    const loadCapabilities = async () => {
      try {
        const response = await authenticatedFetch('/api/providers/capabilities');
        const body = (await response.json()) as ProviderCapabilitiesApiResponse;
        if (cancelled || !body.success || !Array.isArray(body.data?.providers)) {
          return;
        }

        const byProvider: Partial<Record<LLMProvider, ProviderCapabilities>> = {};
        for (const capabilities of body.data.providers) {
          byProvider[capabilities.provider] = capabilities;
        }
        setProviderCapabilities(byProvider);
      } catch (error) {
        console.error('Error loading provider capabilities:', error);
      }
    };

    void loadCapabilities();
    return () => {
      cancelled = true;
    };
  }, []);

  const getPermissionModesForProvider = useCallback((targetProvider: LLMProvider): PermissionMode[] => {
    const capabilityModes = providerCapabilities?.[targetProvider]?.permissionModes;
    if (capabilityModes && capabilityModes.length > 0) {
      return capabilityModes as PermissionMode[];
    }
    return FALLBACK_PERMISSION_MODES[targetProvider] ?? ['default'];
  }, [providerCapabilities]);

  const getDefaultPermissionModeForProvider = useCallback((targetProvider: LLMProvider): PermissionMode => {
    const modes = getPermissionModesForProvider(targetProvider);
    const capabilityDefault = providerCapabilities?.[targetProvider]?.defaultPermissionMode as PermissionMode | undefined;
    if (capabilityDefault && modes.includes(capabilityDefault)) {
      return capabilityDefault;
    }
    return modes[0] ?? 'default';
  }, [getPermissionModesForProvider, providerCapabilities]);

  const getSupportsEffortForProvider = useCallback((targetProvider: LLMProvider): boolean => {
    const capabilitySupport = providerCapabilities?.[targetProvider]?.supportsEffort;
    if (typeof capabilitySupport === 'boolean') {
      return capabilitySupport;
    }
    return Boolean(FALLBACK_PROVIDER_EFFORT_VALUES[targetProvider]?.length);
  }, [providerCapabilities]);

  const pickStoredOrCurrent = (
    storageKey: string,
    current: string,
    def: ProviderModelsDefinition,
  ): string => {
    const stored = localStorage.getItem(storageKey);
    if (stored && def.OPTIONS.some((o) => o.value === stored)) {
      return stored;
    }
    if (current && def.OPTIONS.some((o) => o.value === current)) {
      return current;
    }
    return def.DEFAULT;
  };

  const getModelOption = useCallback((
    targetProvider: LLMProvider,
    model: string,
  ): ProviderModelOption | null => {
    const definition = providerModelCatalog[targetProvider];
    if (!definition) {
      return null;
    }

    return definition.OPTIONS.find((option) => option.value === model) ?? null;
  }, [providerModelCatalog]);

  const getEffortOptionsForModel = useCallback((
    targetProvider: LLMProvider,
    model: string,
  ): NonNullable<ProviderModelOption['effort']>['values'] => {
    if (!getSupportsEffortForProvider(targetProvider)) {
      return [];
    }

    const option = getModelOption(targetProvider, model);
    if (option) {
      return option.effort?.values ?? [];
    }

    return toProviderEffortOptions(FALLBACK_PROVIDER_EFFORT_VALUES[targetProvider] ?? []);
  }, [getModelOption, getSupportsEffortForProvider]);

  const getAllowedEffortValues = useCallback((
    targetProvider: LLMProvider,
    model: string,
  ): string[] => (
    getEffortOptionsForModel(targetProvider, model).map((value) => value.value)
  ), [getEffortOptionsForModel]);

  const reconcileStoredEffort = useCallback((
    targetProvider: LLMProvider,
    model: string,
    currentEffort: string,
  ): string => {
    const allowedValues = getAllowedEffortValues(targetProvider, model);
    if (allowedValues.length === 0) {
      return DEFAULT_EFFORT_VALUE;
    }

    if (currentEffort === DEFAULT_EFFORT_VALUE || !currentEffort) {
      return DEFAULT_EFFORT_VALUE;
    }

    if (allowedValues.includes(currentEffort)) {
      return currentEffort;
    }

    return DEFAULT_EFFORT_VALUE;
  }, [getAllowedEffortValues]);

  // One reconciliation pass over every provider: when a catalog arrives,
  // resolve each stored model against it (falling back to the catalog
  // default) instead of running one near-identical effect per provider.
  useEffect(() => {
    setProviderModels((previous) => {
      let changed = false;
      const next = { ...previous };

      for (const targetProvider of PROVIDERS) {
        const definition = providerModelCatalog[targetProvider];
        if (!definition) {
          continue;
        }

        const stored = localStorage.getItem(`${targetProvider}-model`);
        const current = previous[targetProvider];
        let resolved = definition.DEFAULT;
        if (stored && definition.OPTIONS.some((option) => option.value === stored)) {
          resolved = stored;
        } else if (current && definition.OPTIONS.some((option) => option.value === current)) {
          resolved = current;
        }

        if (resolved !== current) {
          next[targetProvider] = resolved;
          localStorage.setItem(`${targetProvider}-model`, resolved);
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [providerModelCatalog]);

  useEffect(() => {
    const nextEfforts: Partial<Record<LLMProvider, string>> = {};
    let hasUpdates = false;

    for (const targetProvider of PROVIDERS) {
      const currentEffort = providerEfforts[targetProvider] ?? DEFAULT_EFFORT_VALUE;
      const nextEffort = reconcileStoredEffort(targetProvider, providerModels[targetProvider], currentEffort);
      if (nextEffort === currentEffort) {
        continue;
      }

      nextEfforts[targetProvider] = nextEffort;
      localStorage.setItem(`${targetProvider}-effort`, nextEffort);
      hasUpdates = true;
    }

    if (hasUpdates) {
      setProviderEfforts((previous) => ({ ...previous, ...nextEfforts }));
    }
  }, [providerEfforts, providerModels, reconcileStoredEffort]);

  useEffect(() => {
    const validModes = getPermissionModesForProvider(provider);
    const sessionSavedMode = selectedSession?.id
      ? (localStorage.getItem(`permissionMode-${selectedSession.id}`) as PermissionMode | null)
      : null;
    // Fall back to the last mode picked for this provider: a brand-new chat
    // only receives its session id after the first send, so without this the
    // mode chosen beforehand would snap back to the default as soon as the
    // session id appears.
    const providerSavedMode = localStorage.getItem(`permissionMode-last-${provider}`) as PermissionMode | null;
    const savedMode = [sessionSavedMode, providerSavedMode].find(
      (mode): mode is PermissionMode => Boolean(mode && validModes.includes(mode)),
    );
    setPermissionMode(savedMode ?? getDefaultPermissionModeForProvider(provider));
  }, [selectedSession?.id, provider, getDefaultPermissionModeForProvider, getPermissionModesForProvider]);

  useEffect(() => {
    if (!selectedSession?.__provider || selectedSession.__provider === provider) {
      return;
    }

    setProvider(selectedSession.__provider);
    localStorage.setItem('selected-provider', selectedSession.__provider);
  }, [provider, selectedSession]);

  // Permission prompts belong to a session, not to the transient provider
  // selection that is synchronized after navigation.
  useEffect(() => {
    setPendingPermissionRequests((previous) =>
      previous.filter((request) => !request.sessionId || request.sessionId === selectedSession?.id),
    );
  }, [selectedSession?.id]);

  const selectPermissionMode = useCallback((nextMode: PermissionMode) => {
    setPermissionMode(nextMode);

    // Persist per provider as well as per session: a brand-new chat has no
    // session id yet, and the per-provider key keeps the choice sticky when
    // the real id arrives (and for future sessions of this provider).
    localStorage.setItem(`permissionMode-last-${provider}`, nextMode);
    if (selectedSession?.id) {
      localStorage.setItem(`permissionMode-${selectedSession.id}`, nextMode);
    }
  }, [provider, selectedSession?.id]);

  const cyclePermissionMode = useCallback(() => {
    const modes = getPermissionModesForProvider(provider);

    const currentIndex = modes.indexOf(permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    selectPermissionMode(modes[nextIndex]);
  }, [permissionMode, provider, getPermissionModesForProvider, selectPermissionMode]);

  const availablePermissionModes = useMemo(
    () => getPermissionModesForProvider(provider),
    [getPermissionModesForProvider, provider],
  );

  const resolvePermissionModeForProvider = useCallback((
    targetProvider: LLMProvider,
    requestedMode: PermissionMode | string,
  ): PermissionMode => {
    const validModes = getPermissionModesForProvider(targetProvider);
    return validModes.includes(requestedMode as PermissionMode)
      ? requestedMode as PermissionMode
      : getDefaultPermissionModeForProvider(targetProvider);
  }, [getDefaultPermissionModeForProvider, getPermissionModesForProvider]);

  /** Model and reasoning effort recorded for the open session by the backend. */
  const [sessionSelection, setSessionSelection] = useState<SessionProviderSelection | null>(null);
  const selectedSessionId = selectedSession?.id?.trim() || null;
  const selectedSessionProvider = selectedSession?.__provider ?? provider;
  const selectedSessionKey = selectedSessionId
    ? getSessionSelectionKey(selectedSessionProvider, selectedSessionId)
    : null;
  const selectedSessionKeyRef = useRef<string | null>(selectedSessionKey);
  selectedSessionKeyRef.current = selectedSessionKey;

  const activeSessionSelection = sessionSelection
    && selectedSessionId
    && sessionSelection.sessionId === selectedSessionId
    && sessionSelection.provider === selectedSessionProvider
    ? sessionSelection
    : null;
  const sessionModel = activeSessionSelection?.model ?? null;

  useEffect(() => {
    const requestId = sessionSelectionLoadRequestIdRef.current + 1;
    sessionSelectionLoadRequestIdRef.current = requestId;

    if (!selectedSessionId) {
      setSessionSelection(null);
      return;
    }

    let cancelled = false;
    const targetProvider = selectedSessionProvider;
    const targetSessionKey = getSessionSelectionKey(targetProvider, selectedSessionId);

    const loadSessionSelection = async () => {
      try {
        const response = await authenticatedFetch(
          `/api/providers/${targetProvider}/sessions/${encodeURIComponent(selectedSessionId)}/active-model`,
        );
        const body = (await response.json()) as SessionSelectionApiResponse;
        if (
          cancelled
          || sessionSelectionLoadRequestIdRef.current !== requestId
          || selectedSessionKeyRef.current !== targetSessionKey
        ) {
          return;
        }

        const resolvedModel = body.data?.model?.trim();
        const resolvedEffort = body.data?.effort?.trim() || null;
        setSessionSelection({
          provider: targetProvider,
          sessionId: selectedSessionId,
          model: body.success && resolvedModel && body.data?.source !== 'default' ? resolvedModel : null,
          effort: body.success ? resolvedEffort : null,
        });
      } catch (error) {
        if (
          !cancelled
          && sessionSelectionLoadRequestIdRef.current === requestId
          && selectedSessionKeyRef.current === targetSessionKey
        ) {
          console.error('Error loading the session model and reasoning effort:', error);
          setSessionSelection({
            provider: targetProvider,
            sessionId: selectedSessionId,
            model: null,
            effort: null,
          });
        }
      }
    };

    void loadSessionSelection();
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId, selectedSessionProvider]);

  /**
   * Applies a model choice.
   *
   * The pick always becomes the per-provider default so the next new chat
   * inherits it, and — when a session is open — is also recorded against that
   * session so reopening it later restores this model.
   */
  const selectProviderModel = useCallback(async (
    targetProvider: LLMProvider,
    model: string,
    sessionId?: string | null,
  ) => {
    setProviderModel(targetProvider, model);

    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId) {
      return { scope: 'default' as const, model };
    }

    // A pending GET represents the state before this click and must not win
    // if it resolves after the mutation.
    sessionSelectionLoadRequestIdRef.current += 1;
    const mutationId = sessionModelMutationIdRef.current + 1;
    sessionModelMutationIdRef.current = mutationId;
    const targetSessionKey = getSessionSelectionKey(targetProvider, normalizedSessionId);

    const response = await authenticatedFetch(
      `/api/providers/${targetProvider}/sessions/${encodeURIComponent(normalizedSessionId)}/active-model`,
      {
        method: 'POST',
        body: JSON.stringify({ model }),
      },
    );

    const body = (await response.json()) as SessionSelectionApiResponse;
    if (!response.ok || !body.success) {
      throw new Error('Unable to change the active model for this session.');
    }

    const storedModel = body.data?.model?.trim() || model;
    if (
      sessionModelMutationIdRef.current === mutationId
      && selectedSessionKeyRef.current === targetSessionKey
    ) {
      setSessionSelection((current) => ({
        provider: targetProvider,
        sessionId: normalizedSessionId,
        model: storedModel,
        effort: current?.provider === targetProvider && current.sessionId === normalizedSessionId
          ? current.effort
          : body.data?.effort?.trim() || null,
      }));
    }
    return { scope: 'session' as const, model: storedModel };
  }, [setProviderModel]);

  /**
   * Applies an effort choice optimistically and persists it for the open
   * session. Mutation counters keep slower earlier requests from overwriting
   * the latest click.
   */
  const selectProviderEffort = useCallback(async (
    targetProvider: LLMProvider,
    effort: string,
    sessionId?: string | null,
  ) => {
    setStoredProviderEffort(targetProvider, effort);

    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId) {
      return { scope: 'default' as const, effort };
    }

    sessionSelectionLoadRequestIdRef.current += 1;
    const mutationId = sessionEffortMutationIdRef.current + 1;
    sessionEffortMutationIdRef.current = mutationId;
    const targetSessionKey = getSessionSelectionKey(targetProvider, normalizedSessionId);
    const previousSelection = sessionSelection?.provider === targetProvider
      && sessionSelection.sessionId === normalizedSessionId
      ? sessionSelection
      : null;

    setSessionSelection({
      provider: targetProvider,
      sessionId: normalizedSessionId,
      model: previousSelection?.model ?? null,
      effort,
    });

    try {
      const response = await authenticatedFetch(
        `/api/providers/${targetProvider}/sessions/${encodeURIComponent(normalizedSessionId)}/active-effort`,
        {
          method: 'POST',
          body: JSON.stringify({ effort }),
        },
      );
      const body = (await response.json()) as SessionSelectionApiResponse;
      if (!response.ok || !body.success) {
        throw new Error('Unable to change the reasoning effort for this session.');
      }

      const storedEffort = body.data?.effort?.trim() || effort;
      if (
        sessionEffortMutationIdRef.current === mutationId
        && selectedSessionKeyRef.current === targetSessionKey
      ) {
        setSessionSelection((current) => ({
          provider: targetProvider,
          sessionId: normalizedSessionId,
          model: current?.provider === targetProvider && current.sessionId === normalizedSessionId
            ? current.model
            : previousSelection?.model ?? null,
          effort: storedEffort,
        }));
      }

      return { scope: 'session' as const, effort: storedEffort };
    } catch (error) {
      if (
        sessionEffortMutationIdRef.current === mutationId
        && selectedSessionKeyRef.current === targetSessionKey
      ) {
        setSessionSelection((current) => (
          current?.provider === targetProvider
          && current.sessionId === normalizedSessionId
          && current.effort === effort
            ? previousSelection
            : current
        ));
      }
      throw error;
    }
  }, [sessionSelection, setStoredProviderEffort]);

  // The open session's model wins over the per-provider default, so switching
  // sessions shows (and sends) what each session actually runs with.
  const currentProviderModel = sessionModel ?? providerModels[provider];
  const currentProviderEffortOptions = useMemo(() => {
    return getEffortOptionsForModel(provider, currentProviderModel);
  }, [currentProviderModel, getEffortOptionsForModel, provider]);
  const currentProviderEffort = useMemo(() => {
    return reconcileStoredEffort(
      provider,
      currentProviderModel,
      activeSessionSelection?.effort
        ?? providerEfforts[provider]
        ?? DEFAULT_EFFORT_VALUE,
    );
  }, [activeSessionSelection?.effort, currentProviderModel, provider, providerEfforts, reconcileStoredEffort]);
  const currentProviderModelOptions = useMemo(
    () => providerModelCatalog[provider]?.OPTIONS ?? [],
    [provider, providerModelCatalog],
  );

  // Capability gates for the transcript affordances (edit & resend, fork from
  // here). Server matrix wins once loaded; until then assume supported, since
  // the primary providers (claude, codex) implement both.
  const supportsMessageEditing = providerCapabilities?.[provider]?.supportsMessageEditing ?? true;
  const supportsSessionForking = providerCapabilities?.[provider]?.supportsSessionForking ?? true;

  const applyProviderCatalog = useCallback((
    targetProvider: LLMProvider,
    models: ProviderModelsDefinition,
  ) => {
    setProviderModelCatalog((previous) => ({
      ...previous,
      [targetProvider]: models,
    }));
  }, []);

  const readModelMutationResponse = useCallback(async (
    response: Response,
  ): Promise<Required<Pick<NonNullable<ProviderModelMutationApiResponse['data']>, 'model' | 'models'>>> => {
    const body = (await response.json()) as ProviderModelMutationApiResponse;
    if (!response.ok || !body.success || !body.data?.model || !body.data.models) {
      throw new Error(body.error?.message || 'Unable to save this model.');
    }

    return {
      model: body.data.model,
      models: body.data.models,
    };
  }, []);

  const createCustomModel = useCallback(async (
    targetProvider: LLMProvider,
    input: CustomProviderModelInput,
  ) => {
    const response = await authenticatedFetch(`/api/providers/${targetProvider}/models`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    const result = await readModelMutationResponse(response);
    applyProviderCatalog(targetProvider, result.models);
  }, [applyProviderCatalog, readModelMutationResponse]);

  const updateCustomModel = useCallback(async (
    targetProvider: LLMProvider,
    existing: ProviderModelOption,
    input: CustomProviderModelInput,
  ) => {
    if (!existing.recordId) {
      throw new Error('This model cannot be edited.');
    }

    const response = await authenticatedFetch(
      `/api/providers/${targetProvider}/models/${existing.recordId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
    );
    const result = await readModelMutationResponse(response);
    applyProviderCatalog(targetProvider, result.models);

    if (providerModels[targetProvider] === existing.value) {
      setProviderModel(targetProvider, result.model.value);
    }
    if (provider === targetProvider && sessionModel === existing.value) {
      setSessionSelection((current) => current ? {
        ...current,
        model: result.model.value,
      } : current);
    }
  }, [
    applyProviderCatalog,
    provider,
    providerModels,
    readModelMutationResponse,
    sessionModel,
    setProviderModel,
  ]);

  const removeCustomModel = useCallback(async (
    targetProvider: LLMProvider,
    existing: ProviderModelOption,
  ) => {
    if (!existing.recordId) {
      throw new Error('This model cannot be deleted.');
    }

    const response = await authenticatedFetch(
      `/api/providers/${targetProvider}/models/${existing.recordId}`,
      { method: 'DELETE' },
    );
    const result = await readModelMutationResponse(response);
    applyProviderCatalog(targetProvider, result.models);

    if (providerModels[targetProvider] === existing.value) {
      setProviderModel(targetProvider, result.models.DEFAULT);
    }
    if (provider === targetProvider && sessionModel === existing.value) {
      setSessionSelection((current) => current ? {
        ...current,
        model: result.models.DEFAULT,
      } : current);
    }
  }, [
    applyProviderCatalog,
    provider,
    providerModels,
    readModelMutationResponse,
    sessionModel,
    setProviderModel,
  ]);

  const providerModelActions = useMemo<ProviderModelActions>(() => ({
    create: createCustomModel,
    update: updateCustomModel,
    remove: removeCustomModel,
  }), [createCustomModel, removeCustomModel, updateCustomModel]);

  return {
    provider,
    setProvider,
    supportsMessageEditing,
    supportsSessionForking,
    providerModels,
    setProviderModel,
    currentProviderEffort,
    currentProviderEffortOptions,
    currentProviderModel,
    currentProviderModelOptions,

    permissionMode,
    setPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    availablePermissionModes,
    selectPermissionMode,
    cyclePermissionMode,
    providerModelCatalog,
    providerModelsLoading,
    providerModelActions,
    selectProviderModel,
    selectProviderEffort,
    resolvePermissionModeForProvider,
  };
}
