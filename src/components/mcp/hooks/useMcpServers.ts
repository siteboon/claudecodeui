import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import { MCP_GLOBAL_SUPPORTED_TRANSPORTS, MCP_PROVIDER_NAMES, MCP_SUPPORTED_SCOPES } from '../constants';
import type {
  ApiResponse,
  GlobalMcpServerResult,
  McpFormState,
  McpProject,
  McpProvider,
  McpScope,
  McpTransport,
  ProviderMcpServer,
  UpsertProviderMcpServerPayload,
} from '../types';
import {
  createMcpPayloadFromForm,
  getErrorMessage,
  getProjectPath,
  isMcpScope,
  isMcpTransport,
} from '../utils/mcpFormatting';

type ProviderMcpServerResponse = {
  provider: McpProvider;
  scope: McpScope;
  servers: Array<Partial<ProviderMcpServer>>;
};

type GlobalMcpServerResponse = {
  results: GlobalMcpServerResult[];
};

// Internal MCP-side shape; `name` is now filled from the DB projectId since
// the legacy Project.name field was removed during the projectId migration.
type ProjectTarget = {
  name: string;
  displayName: string;
  path: string;
};

type McpServersCacheEntry = {
  servers: ProviderMcpServer[];
  updatedAt: number;
};

type ScopedProjectRequest = {
  scope: McpScope;
  project: ProjectTarget;
};

const MCP_CACHE_TTL_MS = 30_000;
const mcpServersCache = new Map<string, McpServersCacheEntry>();

// Settings users often switch between provider tabs repeatedly. A short module
// cache prevents those tab switches from refetching every project config file.

const toResponseJson = async <T>(response: Response): Promise<T> => response.json() as Promise<T>;

const getApiErrorMessage = (payload: unknown, fallback: string): string => {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  const details = record.details;
  if (typeof details === 'string' && details.trim()) {
    return details;
  }

  return fallback;
};

const normalizeTransport = (value: unknown, fallback: McpTransport = 'stdio'): McpTransport => (
  isMcpTransport(value) ? value : fallback
);

const normalizeScope = (value: unknown, fallback: McpScope): McpScope => (
  isMcpScope(value) ? value : fallback
);

const normalizeServer = (
  provider: McpProvider,
  scope: McpScope,
  server: Partial<ProviderMcpServer>,
  project?: ProjectTarget,
): ProviderMcpServer => {
  const transport = normalizeTransport(server.transport, server.url ? 'http' : 'stdio');
  return {
    provider,
    name: String(server.name ?? ''),
    scope: normalizeScope(server.scope, scope),
    transport,
    command: server.command,
    args: server.args ?? [],
    env: server.env ?? {},
    cwd: server.cwd,
    url: server.url,
    headers: server.headers ?? {},
    envVars: server.envVars ?? [],
    bearerTokenEnvVar: server.bearerTokenEnvVar,
    envHttpHeaders: server.envHttpHeaders ?? {},
    workspacePath: project?.path || server.workspacePath,
    // Keep the `projectName` key in the MCP wire payload for backwards
    // compatibility. ProjectTarget.name is populated from the DB `projectId`
    // (see createProjectTargets) so this still carries the new identifier.
    projectName: project?.name || server.projectName,
    projectDisplayName: project?.displayName || server.projectDisplayName,
  };
};

const createProjectTargets = (projects: McpProject[]): ProjectTarget[] => {
  const seen = new Set<string>();
  return projects.reduce<ProjectTarget[]>((acc, project) => {
    const projectPath = getProjectPath(project);
    if (!projectPath || seen.has(projectPath)) {
      return acc;
    }

    seen.add(projectPath);
    acc.push({
      // Use projectId as the stable internal identifier.
      name: project.projectId,
      displayName: project.displayName || project.projectId,
      path: projectPath,
    });
    return acc;
  }, []);
};

const fetchProviderScopeServers = async (
  provider: McpProvider,
  scope: McpScope,
  project?: ProjectTarget,
): Promise<ProviderMcpServer[]> => {
  const params = new URLSearchParams({ scope });
  if (project?.path) {
    params.set('workspacePath', project.path);
  }

  const response = await authenticatedFetch(`/api/providers/${provider}/mcp/servers?${params.toString()}`);
  const data = await toResponseJson<ApiResponse<ProviderMcpServerResponse>>(response);

  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, `Failed to load ${provider} MCP servers`));
  }

  return (data.data.servers || []).map((server) => normalizeServer(provider, scope, server, project));
};

const deleteProviderServer = async (
  provider: McpProvider,
  server: ProviderMcpServer,
): Promise<void> => {
  const params = new URLSearchParams({ scope: server.scope });
  if (server.workspacePath) {
    params.set('workspacePath', server.workspacePath);
  }

  const response = await authenticatedFetch(
    `/api/providers/${provider}/mcp/servers/${encodeURIComponent(server.name)}?${params.toString()}`,
    { method: 'DELETE' },
  );
  const data = await toResponseJson<ApiResponse<{ removed: boolean }>>(response);

  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, 'Failed to delete MCP server'));
  }
};

const saveProviderServer = async (
  provider: McpProvider,
  payload: UpsertProviderMcpServerPayload,
): Promise<void> => {
  const response = await authenticatedFetch(`/api/providers/${provider}/mcp/servers`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = await toResponseJson<ApiResponse<{ server: ProviderMcpServer }>>(response);

  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, 'Failed to save MCP server'));
  }
};

const saveGlobalServer = async (
  payload: UpsertProviderMcpServerPayload,
): Promise<GlobalMcpServerResult[]> => {
  const response = await authenticatedFetch('/api/providers/mcp/servers/global', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = await toResponseJson<ApiResponse<GlobalMcpServerResponse>>(response);

  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, 'Failed to save MCP server to all providers'));
  }

  return data.data.results || [];
};

const didServerIdentityChange = (
  editingServer: ProviderMcpServer,
  payload: UpsertProviderMcpServerPayload,
): boolean => (
  editingServer.name !== payload.name
  || editingServer.scope !== payload.scope
  || (editingServer.workspacePath || '') !== (payload.workspacePath || '')
);

const getServerIdentity = (server: ProviderMcpServer): string => (
  `${server.provider}:${server.scope}:${server.workspacePath || 'global'}:${server.name}`
);

const getCacheKey = (provider: McpProvider, projects: ProjectTarget[]): string => {
  const projectKey = projects.map((project) => project.path).sort().join('|');
  return `${provider}:${projectKey}`;
};

const formatGlobalAddFailures = (failures: GlobalMcpServerResult[]): string => (
  failures
    .map((failure) => `${MCP_PROVIDER_NAMES[failure.provider]}: ${failure.error || 'Unknown error'}`)
    .join('; ')
);

const sortServers = (servers: ProviderMcpServer[]): ProviderMcpServer[] => {
  const scopeOrder: Record<McpScope, number> = {
    user: 0,
    project: 1,
    local: 2,
  };

  return [...servers].sort((left, right) => {
    const scopeDelta = scopeOrder[left.scope] - scopeOrder[right.scope];
    if (scopeDelta !== 0) {
      return scopeDelta;
    }

    const projectDelta = (left.projectDisplayName || '').localeCompare(right.projectDisplayName || '');
    if (projectDelta !== 0) {
      return projectDelta;
    }

    return left.name.localeCompare(right.name);
  });
};

const mergeServers = (
  existingServers: ProviderMcpServer[],
  incomingServers: ProviderMcpServer[],
): ProviderMcpServer[] => {
  const serversById = new Map<string, ProviderMcpServer>();
  existingServers.forEach((server) => {
    serversById.set(getServerIdentity(server), server);
  });
  incomingServers.forEach((server) => {
    serversById.set(getServerIdentity(server), server);
  });

  return sortServers([...serversById.values()]);
};

const replaceScopedServers = (
  existingServers: ProviderMcpServer[],
  incomingServers: ProviderMcpServer[],
  scope: McpScope,
  workspacePath?: string,
): ProviderMcpServer[] => {
  const remainingServers = existingServers.filter((server) => (
    server.scope !== scope || (server.workspacePath || '') !== (workspacePath || '')
  ));

  return mergeServers(remainingServers, incomingServers);
};

type UseMcpServersArgs = {
  selectedProvider: McpProvider;
  currentProjects: McpProject[];
};

export function useMcpServers({ selectedProvider, currentProjects }: UseMcpServersArgs) {
  const [servers, setServers] = useState<ProviderMcpServer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | null>(null);
  const [isLoadingProjectScopes, setIsLoadingProjectScopes] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isGlobalFormOpen, setIsGlobalFormOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<ProviderMcpServer | null>(null);
  const activeLoadIdRef = useRef(0);

  const projectTargets = useMemo(() => createProjectTargets(currentProjects), [currentProjects]);
  const cacheKey = useMemo(() => getCacheKey(selectedProvider, projectTargets), [projectTargets, selectedProvider]);

  const refreshServers = useCallback(async (options: { force?: boolean } = {}) => {
    const loadId = activeLoadIdRef.current + 1;
    activeLoadIdRef.current = loadId;

    const cachedEntry = mcpServersCache.get(cacheKey);
    const canUseCache = !options.force && cachedEntry && Date.now() - cachedEntry.updatedAt < MCP_CACHE_TTL_MS;
    if (canUseCache) {
      setServers(cachedEntry.servers);
      setIsLoading(false);
      setIsLoadingProjectScopes(false);
      setLoadError(null);
      return;
    }

    if (cachedEntry && !options.force) {
      setServers(cachedEntry.servers);
    } else {
      setServers([]);
    }

    setIsLoading(!cachedEntry);
    setIsLoadingProjectScopes(false);
    setLoadError(null);

    const supportedScopes = MCP_SUPPORTED_SCOPES[selectedProvider];
    let nextServers: ProviderMcpServer[] = cachedEntry && !options.force ? cachedEntry.servers : [];
    let firstError: string | null = null;

    // Load the global/user scope first so the visible list can paint quickly.
    // Project and local scopes can involve many project config files, so they
    // are appended below as background requests instead of blocking this render.
    if (supportedScopes.includes('user')) {
      try {
        const userServers = await fetchProviderScopeServers(selectedProvider, 'user');
        if (activeLoadIdRef.current !== loadId) {
          return;
        }

        nextServers = replaceScopedServers(nextServers, userServers, 'user');
        setServers(sortServers(nextServers));
      } catch (error) {
        firstError = getErrorMessage(error);
      }
    }

    if (activeLoadIdRef.current !== loadId) {
      return;
    }

    setIsLoading(false);

    const projectScopeRequests: ScopedProjectRequest[] = [];
    projectTargets.forEach((project) => {
      if (supportedScopes.includes('project')) {
        projectScopeRequests.push({ scope: 'project', project });
      }

      if (supportedScopes.includes('local')) {
        projectScopeRequests.push({ scope: 'local', project });
      }
    });

    if (projectScopeRequests.length === 0) {
      const finalServers = sortServers(nextServers);
      mcpServersCache.set(cacheKey, { servers: finalServers, updatedAt: Date.now() });
      setLoadError(firstError);
      return;
    }

    setIsLoadingProjectScopes(true);

    // Update the UI as each project scope resolves. This avoids waiting for the
    // slowest project before showing servers from faster config files.
    await Promise.all(projectScopeRequests.map(async ({ scope, project }) => {
      try {
        const scopedServers = await fetchProviderScopeServers(selectedProvider, scope, project);
        if (activeLoadIdRef.current !== loadId) {
          return;
        }

        nextServers = replaceScopedServers(nextServers, scopedServers, scope, project.path);
        setServers(nextServers);
      } catch (error) {
        firstError = firstError || getErrorMessage(error);
      }
    }));

    if (activeLoadIdRef.current !== loadId) {
      return;
    }

    const finalServers = sortServers(nextServers);
    mcpServersCache.set(cacheKey, { servers: finalServers, updatedAt: Date.now() });
    setServers(finalServers);
    setLoadError(firstError);
    setIsLoadingProjectScopes(false);
  }, [cacheKey, projectTargets, selectedProvider]);

  const openForm = useCallback((server?: ProviderMcpServer) => {
    setEditingServer(server || null);
    setIsFormOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    setIsFormOpen(false);
    setEditingServer(null);
  }, []);

  const openGlobalForm = useCallback(() => {
    setIsGlobalFormOpen(true);
  }, []);

  const closeGlobalForm = useCallback(() => {
    setIsGlobalFormOpen(false);
  }, []);

  const submitForm = useCallback(
    async (formData: McpFormState, serverBeingEdited: ProviderMcpServer | null) => {
      const payload = createMcpPayloadFromForm(selectedProvider, formData);
      if (payload.scope !== 'user' && !payload.workspacePath) {
        throw new Error('Select a project for project-scoped MCP servers');
      }

      await saveProviderServer(selectedProvider, payload);

      if (serverBeingEdited && didServerIdentityChange(serverBeingEdited, payload)) {
        await deleteProviderServer(selectedProvider, serverBeingEdited);
      }

      mcpServersCache.delete(cacheKey);
      await refreshServers({ force: true });
      setSaveStatus('success');
      closeForm();
    },
    [cacheKey, closeForm, refreshServers, selectedProvider],
  );

  const submitGlobalForm = useCallback(
    async (formData: McpFormState) => {
      const payload = createMcpPayloadFromForm(selectedProvider, formData, {
        supportedTransports: MCP_GLOBAL_SUPPORTED_TRANSPORTS,
        supportsWorkingDirectory: false,
        includeProviderSpecificFields: false,
        unsupportedTransportMessage: (transport) =>
          `Add MCP Server supports only stdio and http across all providers, not ${transport}.`,
      });

      if (payload.scope === 'local') {
        throw new Error('Add MCP Server supports only user or project scope across all providers.');
      }

      if (payload.scope !== 'user' && !payload.workspacePath) {
        throw new Error('Select a project for project-scoped MCP servers');
      }

      // The global endpoint updates every provider, so clear every provider
      // cache entry instead of only the currently visible provider tab.
      const results = await saveGlobalServer(payload);
      mcpServersCache.clear();
      await refreshServers({ force: true });

      const failures = results.filter((result) => !result.created);
      if (failures.length > 0) {
        setSaveStatus('error');
        throw new Error(`Failed to add MCP server to all providers. ${formatGlobalAddFailures(failures)}`);
      }

      setSaveStatus('success');
      closeGlobalForm();
    },
    [closeGlobalForm, refreshServers, selectedProvider],
  );

  const deleteServer = useCallback(
    async (server: ProviderMcpServer) => {
      if (!window.confirm('Are you sure you want to delete this MCP server?')) {
        return;
      }

      setDeleteError(null);
      try {
        await deleteProviderServer(selectedProvider, server);
        mcpServersCache.delete(cacheKey);
        await refreshServers({ force: true });
        setSaveStatus('success');
      } catch (error) {
        setDeleteError(getErrorMessage(error));
        setSaveStatus('error');
      }
    },
    [cacheKey, refreshServers, selectedProvider],
  );

  useEffect(() => {
    void refreshServers();
  }, [refreshServers]);

  useEffect(() => {
    setIsFormOpen(false);
    setIsGlobalFormOpen(false);
    setEditingServer(null);
    setDeleteError(null);
    setSaveStatus(null);
  }, [selectedProvider]);

  useEffect(() => {
    if (saveStatus === null) {
      return;
    }

    const timer = window.setTimeout(() => setSaveStatus(null), 2000);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  return {
    servers,
    isLoading,
    isLoadingProjectScopes,
    loadError,
    deleteError,
    saveStatus,
    isFormOpen,
    isGlobalFormOpen,
    editingServer,
    openForm,
    openGlobalForm,
    closeForm,
    closeGlobalForm,
    submitForm,
    submitGlobalForm,
    deleteServer,
    refreshServers,
  };
}
