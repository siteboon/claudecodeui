import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { MCP_GLOBAL_SUPPORTED_TRANSPORTS, MCP_PROVIDER_NAMES, MCP_SUPPORTED_SCOPES } from '@/shared/constants';
import type {
  McpFormState,
  McpProject,
  McpProvider,
  McpScope,
  McpServerConnectionStatus,
  McpTransport,
  ProviderMcpServer,
  UpsertProviderMcpServerPayload,
} from '@/shared/types';
import {
  createMcpPayloadFromForm,
  getErrorMessage,
  getMcpServerIdentity,
  getProjectPath,
  isMcpScope,
  isMcpTransport,
} from '@/modules/mcp/utils/mcpFormatting';

type GlobalMcpServerResult = {
  provider: McpProvider;
  created: boolean;
  error?: string;
};

type ApiSuccessResponse<T> = {
  success: true;
  data: T;
};

type ApiErrorResponse = {
  success: false;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

type ProviderMcpServerResponse = {
  provider: McpProvider;
  scope: McpScope;
  servers: Array<Partial<ProviderMcpServer>>;
};

type GlobalMcpServerResponse = {
  results: GlobalMcpServerResult[];
};

type McpServerStatusResponse = {
  provider: McpProvider;
  supported: boolean;
  statuses: McpServerConnectionStatus[];
  error?: string;
};

// One probe covers the user scope plus one workspace's project/local scopes, so
// the hook runs one per distinct workspace path in the list. `undefined` asks
// the server to probe from its own working directory, which is all that is
// needed when only user-scoped servers are configured.
type McpStatusProbeResult = {
  workspacePath?: string;
  supported: boolean;
  statusesByName: Map<string, McpServerConnectionStatus>;
  error?: string;
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
  const response = await api.providers.mcpServers(provider, {
    scope,
    workspacePath: project?.path,
  });
  const data = await toResponseJson<ApiResponse<ProviderMcpServerResponse>>(response);

  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, `Failed to load ${provider} MCP servers`));
  }

  return (data.data.servers || []).map((server) => normalizeServer(provider, scope, server, project));
};

const fetchProviderServerStatuses = async (
  provider: McpProvider,
  workspacePath?: string,
): Promise<McpStatusProbeResult> => {
  const response = await api.providers.mcpServerStatuses(provider, { workspacePath });
  const data = await toResponseJson<ApiResponse<McpServerStatusResponse>>(response);

  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, `Failed to check ${provider} MCP server status`));
  }

  return {
    workspacePath,
    supported: Boolean(data.data.supported),
    statusesByName: new Map((data.data.statuses || []).map((status) => [status.name, status])),
    error: data.data.error,
  };
};

const deleteProviderServer = async (
  provider: McpProvider,
  server: ProviderMcpServer,
): Promise<void> => {
  const response = await api.providers.deleteMcpServer(provider, server.name, {
    scope: server.scope,
    workspacePath: server.workspacePath,
  });
  const data = await toResponseJson<ApiResponse<{ removed: boolean }>>(response);

  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, 'Failed to delete MCP server'));
  }
};

const saveProviderServer = async (
  provider: McpProvider,
  payload: UpsertProviderMcpServerPayload,
): Promise<void> => {
  const response = await api.providers.saveMcpServer(provider, payload);
  const data = await toResponseJson<ApiResponse<{ server: ProviderMcpServer }>>(response);

  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, 'Failed to save MCP server'));
  }
};

const saveGlobalServer = async (
  payload: UpsertProviderMcpServerPayload,
): Promise<GlobalMcpServerResult[]> => {
  const response = await api.providers.saveGlobalMcpServer(payload);
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

/**
 * Joins probe results onto the listed servers by identity.
 *
 * A workspace-scoped server may only take the status from the probe run in its
 * own workspace; a user-scoped server appears in every probe, so the first one
 * that mentions it wins. A server no probe mentioned is recorded as `unknown`
 * rather than left out, so a completed check labels every card instead of
 * silently skipping the ones the provider did not mention.
 */
const mapStatusesToServers = (
  servers: ProviderMcpServer[],
  probes: McpStatusProbeResult[],
): Map<string, McpServerConnectionStatus> => {
  const statusesByIdentity = new Map<string, McpServerConnectionStatus>();

  servers.forEach((server) => {
    const candidates = server.workspacePath
      ? probes.filter((probe) => probe.workspacePath === server.workspacePath)
      : probes;

    const match = candidates
      .map((probe) => probe.statusesByName.get(server.name))
      .find((status): status is McpServerConnectionStatus => Boolean(status));

    statusesByIdentity.set(
      getMcpServerIdentity(server),
      match ?? { name: server.name, state: 'unknown' },
    );
  });

  return statusesByIdentity;
};

const getCacheKey = (provider: McpProvider, projects: ProjectTarget[]): string => {
  const projectKey = projects.map((project) => project.path).sort().join('|');
  return `${provider}:${projectKey}`;
};

const formatGlobalAddFailures = (failures: GlobalMcpServerResult[], t: (key: string) => string): string => (
  failures
    .map((failure) => `${MCP_PROVIDER_NAMES[failure.provider]}: ${failure.error || t('mcpServersAddErrors.unknownError')}`)
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
    serversById.set(getMcpServerIdentity(server), server);
  });
  incomingServers.forEach((server) => {
    serversById.set(getMcpServerIdentity(server), server);
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

/**
 * Which MCP server form is open, if any. One value so the provider-scoped and
 * global forms cannot both be open and an edit target cannot exist without an
 * open form.
 */
type McpServerFormState =
  | { scope: 'provider'; editingServer: ProviderMcpServer | null }
  | { scope: 'global'; editingServer: null }
  | null;

export function useMcpServers({ selectedProvider, currentProjects }: UseMcpServersArgs) {
  const { t } = useTranslation('settings');
  const [servers, setServers] = useState<ProviderMcpServer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | null>(null);
  const [isLoadingProjectScopes, setIsLoadingProjectScopes] = useState(false);
  // One value rather than three: `isFormOpen`, `isGlobalFormOpen` and
  // `editingServer` made eight combinations representable, of which three were
  // legal, and both modals stayed mounted running a full form hook while closed.
  const [serverForm, setServerForm] = useState<McpServerFormState>(null);
  // Connection statuses keyed by server identity. Separate from `servers`
  // because the probe is an explicit user action that contacts every configured
  // server, so the list must be able to paint long before any status exists.
  const [serverStatuses, setServerStatuses] = useState<Map<string, McpServerConnectionStatus>>(new Map());
  // Drives the refresh button's pending state; the probe takes seconds, so
  // "nothing happened yet" and "still checking" have to look different.
  const [isCheckingStatuses, setIsCheckingStatuses] = useState(false);
  // Why the last probe produced nothing: an unsupported provider, or a failure
  // message. Held apart from `loadError` so a failed probe never makes the
  // server list itself look broken.
  const [statusNotice, setStatusNotice] = useState<{ kind: 'unsupported' | 'error'; message?: string } | null>(null);
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

  const checkStatuses = useCallback(async () => {
    if (servers.length === 0) {
      return;
    }

    setIsCheckingStatuses(true);
    setStatusNotice(null);

    // Probe once per distinct workspace, since one run covers that workspace's
    // project and local scopes plus the shared user scope.
    const workspacePaths = Array.from(
      new Set(servers.map((server) => server.workspacePath).filter((path): path is string => Boolean(path))),
    );
    const probeTargets: Array<string | undefined> = workspacePaths.length > 0 ? workspacePaths : [undefined];

    try {
      const probes = await Promise.all(
        probeTargets.map((workspacePath) => fetchProviderServerStatuses(selectedProvider, workspacePath)),
      );

      setServerStatuses(mapStatusesToServers(servers, probes));

      if (probes.every((probe) => !probe.supported)) {
        setStatusNotice({ kind: 'unsupported' });
        return;
      }

      const failedProbe = probes.find((probe) => probe.error);
      if (failedProbe) {
        setStatusNotice({ kind: 'error', message: failedProbe.error });
      }
    } catch (error) {
      setServerStatuses(new Map());
      setStatusNotice({ kind: 'error', message: getErrorMessage(error) });
    } finally {
      setIsCheckingStatuses(false);
    }
  }, [selectedProvider, servers]);

  const openForm = useCallback((server?: ProviderMcpServer) => {
    setServerForm({ scope: 'provider', editingServer: server || null });
  }, []);

  const openGlobalForm = useCallback(() => {
    setServerForm({ scope: 'global', editingServer: null });
  }, []);

  const closeForm = useCallback(() => {
    setServerForm(null);
  }, []);

  const submitForm = useCallback(
    async (formData: McpFormState, serverBeingEdited: ProviderMcpServer | null) => {
      const payload = createMcpPayloadFromForm(selectedProvider, formData);
      if (payload.scope !== 'user' && !payload.workspacePath) {
        throw new Error(t('mcpServersAddErrors.selectProjectRequired'));
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
    [cacheKey, closeForm, refreshServers, selectedProvider, t],
  );

  const submitGlobalForm = useCallback(
    async (formData: McpFormState) => {
      const payload = createMcpPayloadFromForm(selectedProvider, formData, {
        supportedTransports: MCP_GLOBAL_SUPPORTED_TRANSPORTS,
        supportsWorkingDirectory: false,
        includeProviderSpecificFields: false,
        unsupportedTransportMessage: (transport) =>
          t('mcpForm.unsupportedTransport', { transport }),
      });

      if (payload.scope === 'local') {
        throw new Error(t('mcpServersAddErrors.globalScopeUnsupported'));
      }

      if (payload.scope !== 'user' && !payload.workspacePath) {
        throw new Error(t('mcpServersAddErrors.selectProjectRequired'));
      }

      // The global endpoint updates every provider, so clear every provider
      // cache entry instead of only the currently visible provider tab.
      const results = await saveGlobalServer(payload);
      mcpServersCache.clear();
      await refreshServers({ force: true });

      const failures = results.filter((result) => !result.created);
      if (failures.length > 0) {
        setSaveStatus('error');
        throw new Error(t('mcpServersAddErrors.globalAddFailed', { details: formatGlobalAddFailures(failures, t) }));
      }

      setSaveStatus('success');
      closeForm();
    },
    [closeForm, refreshServers, selectedProvider, t],
  );

  const deleteServer = useCallback(
    async (server: ProviderMcpServer) => {
      if (!window.confirm(t('mcpServersAddErrors.deleteConfirm'))) {
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
    [cacheKey, refreshServers, selectedProvider, t],
  );

  useEffect(() => {
    void refreshServers();
  }, [refreshServers]);

  useEffect(() => {
    setServerForm(null);
    setDeleteError(null);
    setSaveStatus(null);
    // Statuses belong to the provider that was probed; keeping them across a
    // tab switch would label another provider's servers with stale results.
    setServerStatuses(new Map());
    setStatusNotice(null);
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
    serverForm,
    serverStatuses,
    isCheckingStatuses,
    statusNotice,
    checkStatuses,
    openForm,
    openGlobalForm,
    closeForm,
    submitForm,
    submitGlobalForm,
    deleteServer,
  };
}
