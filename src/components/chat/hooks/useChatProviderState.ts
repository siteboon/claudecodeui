import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import type { PendingPermissionRequest, PermissionMode } from '../types/types';
import type {
  ProjectSession,
  LLMProvider,
  Project,
  ProviderModelsCacheInfo,
  ProviderModelsDefinition,
} from '../../../types/app';

const FALLBACK_DEFAULT_MODEL: Record<LLMProvider, string> = {
  claude: 'opus',
  cursor: 'gpt-5.3-codex',
  codex: 'gpt-5.4',
  gemini: 'gemini-3.1-pro-preview',
  opencode: 'anthropic/claude-sonnet-4-5',
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
  gemini: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
  opencode: ['default'],
};

type ProviderCapabilities = {
  provider: LLMProvider;
  permissionModes: string[];
  defaultPermissionMode: string;
  supportsImages: boolean;
  supportsAbort: boolean;
  supportsPermissionRequests: boolean;
  supportsTokenUsage: boolean;
};

type ProviderCapabilitiesApiResponse = {
  success?: boolean;
  data?: {
    providers?: ProviderCapabilities[];
  };
};

interface UseChatProviderStateArgs {
  selectedSession: ProjectSession | null;
  selectedProject: Project | null;
}

type ProviderModelsApiResponse = {
  success?: boolean;
  data?: {
    models?: ProviderModelsDefinition;
    cache?: ProviderModelsCacheInfo;
  };
};

type ChangeActiveModelApiResponse = {
  success?: boolean;
  data?: {
    provider?: LLMProvider;
    sessionId?: string;
    supported?: boolean;
    changed?: boolean;
    model?: string | null;
  };
};

export function useChatProviderState({ selectedSession, selectedProject }: UseChatProviderStateArgs) {
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [provider, setProvider] = useState<LLMProvider>(() => {
    return (localStorage.getItem('selected-provider') as LLMProvider) || 'claude';
  });
  const [cursorModel, setCursorModel] = useState<string>(() => {
    return localStorage.getItem('cursor-model') || FALLBACK_DEFAULT_MODEL.cursor;
  });
  const [claudeModel, setClaudeModel] = useState<string>(() => {
    return localStorage.getItem('claude-model') || FALLBACK_DEFAULT_MODEL.claude;
  });
  const [codexModel, setCodexModel] = useState<string>(() => {
    return localStorage.getItem('codex-model') || FALLBACK_DEFAULT_MODEL.codex;
  });
  const [geminiModel, setGeminiModel] = useState<string>(() => {
    return localStorage.getItem('gemini-model') || FALLBACK_DEFAULT_MODEL.gemini;
  });
  const [opencodeModel, setOpenCodeModel] = useState<string>(() => {
    return localStorage.getItem('opencode-model') || FALLBACK_DEFAULT_MODEL.opencode;
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
  const [providerModelCacheCatalog, setProviderModelCacheCatalog] = useState<
    Partial<Record<LLMProvider, ProviderModelsCacheInfo>>
  >({});
  const [providerModelsLoading, setProviderModelsLoading] = useState(true);
  const [providerModelsRefreshing, setProviderModelsRefreshing] = useState(false);

  const providerModelsRequestIdRef = useRef(0);

  const setStoredProviderModel = useCallback((targetProvider: LLMProvider, model: string) => {
    if (targetProvider === 'claude') {
      setClaudeModel(model);
      localStorage.setItem('claude-model', model);
      return;
    }

    if (targetProvider === 'cursor') {
      setCursorModel(model);
      localStorage.setItem('cursor-model', model);
      return;
    }

    if (targetProvider === 'codex') {
      setCodexModel(model);
      localStorage.setItem('codex-model', model);
      return;
    }

    if (targetProvider === 'gemini') {
      setGeminiModel(model);
      localStorage.setItem('gemini-model', model);
      return;
    }

    setOpenCodeModel(model);
    localStorage.setItem('opencode-model', model);
  }, []);

  const loadProviderModels = useCallback(async (options: { bypassCache?: boolean } = {}) => {
    const providers: LLMProvider[] = ['claude', 'cursor', 'codex', 'gemini', 'opencode'];
    const requestId = providerModelsRequestIdRef.current + 1;
    providerModelsRequestIdRef.current = requestId;
    const isHardRefresh = options.bypassCache === true;

    if (isHardRefresh) {
      setProviderModelsRefreshing(true);
    } else {
      setProviderModelsLoading(true);
    }

    try {
      const results = await Promise.all(
        providers.map(async (p) => {
          const params = new URLSearchParams();
          if (options.bypassCache) {
            params.set('bypassCache', 'true');
          }

          const queryString = params.toString();
          const response = await authenticatedFetch(`/api/providers/${p}/models${queryString ? `?${queryString}` : ''}`);
          const body = (await response.json()) as ProviderModelsApiResponse;
          if (!body.success || !body.data?.models || !body.data?.cache) {
            return null;
          }

          return body.data;
        }),
      );

      if (providerModelsRequestIdRef.current !== requestId) {
        return;
      }

      const nextCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>> = {};
      const nextCacheCatalog: Partial<Record<LLMProvider, ProviderModelsCacheInfo>> = {};

      providers.forEach((p, i) => {
        const entry = results[i];
        if (!entry) {
          return;
        }

        nextCatalog[p] = entry.models;
        nextCacheCatalog[p] = entry.cache;
      });

      setProviderModelCatalog(nextCatalog);
      setProviderModelCacheCatalog(nextCacheCatalog);
    } catch (error) {
      console.error('Error loading provider models:', error);
    } finally {
      if (providerModelsRequestIdRef.current === requestId) {
        setProviderModelsLoading(false);
        setProviderModelsRefreshing(false);
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

  useEffect(() => {
    const claude = providerModelCatalog.claude;
    if (claude) {
      const next = pickStoredOrCurrent('claude-model', claudeModel, claude);
      if (next !== claudeModel) {
        setClaudeModel(next);
      }
      if (localStorage.getItem('claude-model') !== next) {
        localStorage.setItem('claude-model', next);
      }
    }
  }, [providerModelCatalog.claude, claudeModel]);

  useEffect(() => {
    const cursor = providerModelCatalog.cursor;
    if (cursor) {
      const next = pickStoredOrCurrent('cursor-model', cursorModel, cursor);
      if (next !== cursorModel) {
        setCursorModel(next);
      }
      if (localStorage.getItem('cursor-model') !== next) {
        localStorage.setItem('cursor-model', next);
      }
    }
  }, [providerModelCatalog.cursor, cursorModel]);

  useEffect(() => {
    const codex = providerModelCatalog.codex;
    if (codex) {
      const next = pickStoredOrCurrent('codex-model', codexModel, codex);
      if (next !== codexModel) {
        setCodexModel(next);
      }
      if (localStorage.getItem('codex-model') !== next) {
        localStorage.setItem('codex-model', next);
      }
    }
  }, [providerModelCatalog.codex, codexModel]);

  useEffect(() => {
    const gemini = providerModelCatalog.gemini;
    if (gemini) {
      const next = pickStoredOrCurrent('gemini-model', geminiModel, gemini);
      if (next !== geminiModel) {
        setGeminiModel(next);
      }
      if (localStorage.getItem('gemini-model') !== next) {
        localStorage.setItem('gemini-model', next);
      }
    }
  }, [providerModelCatalog.gemini, geminiModel]);

  useEffect(() => {
    const opencode = providerModelCatalog.opencode;
    if (opencode) {
      const next = pickStoredOrCurrent('opencode-model', opencodeModel, opencode);
      if (next !== opencodeModel) {
        setOpenCodeModel(next);
      }
      if (localStorage.getItem('opencode-model') !== next) {
        localStorage.setItem('opencode-model', next);
      }
    }
  }, [providerModelCatalog.opencode, opencodeModel]);

  useEffect(() => {
    if (!selectedSession?.id) {
      return;
    }

    const savedMode = localStorage.getItem(`permissionMode-${selectedSession.id}`) as PermissionMode | null;
    const validModes = getPermissionModesForProvider(provider);
    setPermissionMode(savedMode && validModes.includes(savedMode) ? savedMode : 'default');
  }, [selectedSession?.id, provider, getPermissionModesForProvider]);

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

  useEffect(() => {
    if (provider !== 'cursor') {
      return;
    }

    authenticatedFetch('/api/cursor/config')
      .then((response) => response.json())
      .then((data) => {
        if (!data.success || !data.config?.model?.modelId) {
          return;
        }

        const modelId = data.config.model.modelId as string;
        if (!localStorage.getItem('cursor-model')) {
          setCursorModel(modelId);
        }
      })
      .catch((error) => {
        console.error('Error loading Cursor config:', error);
      });
  }, [provider]);

  const cyclePermissionMode = useCallback(() => {
    const modes = getPermissionModesForProvider(provider);

    const currentIndex = modes.indexOf(permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];
    setPermissionMode(nextMode);

    if (selectedSession?.id) {
      localStorage.setItem(`permissionMode-${selectedSession.id}`, nextMode);
    }
  }, [permissionMode, provider, selectedSession?.id, getPermissionModesForProvider]);

  const selectProviderModel = useCallback(async (
    targetProvider: LLMProvider,
    model: string,
    sessionId?: string | null,
  ) => {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId) {
      setStoredProviderModel(targetProvider, model);
      return {
        scope: 'default' as const,
        changed: false,
        model,
      };
    }

    const response = await authenticatedFetch(
      `/api/providers/${targetProvider}/sessions/${encodeURIComponent(normalizedSessionId)}/active-model`,
      {
        method: 'POST',
        body: JSON.stringify({ model }),
      },
    );

    const body = (await response.json()) as ChangeActiveModelApiResponse;
    if (!response.ok || !body.success || !body.data?.supported) {
      throw new Error('Unable to change the active model for this session.');
    }

    return {
      scope: 'session' as const,
      changed: body.data.changed === true,
      model: body.data.model || model,
    };
  }, [setStoredProviderModel]);

  return {
    provider,
    setProvider,
    cursorModel,
    setCursorModel,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    geminiModel,
    setGeminiModel,
    opencodeModel,
    setOpenCodeModel,
    permissionMode,
    setPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
    providerModelCatalog,
    providerModelCacheCatalog,
    providerModelsLoading,
    providerModelsRefreshing,
    hardRefreshProviderModels: () => loadProviderModels({ bypassCache: true }),
    selectProviderModel,
  };
}
