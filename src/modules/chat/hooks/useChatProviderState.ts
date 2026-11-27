import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { PendingPermissionRequest, PermissionMode,
  ProjectSession,
  LLMProvider,
  Project,
  ChatDefaultsState,
  CustomProviderModelInput,
  ProviderModelActions,
  ProviderModelOption,
  ProviderModelsApiResponse,
  ProviderModelsDefinition,
  SessionEstablishedContext } from '@/shared/types';
import { DEFAULT_EFFORT_VALUE } from '@/shared/constants';
import { readSelectedProvider, writeSelectedProvider } from '@/shared/selectedProvider';
import { readUserPreference, subscribeToUserPreferences } from '@/shared/userSettings';
import { normalizeChatDefaults } from '@/shared/utils';

const FALLBACK_PROVIDER_EFFORT_VALUES: Partial<Record<LLMProvider, readonly string[]>> = {
  // Superset used only before the model catalog loads; `ultracode` belongs to the
  // xhigh-capable models alone, but listing it here keeps a stored ultracode
  // selection from being reset during catalog hydration.
  claude: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
  // Superset used only before the model catalog loads. Per-model metadata
  // narrows this once available; including the GPT-5.6 tiers here prevents a
  // valid Max/Ultra selection from being reset during catalog hydration.
  codex: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  opencode: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
};

const toProviderEffortOptions = (
  values: readonly string[],
): NonNullable<ProviderModelOption['effort']>['values'] => values.map((value) => ({ value }));

const FALLBACK_DEFAULT_MODEL: Record<LLMProvider, string> = {
  claude: 'default',
  cursor: 'gpt-5.3-codex',
  // The server catalog's DEFAULT. A new browser keeps this model for as long
  // as the catalog lists it, so it must be one the bundled Codex CLI knows;
  // any other model runs on the CLI's fallback metadata.
  codex: 'gpt-5.6-sol',
  opencode: 'anthropic/claude-sonnet-4-5',
};

const PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode'];

type ComposerSession = { provider: LLMProvider; sessionId: string };
type SeededSession = ComposerSession & { newSessionTrigger: number | undefined; projectPath: string | null };

/**
 * The session a model or effort pick is saved on: the composer's. A value from
 * another provider's catalog cannot run on it, so then it only becomes that
 * provider's default. Shared by the save and the /model modal's wording.
 */
const pickTargetFor = (session: ComposerSession | null, targetProvider: LLMProvider): ComposerSession | null => (
  session?.provider === targetProvider ? session : null
);

/** How long a session load waits for that session's selection saves before reading anyway. */
const SESSION_SAVE_WAIT_MS = 10_000;

/** localStorage key holding the user's default model for one provider. */
const providerModelStorageKey = (provider: LLMProvider): string => `${provider}-model`;

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
  supportsSideQuestions?: boolean;
  supportsSteering?: boolean;
  supportsContextClearing?: boolean;
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
  /** Bumped on every New Session click, which starts a new chat even in place. */
  newSessionTrigger?: number;
  /**
   * The chat's own session id (useChatSessionState): set when a new chat
   * creates its session, kept while that first reply runs before navigation
   * selects it, and cleared on New Session or navigating away.
   */
  currentSessionId?: string | null;
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
    /** NULL until the session records a permission mode. */
    permissionMode?: string | null;
  };
};

type SessionProviderSelection = {
  provider: LLMProvider;
  sessionId: string;
  model: string | null;
  effort: string | null;
  permissionMode: string | null;
};

/** What a new chat in one project starts with; nulls fall back to per-provider defaults. */
type ProjectProviderSelection = {
  provider: LLMProvider;
  projectPath: string;
  model: string | null;
  effort: string | null;
  permissionMode: string | null;
};

type ProjectSelectionField = 'model' | 'effort' | 'permissionMode';

type ProjectSelectionApiResponse = {
  success?: boolean;
  data?: Partial<Pick<ProjectProviderSelection, ProjectSelectionField>>;
};

const getSessionSelectionKey = (provider: LLMProvider, sessionId: string): string => (
  `${provider}:${sessionId}`
);

/** Reads the new-session defaults saved on the settings page from the preferences mirror. */
function readChatDefaults(): ChatDefaultsState {
  return normalizeChatDefaults(readUserPreference<unknown>('chatDefaults', {}));
}

export function useChatProviderState({
  selectedSession,
  selectedProject,
  newSessionTrigger,
  currentSessionId = null,
}: UseChatProviderStateArgs) {
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  // The provider the composer sends under. Held here rather than read from
  // storage per render because switching it has to reset the model menu, the
  // permission mode and the session in one commit.
  const [storedProvider, setProvider] = useState<LLMProvider>(readSelectedProvider);
  // An open session runs under its own provider. Derived rather than synced
  // by an effect, so nothing ever sees the composer's previous provider for a
  // render after navigation and saves a selection under the wrong one.
  const provider = selectedSession?.__provider ?? storedProvider;
  // Every provider's chosen model, not just the active one: switching provider
  // must restore the model that provider was last used with, and the catalogue
  // that validates them arrives asynchronously per provider.
  const [providerModels, setProviderModels] = useState<Record<LLMProvider, string>>(() => {
    const storedDefaults = readChatDefaults();
    return PROVIDERS.reduce<Record<LLMProvider, string>>((acc, targetProvider) => {
      const model = storedDefaults[targetProvider]?.model;
      acc[targetProvider] = model
        || localStorage.getItem(providerModelStorageKey(targetProvider))
        || FALLBACK_DEFAULT_MODEL[targetProvider];
      return acc;
    }, {} as Record<LLMProvider, string>);
  });
  const [providerEfforts, setProviderEfforts] = useState<Partial<Record<LLMProvider, string>>>(() => {
    const storedDefaults = readChatDefaults();
    return PROVIDERS.reduce<Partial<Record<LLMProvider, string>>>((acc, targetProvider) => {
      const effort = storedDefaults[targetProvider]?.effort;
      acc[targetProvider] = effort
        || localStorage.getItem(`${targetProvider}-effort`)
        || DEFAULT_EFFORT_VALUE;
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
  /**
   * The defaults last written into the composer. The preference subscription
   * fires for every setting, so comparing against this tells an actual
   * chat-defaults edit apart from an unrelated change (a theme switch, say),
   * which must not overwrite a model the user just picked.
   */
  const appliedDefaultsRef = useRef<ChatDefaultsState | null>(null);
  const sessionSelectionLoadRequestIdRef = useRef(0);
  const sessionModelMutationIdRef = useRef(0);
  const sessionEffortMutationIdRef = useRef(0);

  const [projectSelection, setProjectSelection] = useState<ProjectProviderSelection | null>(null);
  // `provider:field` pairs the user picked in this new chat, with the picked
  // value (null: cleared), which a project selection arriving afterwards keeps.
  const pickedProjectFieldsRef = useRef(new Map<string, string | null>());

  /** Drops one project value once the user picks that field themselves. */
  const clearProjectSelectionField = useCallback((targetProvider: LLMProvider, field: ProjectSelectionField) => {
    pickedProjectFieldsRef.current.set(`${targetProvider}:${field}`, null);
    setProjectSelection((current) => (
      current?.provider === targetProvider && current[field] !== null ? { ...current, [field]: null } : current
    ));
  }, []);

  const setStoredProviderModel = useCallback((targetProvider: LLMProvider, model: string) => {
    setProviderModels((previous) => (
      previous[targetProvider] === model
        ? previous
        : { ...previous, [targetProvider]: model }
    ));
    localStorage.setItem(providerModelStorageKey(targetProvider), model);
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
      // Each provider lands in the catalog as soon as it answers, so a slow
      // one (OpenCode shells out to its CLI) cannot hold back the others.
      await Promise.all(
        PROVIDERS.map(async (p) => {
          try {
            const response = await api.providers.models(p);
            const body = (await response.json()) as ProviderModelsApiResponse;
            const models = body.success ? body.data?.models : undefined;
            if (!models || providerModelsRequestIdRef.current !== requestId) {
              return;
            }

            setProviderModelCatalog((previous) => ({ ...previous, [p]: models }));
          } catch (error) {
            console.error(`Error loading ${p} models:`, error);
          }
        }),
      );
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
        const response = await api.providers.capabilities();
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

  // One reconciliation pass over every provider, mirroring the effort effect
  // below. This was four copy-pasted eleven-line effects, one per provider.
  useEffect(() => {
    const reconciledModels: Partial<Record<LLMProvider, string>> = {};

    for (const targetProvider of PROVIDERS) {
      const catalog = providerModelCatalog[targetProvider];
      if (!catalog) {
        continue;
      }

      const currentModel = providerModels[targetProvider];
      const nextModel = catalog.OPTIONS.some((option) => option.value === currentModel)
        ? currentModel : catalog.DEFAULT;

      if (nextModel !== currentModel) {
        reconciledModels[targetProvider] = nextModel;
      }
      const storageKey = providerModelStorageKey(targetProvider);
      const rememberedModel = localStorage.getItem(storageKey);
      if (rememberedModel && !catalog.OPTIONS.some((option) => option.value === rememberedModel)) {
        localStorage.setItem(storageKey, catalog.DEFAULT);
      }
    }

    if (Object.keys(reconciledModels).length > 0) {
      setProviderModels((previous) => ({ ...previous, ...reconciledModels }));
    }
  }, [providerModelCatalog, providerModels]);

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
      hasUpdates = true;
    }

    if (hasUpdates) {
      setProviderEfforts((previous) => ({ ...previous, ...nextEfforts }));
    }
  }, [providerEfforts, providerModels, reconcileStoredEffort]);

  /**
   * Applies the settings page's new-session defaults to the composer. Only
   * fields the user actually configured are touched, so an unset default keeps
   * the previous "remember my last pick" behaviour.
   */
  const applyStoredChatDefaults = useCallback(() => {
    const storedDefaults = readChatDefaults();
    appliedDefaultsRef.current = storedDefaults;

    // 设置页的默认值只影响本次显示，浏览器的最后手选留给解除默认值后的新会话。
    setProviderModels((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const targetProvider of PROVIDERS) {
        const model = storedDefaults[targetProvider]?.model
          ?? localStorage.getItem(providerModelStorageKey(targetProvider))
          ?? FALLBACK_DEFAULT_MODEL[targetProvider];
        if (model !== previous[targetProvider]) {
          next[targetProvider] = model;
          changed = true;
        }
      }
      return changed ? next : previous;
    });

    setProviderEfforts((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const targetProvider of PROVIDERS) {
        const effort = storedDefaults[targetProvider]?.effort
          ?? localStorage.getItem(`${targetProvider}-effort`)
          ?? DEFAULT_EFFORT_VALUE;
        if (effort !== previous[targetProvider]) {
          next[targetProvider] = effort;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, []);

  // A new chat has no stored selection, so it starts from the saved defaults.
  // Re-applying when the preferences change covers the settings dialog being
  // edited while this blank composer stays mounted — but only when the defaults
  // themselves changed. The subscription fires for every preference, and
  // re-applying on a theme switch would undo a model the user just picked.
  useEffect(() => {
    if (selectedSession?.id) {
      return;
    }

    applyStoredChatDefaults();
    return subscribeToUserPreferences(() => {
      if (selectedSession?.id) {
        return;
      }
      const nextDefaults = readChatDefaults();
      if (JSON.stringify(nextDefaults) === JSON.stringify(appliedDefaultsRef.current)) {
        return;
      }
      applyStoredChatDefaults();
    });
  }, [selectedSession?.id, applyStoredChatDefaults]);

  // Still remembered, so a new chat after this session starts with its provider.
  useEffect(() => {
    if (!selectedSession?.__provider || selectedSession.__provider === storedProvider) {
      return;
    }

    setProvider(selectedSession.__provider);
    writeSelectedProvider(selectedSession.__provider);
  }, [storedProvider, selectedSession]);

  // Permission prompts belong to a session, not to the transient provider
  // selection that is synchronized after navigation.
  useEffect(() => {
    setPendingPermissionRequests((previous) =>
      previous.filter((request) => !request.sessionId || request.sessionId === selectedSession?.id),
    );
  }, [selectedSession?.id]);

  const availablePermissionModes = useMemo(
    () => getPermissionModesForProvider(provider),
    [getPermissionModesForProvider, provider],
  );

  /**
   * Both default to false until the matrix loads, so an affordance is never
   * offered and then withdrawn — and never offered at all for a provider whose
   * runtime would reject it.
   */
  const supportsMessageEditing = Boolean(providerCapabilities?.[provider]?.supportsMessageEditing);
  const supportsSessionForking = Boolean(providerCapabilities?.[provider]?.supportsSessionForking);
  const supportsSideQuestions = Boolean(providerCapabilities?.[provider]?.supportsSideQuestions);
  const supportsSteering = Boolean(providerCapabilities?.[provider]?.supportsSteering);
  const supportsContextClearing = Boolean(providerCapabilities?.[provider]?.supportsContextClearing);

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
  const selectedSessionKey = selectedSessionId
    ? getSessionSelectionKey(provider, selectedSessionId)
    : null;
  const selectedSessionKeyRef = useRef<string | null>(selectedSessionKey);
  selectedSessionKeyRef.current = selectedSessionKey;

  const activeSessionSelection = sessionSelection
    && selectedSessionId
    && sessionSelection.sessionId === selectedSessionId
    && sessionSelection.provider === provider
    ? sessionSelection
    : null;
  const sessionModel = activeSessionSelection?.model ?? null;

  const selectedProjectPath = selectedProject?.fullPath?.trim() || null;
  // The session this new chat just created, until navigation selects it.
  // State, not a ref: what the composer targets has to re-render its readers.
  const [seededSession, setSeededSession] = useState<SeededSession | null>(null);
  // Selection saves still in flight per session id, each with the field it
  // writes, and a count of all saves ever started. A load of a session waits
  // for its saves and reads again when any save started during its read, so
  // it never answers with a row a pick missed. One count for all sessions
  // costs at most a spare read.
  const pendingSessionSavesRef = useRef(new Map<string, Map<Promise<unknown>, ProjectSelectionField>>());
  const startedSessionSavesRef = useRef(0);
  // Snapshots for a permission-mode rollback, without making the pick
  // callback change identity on every selection change.
  const permissionModeRef = useRef(permissionMode);
  // The latest permission-mode pick per session: only that one may roll back.
  const permissionPickRef = useRef(new Map<string, number>());
  const permissionPickCountRef = useRef(0);
  const sessionSelectionRef = useRef(sessionSelection);

  /**
   * The session the composer shows, with the provider it runs under: the
   * selected one (whose provider the composer's is), or the one this new chat
   * just created and navigation has not selected yet. After a provider switch
   * the chat no longer runs under the created session's provider, whether the
   * switch came before or after it.
   */
  const composerSession = useMemo<ComposerSession | null>(() => {
    if (selectedSessionId) {
      return { provider, sessionId: selectedSessionId };
    }
    // A seed stands for the chat only while the chat still holds its id (where
    // the next send goes) and is still the new chat it was created in: same
    // New Session click, same project. Those two are checked here, in the
    // render they change, because the chat's id is cleared only later in an
    // effect, and not at all while the first reply is still running.
    return seededSession
      && seededSession.sessionId === currentSessionId
      && seededSession.provider === provider
      && seededSession.newSessionTrigger === newSessionTrigger
      && seededSession.projectPath === selectedProjectPath
      ? { provider, sessionId: seededSession.sessionId }
      : null;
  }, [currentSessionId, newSessionTrigger, provider, seededSession, selectedProjectPath, selectedSessionId]);
  // The chat now shown, for telling a send that answers late from a current one.
  const newChatRef = useRef({ newSessionTrigger, projectPath: selectedProjectPath, sessionId: selectedSessionId });
  // For callbacks, which should not change identity with every target change.
  const composerSessionRef = useRef(composerSession);
  // Callbacks run after commit; written then, never from a render React discards.
  useLayoutEffect(() => {
    permissionModeRef.current = permissionMode;
    sessionSelectionRef.current = sessionSelection;
    newChatRef.current = { newSessionTrigger, projectPath: selectedProjectPath, sessionId: selectedSessionId };
    composerSessionRef.current = composerSession;
  });

  const isComposerTarget = useCallback((sessionId: string) => (
    composerSessionRef.current?.sessionId === sessionId
  ), []);

  const resolvePickTarget = useCallback((targetProvider: LLMProvider) => (
    pickTargetFor(composerSessionRef.current, targetProvider)
  ), []);

  const trackSessionSave = useCallback(<T>(
    sessionId: string,
    field: ProjectSelectionField,
    save: Promise<T>,
  ): Promise<T> => {
    const pending = pendingSessionSavesRef.current;
    startedSessionSavesRef.current += 1;
    const saves = pending.get(sessionId) ?? new Map<Promise<unknown>, ProjectSelectionField>();
    pending.set(sessionId, saves);
    saves.set(save, field);
    const settle = () => {
      saves.delete(save);
      if (saves.size === 0) {
        pending.delete(sessionId);
      }
    };
    save.then(settle, settle);
    return save;
  }, []);

  /** Resolves once no selection save for a session is in flight, or once any of `stops` aborts. */
  const waitForSessionSaves = useCallback(async (sessionId: string, stops: AbortSignal[]) => {
    let onAbort: () => void = () => {};
    const stopped = new Promise<true>((resolve) => {
      onAbort = () => resolve(true);
    });
    for (const stop of stops) {
      if (stop.aborted) {
        onAbort();
      }
      stop.addEventListener('abort', onAbort, { once: true });
    }
    try {
      for (;;) {
        const saves = pendingSessionSavesRef.current.get(sessionId);
        if (!saves || await Promise.race([Promise.allSettled([...saves.keys()]).then(() => false), stopped])) {
          return;
        }
      }
    } finally {
      for (const stop of stops) {
        stop.removeEventListener('abort', onAbort);
      }
    }
  }, []);

  // Only a new chat starts from the project. Its session is created with the
  // selection it starts from, so once it has an id its own row answers.
  const activeProjectSelection = projectSelection
    && !selectedSessionId
    && projectSelection.provider === provider
    && projectSelection.projectPath === selectedProjectPath
    ? projectSelection
    : null;
  // Only a model the catalog lists is offered, so a deleted custom model is
  // never recorded on a new session. The effort belongs to that model, so it
  // goes when the model does (not listed, or replaced by the user's pick).
  const projectModel = activeProjectSelection?.model
    && providerModelCatalog[provider]?.OPTIONS.some((option) => option.value === activeProjectSelection.model)
    ? activeProjectSelection.model
    : null;
  const projectEffort = projectModel ? activeProjectSelection?.effort ?? null : null;

  // Picks belong to one new chat; a provider switch inside it keeps them.
  useEffect(() => {
    pickedProjectFieldsRef.current = new Map();
  }, [newSessionTrigger, selectedProjectPath, selectedSessionId]);

  // A new chat starts from what the project's latest session ran with.
  useEffect(() => {
    if (selectedSessionId || !selectedProjectPath) {
      return;
    }

    let cancelled = false;
    const loadProjectSelection = async () => {
      try {
        const response = await api.providers.projectSelection(provider, selectedProjectPath);
        const body = (await response.json()) as ProjectSelectionApiResponse;
        if (cancelled) {
          return;
        }
        if (!body.success || !body.data) {
          setProjectSelection(null);
          return;
        }
        const unlessPicked = (field: ProjectSelectionField) => (
          pickedProjectFieldsRef.current.has(`${provider}:${field}`)
            ? pickedProjectFieldsRef.current.get(`${provider}:${field}`) ?? null
            : body.data?.[field] ?? null
        );
        setProjectSelection({
          provider,
          projectPath: selectedProjectPath,
          model: unlessPicked('model'),
          effort: unlessPicked('effort'),
          permissionMode: unlessPicked('permissionMode'),
        });
      } catch (error) {
        if (!cancelled) {
          console.error('Error loading the project model and permission mode:', error);
          setProjectSelection(null);
        }
      }
    };

    void loadProjectSelection();
    return () => {
      cancelled = true;
    };
  }, [newSessionTrigger, provider, selectedProjectPath, selectedSessionId]);

  useEffect(() => {
    const validModes = getPermissionModesForProvider(provider);
    // The per-session key answers until the backend row has loaded, and for
    // sessions from before the backend recorded modes.
    const sessionSavedMode = selectedSessionId
      ? (activeSessionSelection?.permissionMode ?? localStorage.getItem(`permissionMode-${selectedSessionId}`))
      : null;
    // Fall back to the last mode picked for this provider: a brand-new chat
    // only receives its session id after the first send, so without this the
    // mode chosen beforehand would snap back to the default as soon as the
    // session id appears.
    const providerSavedMode = localStorage.getItem(`permissionMode-last-${provider}`) as PermissionMode | null;
    const savedMode = [sessionSavedMode, activeProjectSelection?.permissionMode, providerSavedMode].find(
      (mode): mode is PermissionMode => Boolean(mode && validModes.includes(mode as PermissionMode)),
    );
    setPermissionMode(savedMode ?? getDefaultPermissionModeForProvider(provider));
  }, [
    selectedSessionId,
    provider,
    activeSessionSelection?.permissionMode,
    activeProjectSelection?.permissionMode,
    getDefaultPermissionModeForProvider,
    getPermissionModesForProvider,
  ]);

  const selectPermissionMode = useCallback((nextMode: PermissionMode) => {
    // A new chat that already has its id but no selected session yet records
    // the pick on that session, so it is not reverted once it is selected.
    const target = composerSessionRef.current;
    const previousComposerMode = permissionModeRef.current;
    // The provider of the session the pick is for, which the restore effect
    // reads once that session is selected.
    const lastModeKey = `permissionMode-last-${target?.provider ?? provider}`;
    const previousLastMode = localStorage.getItem(lastModeKey);
    setPermissionMode(nextMode);

    // Persist per provider as well as per session: a brand-new chat has no
    // session id yet, and the per-provider key keeps the choice sticky when
    // the real id arrives (and for future sessions of this provider).
    localStorage.setItem(lastModeKey, nextMode);
    clearProjectSelectionField(provider, 'permissionMode');
    if (!target) {
      return;
    }

    const pick = ++permissionPickCountRef.current;
    permissionPickRef.current.set(target.sessionId, pick);
    const storageKey = `permissionMode-${target.sessionId}`;
    const previousStoredMode = localStorage.getItem(storageKey);
    const currentSelection = sessionSelectionRef.current;
    const previousMode = currentSelection?.sessionId === target.sessionId ? currentSelection.permissionMode : null;
    localStorage.setItem(storageKey, nextMode);
    // Also before the session's own row has loaded, so a load that has to
    // keep this field (its save still running) has a value to keep.
    setSessionSelection((current) => (current?.sessionId === target.sessionId
      ? { ...current, permissionMode: nextMode }
      : { provider: target.provider, sessionId: target.sessionId, model: null, effort: null, permissionMode: nextMode }));
    // A save the server refuses (also a mode the session's provider does not
    // offer) is taken back, so the composer never shows a mode the row lacks.
    const rollBack = (reason: unknown) => {
      console.error('Error saving the session permission mode:', reason);
      // A newer pick for this session already replaced these values (A, B, A again).
      if (permissionPickRef.current.get(target.sessionId) !== pick) {
        return;
      }
      // The restore effect falls back to both keys, so both go back.
      for (const [key, previous] of [[storageKey, previousStoredMode], [lastModeKey, previousLastMode]] as const) {
        if (localStorage.getItem(key) !== nextMode) {
          continue;
        }
        if (previous === null) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, previous);
        }
      }
      setSessionSelection((current) => (
        current?.sessionId === target.sessionId && current.permissionMode === nextMode
          ? { ...current, permissionMode: previousMode }
          : current
      ));
      // Set directly too: when the pick and its rollback land in one render,
      // the restore effect sees no change and would leave the refused mode.
      if (isComposerTarget(target.sessionId)) {
        setPermissionMode((current) => (current === nextMode ? previousComposerMode : current));
      }
    };
    trackSessionSave(
      target.sessionId,
      'permissionMode',
      api.providers.setSessionActivePermissionMode(target.provider, target.sessionId, nextMode)
        .then((response) => {
          if (!response.ok) {
            rollBack(`HTTP ${response.status}`);
          }
        })
        .catch(rollBack)
        .finally(() => {
          if (permissionPickRef.current.get(target.sessionId) === pick) permissionPickRef.current.delete(target.sessionId);
        }),
    );
  }, [clearProjectSelectionField, isComposerTarget, provider, trackSessionSave]);

  const cyclePermissionMode = useCallback(() => {
    const modes = getPermissionModesForProvider(provider);

    const currentIndex = modes.indexOf(permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    selectPermissionMode(modes[nextIndex]);
  }, [permissionMode, provider, getPermissionModesForProvider, selectPermissionMode]);


  useEffect(() => {
    const requestId = sessionSelectionLoadRequestIdRef.current + 1;
    sessionSelectionLoadRequestIdRef.current = requestId;

    const targetProvider = provider;
    const targetSessionKey = selectedSessionId ? getSessionSelectionKey(targetProvider, selectedSessionId) : null;
    if (!selectedSessionId || !targetSessionKey) {
      setSessionSelection(null);
      return;
    }

    const abort = new AbortController();
    const { signal } = abort;
    // One deadline for the whole load, however often it reads again, so a hung
    // save delays it by SESSION_SAVE_WAIT_MS at most. It starts with the first
    // wait, so a slow read does not use it up before there is anything to wait for.
    let deadline: AbortSignal | null = null;

    const loadSessionSelection = async () => {
      try {
        // Read the row only once no pick is still on its way to it; a pick
        // started while the read ran sends it round again.
        let body: SessionSelectionApiResponse;
        let savesBeforeRead: number;
        do {
          if (pendingSessionSavesRef.current.has(selectedSessionId)) {
            deadline ??= AbortSignal.timeout(SESSION_SAVE_WAIT_MS);
            await waitForSessionSaves(selectedSessionId, [signal, deadline]);
          }
          if (signal.aborted) {
            return;
          }
          savesBeforeRead = startedSessionSavesRef.current;
          const response = await api.providers.sessionActiveModel(targetProvider, selectedSessionId, { signal });
          body = (await response.json()) as SessionSelectionApiResponse;
          // An error reply is no answer: the catch below keeps the current selection.
          if (!response.ok || !body.success) throw new Error(`HTTP ${response.status}`);
        } while (!signal.aborted && startedSessionSavesRef.current !== savesBeforeRead);
        if (
          signal.aborted
          || sessionSelectionLoadRequestIdRef.current !== requestId
          || selectedSessionKeyRef.current !== targetSessionKey
        ) {
          return;
        }

        const resolvedModel = body.data?.model?.trim();
        const row = {
          model: resolvedModel && body.data?.source !== 'default' ? resolvedModel : null,
          effort: body.data?.effort?.trim() || null,
          permissionMode: body.data?.permissionMode?.trim() || null,
        };
        // A save that outlasted the wait has not reached the row yet; its
        // field keeps what the composer already shows.
        const stillSaving = new Set(pendingSessionSavesRef.current.get(selectedSessionId)?.values());
        setSessionSelection((current) => {
          const own = current?.sessionId === selectedSessionId && current.provider === targetProvider ? current : null;
          const resolve = (field: ProjectSelectionField) => (own && stillSaving.has(field) ? own[field] : row[field]);
          return {
            provider: targetProvider,
            sessionId: selectedSessionId,
            model: resolve('model'),
            effort: resolve('effort'),
            permissionMode: resolve('permissionMode'),
          };
        });
      } catch (error) {
        if (
          !signal.aborted
          && sessionSelectionLoadRequestIdRef.current === requestId
          && selectedSessionKeyRef.current === targetSessionKey
        ) {
          console.error('Error loading the session model and reasoning effort:', error);
          // Keep what this session already shows (its seed, or a pick).
          setSessionSelection((current) => (
            current?.sessionId === selectedSessionId && current.provider === targetProvider ? current : {
            provider: targetProvider,
            sessionId: selectedSessionId,
            model: null,
            effort: null,
            permissionMode: null,
          }));
        }
      }
    };

    void loadSessionSelection();
    return () => {
      abort.abort();
    };
  }, [selectedSessionId, provider, waitForSessionSaves]);

  /**
   * Applies a model choice.
   *
   * The pick always becomes the per-provider default so the next new chat
   * inherits it, and — when a session is open — is also recorded against that
   * session so reopening it later restores this model.
   */
  const selectProviderModel = useCallback(async (targetProvider: LLMProvider, model: string) => {
    setStoredProviderModel(targetProvider, model);
    // Also when a new chat already has its id but no selected session yet,
    // while the project selection still shows.
    clearProjectSelectionField(targetProvider, 'model');

    const target = resolvePickTarget(targetProvider);
    if (!target) {
      return { scope: 'default' as const, model };
    }
    const { sessionId } = target;

    const mutationId = sessionModelMutationIdRef.current + 1;
    sessionModelMutationIdRef.current = mutationId;

    const response = await trackSessionSave(sessionId, 'model', api.providers.setSessionActiveModel(
      targetProvider,
      sessionId,
      model,
    ));

    const body = (await response.json()) as SessionSelectionApiResponse;
    if (!response.ok || !body.success) {
      throw new Error('Unable to change the active model for this session.');
    }

    const storedModel = body.data?.model?.trim() || model;
    if (sessionModelMutationIdRef.current === mutationId && isComposerTarget(sessionId)) {
      setSessionSelection((current) => (current?.sessionId === sessionId
        ? { ...current, model: storedModel }
        : {
          provider: targetProvider,
          sessionId,
          model: storedModel,
          effort: body.data?.effort?.trim() || null,
          permissionMode: null,
        }));
    }
    return { scope: 'session' as const, model: storedModel };
  }, [clearProjectSelectionField, isComposerTarget, resolvePickTarget, setStoredProviderModel, trackSessionSave]);

  /**
   * Applies an effort choice optimistically and persists it for the open
   * session. Mutation counters keep slower earlier requests from overwriting
   * the latest click.
   */
  const selectProviderEffort = useCallback(async (targetProvider: LLMProvider, effort: string) => {
    const target = resolvePickTarget(targetProvider);
    // A new chat showing the project's model keeps the pick with that model: the
    // provider default is checked against the provider's own model and would drop it.
    if (!target && targetProvider === provider && projectModel) {
      pickedProjectFieldsRef.current.set(`${targetProvider}:effort`, effort);
      setProjectSelection((current) => (current ? { ...current, effort } : current));
      return { scope: 'default' as const, effort };
    }
    setStoredProviderEffort(targetProvider, effort);
    clearProjectSelectionField(targetProvider, 'effort');

    if (!target) {
      return { scope: 'default' as const, effort };
    }
    const { sessionId } = target;

    const mutationId = sessionEffortMutationIdRef.current + 1;
    sessionEffortMutationIdRef.current = mutationId;
    const currentSelection = sessionSelectionRef.current;
    const previousSelection = currentSelection?.sessionId === sessionId ? currentSelection : null;

    // Only the session the composer shows; any other one is just saved.
    if (isComposerTarget(sessionId)) {
      setSessionSelection((current) => (current?.sessionId === sessionId
        ? { ...current, effort }
        : { provider: targetProvider, sessionId, model: null, effort, permissionMode: null }));
    }

    try {
      const response = await trackSessionSave(sessionId, 'effort', api.providers.setSessionActiveEffort(
        targetProvider,
        sessionId,
        effort,
      ));
      const body = (await response.json()) as SessionSelectionApiResponse;
      if (!response.ok || !body.success) {
        throw new Error('Unable to change the reasoning effort for this session.');
      }

      const storedEffort = body.data?.effort?.trim() || effort;
      if (sessionEffortMutationIdRef.current === mutationId && isComposerTarget(sessionId)) {
        setSessionSelection((current) => (current?.sessionId === sessionId
          ? { ...current, effort: storedEffort }
          : {
            provider: targetProvider,
            sessionId,
            model: null,
            effort: storedEffort,
            permissionMode: null,
          }));
      }

      return { scope: 'session' as const, effort: storedEffort };
    } catch (error) {
      if (sessionEffortMutationIdRef.current === mutationId && isComposerTarget(sessionId)) {
        // Only the effort goes back: a mode or model picked meanwhile stays.
        setSessionSelection((current) => (
          current?.sessionId === sessionId && current.effort === effort
            ? { ...current, effort: previousSelection?.effort ?? null }
            : current
        ));
      }
      throw error;
    }
  }, [clearProjectSelectionField, isComposerTarget, projectModel, provider, resolvePickTarget, setStoredProviderEffort, trackSessionSave]);

  /**
   * Whether a model pick for a provider is saved on a session, for the /model
   * modal's wording. Bound to the current target, so it changes identity (and
   * re-renders a memoized reader) whenever the target does.
   */
  const savesPickOnSession = useCallback((targetProvider: LLMProvider) => (
    pickTargetFor(composerSession, targetProvider) !== null
  ), [composerSession]);

  // The open session's model wins over the per-provider default, so switching
  // sessions shows (and sends) what each session actually runs with. What it
  // has not recorded comes from the project's latest session.
  const currentProviderModel = sessionModel ?? projectModel ?? providerModels[provider];
  const displayedProviderModels = useMemo(() => (
    projectModel ? { ...providerModels, [provider]: projectModel } : providerModels
  ), [projectModel, provider, providerModels]);
  const currentProviderEffortOptions = useMemo(() => {
    return getEffortOptionsForModel(provider, currentProviderModel);
  }, [currentProviderModel, getEffortOptionsForModel, provider]);
  const currentProviderEffort = useMemo(() => {
    return reconcileStoredEffort(
      provider,
      currentProviderModel,
      activeSessionSelection?.effort
        ?? projectEffort
        ?? providerEfforts[provider]
        ?? DEFAULT_EFFORT_VALUE,
    );
  }, [
    projectEffort,
    activeSessionSelection?.effort,
    currentProviderModel,
    provider,
    providerEfforts,
    reconcileStoredEffort,
  ]);

  /**
   * Holds what a session was just created with as its recorded selection, so
   * the composer keeps showing it while the row loads, instead of falling
   * back to the per-provider defaults in between.
   */
  const seedSessionSelection = useCallback(({
    provider: targetProvider,
    sessionId,
    selection = {},
    projectPath,
    newSessionTrigger: sendNewSessionTrigger,
  }: {
    provider: LLMProvider;
    sessionId: string;
    selection?: SessionEstablishedContext['selection'];
    /** The project the send was made in, not the one shown when it answers. */
    projectPath: string | null;
    /** The New Session trigger the send started under, not the current one. */
    newSessionTrigger: number | undefined;
  }) => {
    const normalizedProjectPath = projectPath?.trim() || null;
    // A send that answers after its chat was left (New Session, another
    // project, or an existing session opened) seeds nothing: neither the
    // target nor the selection of the chat now shown.
    if (
      sendNewSessionTrigger !== newChatRef.current.newSessionTrigger
      || normalizedProjectPath !== newChatRef.current.projectPath
      || newChatRef.current.sessionId !== null
    ) {
      return;
    }
    const read = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
    // Takes effect with the render that also gives the chat this id.
    setSeededSession({
      provider: targetProvider,
      sessionId,
      newSessionTrigger: sendNewSessionTrigger,
      projectPath: normalizedProjectPath,
    });
    setSessionSelection({
      provider: targetProvider,
      sessionId,
      model: read(selection.model),
      effort: read(selection.effort),
      permissionMode: read(selection.permissionMode),
    });
  }, []);

  const currentProviderModelOptions = useMemo(
    () => providerModelCatalog[provider]?.OPTIONS ?? [],
    [provider, providerModelCatalog],
  );

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
    const response = await api.providers.createModel(targetProvider, input);
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

    const response = await api.providers.updateModel(targetProvider, existing.recordId, input);
    const result = await readModelMutationResponse(response);
    applyProviderCatalog(targetProvider, result.models);

    if (providerModels[targetProvider] === existing.value) {
      setStoredProviderModel(targetProvider, result.model.value);
    }
    setProjectSelection((current) => (
      current?.provider === targetProvider && current.model === existing.value
        ? { ...current, model: result.model.value }
        : current
    ));
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
    setStoredProviderModel,
  ]);

  const removeCustomModel = useCallback(async (
    targetProvider: LLMProvider,
    existing: ProviderModelOption,
  ) => {
    if (!existing.recordId) {
      throw new Error('This model cannot be deleted.');
    }

    const response = await api.providers.deleteModel(targetProvider, existing.recordId);
    const result = await readModelMutationResponse(response);
    applyProviderCatalog(targetProvider, result.models);

    if (providerModels[targetProvider] === existing.value) {
      setStoredProviderModel(targetProvider, result.models.DEFAULT);
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
    setStoredProviderModel,
  ]);

  /**
   * Applies the server's catalog for the new flag. A remembered per-provider
   * model that the catalog no longer lists is moved to its `DEFAULT` by the
   * reconciliation effect above; an open session keeps its recorded model.
   */
  const setCustomModelsOnly = useCallback(async (
    targetProvider: LLMProvider,
    enabled: boolean,
  ) => {
    const response = await api.providers.setCustomModelsOnly(targetProvider, enabled);
    const body = (await response.json()) as ProviderModelMutationApiResponse;
    if (!response.ok || !body.success || !body.data?.models) {
      throw new Error(body.error?.message || 'Unable to change this setting.');
    }

    applyProviderCatalog(targetProvider, body.data.models);
  }, [applyProviderCatalog]);

  const providerModelActions = useMemo<ProviderModelActions>(() => ({
    create: createCustomModel,
    update: updateCustomModel,
    remove: removeCustomModel,
    setCustomModelsOnly,
  }), [createCustomModel, removeCustomModel, setCustomModelsOnly, updateCustomModel]);

  return {
    provider,
    setProvider,
    // The empty state reads this record, so it must show the model that is sent.
    providerModels: displayedProviderModels,
    setStoredProviderModel,
    currentProviderEffort,
    currentProviderEffortOptions,
    currentProviderModel,
    currentProviderModelOptions,
    permissionMode,
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
    seedSessionSelection,
    savesPickOnSession,
    resolvePermissionModeForProvider,
    supportsMessageEditing,
    supportsSessionForking,
    supportsSideQuestions,
    supportsSteering,
    supportsContextClearing,
  };
}
