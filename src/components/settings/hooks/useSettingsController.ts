import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../../../contexts/ThemeContext';
import { authenticatedFetch } from '../../../utils/api';
import {
  AUTH_STATUS_ENDPOINTS,
  DEFAULT_AUTH_STATUS,
  DEFAULT_CODE_EDITOR_SETTINGS,
  DEFAULT_CURSOR_PERMISSIONS,
} from '../constants/constants';
import type {
  AgentProvider,
  AuthStatus,
  ClaudeMcpFormState,
  ClaudePermissionsState,
  CodeEditorSettingsState,
  CodexMcpFormState,
  CodexPermissionMode,
  CursorPermissionsState,
  McpServer,
  McpToolsResult,
  McpTestResult,
  ProjectSortOrder,
  SettingsMainTab,
  SettingsProject,
} from '../types/types';

type ThemeContextValue = {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
};

type UseSettingsControllerArgs = {
  isOpen: boolean;
  initialTab: string;
  projects: SettingsProject[];
  onClose: () => void;
};

type StatusApiResponse = {
  authenticated?: boolean;
  email?: string | null;
  error?: string | null;
};

type JsonResult = {
  success?: boolean;
  error?: string;
};

type McpReadResponse = {
  success?: boolean;
  servers?: McpServer[];
};

type McpCliServer = {
  name: string;
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

type McpCliReadResponse = {
  success?: boolean;
  servers?: McpCliServer[];
};

type McpTestResponse = {
  testResult?: McpTestResult;
  error?: string;
};

type McpToolsResponse = {
  toolsResult?: McpToolsResult;
  error?: string;
};

type ClaudeSettingsStorage = {
  allowedTools?: string[];
  disallowedTools?: string[];
  skipPermissions?: boolean;
  projectSortOrder?: ProjectSortOrder;
};

type CursorSettingsStorage = {
  allowedCommands?: string[];
  disallowedCommands?: string[];
  skipPermissions?: boolean;
};

type CodexSettingsStorage = {
  permissionMode?: CodexPermissionMode;
};

type ActiveLoginProvider = AgentProvider | '';

const KNOWN_MAIN_TABS: SettingsMainTab[] = ['agents', 'appearance', 'git', 'api', 'tasks'];

const normalizeMainTab = (tab: string): SettingsMainTab => {
  // Keep backwards compatibility with older callers that still pass "tools".
  if (tab === 'tools') {
    return 'agents';
  }

  return KNOWN_MAIN_TABS.includes(tab as SettingsMainTab) ? (tab as SettingsMainTab) : 'agents';
};

const getErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : 'Unknown error'
);

const parseJson = <T>(value: string | null, fallback: T): T => {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const toCodexPermissionMode = (value: unknown): CodexPermissionMode => {
  if (value === 'acceptEdits' || value === 'bypassPermissions') {
    return value;
  }

  return 'default';
};

const readCodeEditorSettings = (): CodeEditorSettingsState => ({
  theme: localStorage.getItem('codeEditorTheme') === 'light' ? 'light' : 'dark',
  wordWrap: localStorage.getItem('codeEditorWordWrap') === 'true',
  showMinimap: localStorage.getItem('codeEditorShowMinimap') !== 'false',
  lineNumbers: localStorage.getItem('codeEditorLineNumbers') !== 'false',
  fontSize: localStorage.getItem('codeEditorFontSize') ?? DEFAULT_CODE_EDITOR_SETTINGS.fontSize,
});

const mapCliServersToMcpServers = (servers: McpCliServer[] = []): McpServer[] => (
  servers.map((server) => ({
    id: server.name,
    name: server.name,
    type: server.type || 'stdio',
    scope: 'user',
    config: {
      command: server.command || '',
      args: server.args || [],
      env: server.env || {},
      url: server.url || '',
      headers: server.headers || {},
      timeout: 30000,
    },
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  }))
);

const getDefaultProject = (projects: SettingsProject[]): SettingsProject => {
  if (projects.length > 0) {
    return projects[0];
  }

  const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : '';
  return {
    name: 'default',
    displayName: 'default',
    fullPath: cwd,
    path: cwd,
  };
};

const toResponseJson = async <T>(response: Response): Promise<T> => response.json() as Promise<T>;

const createEmptyClaudePermissions = (): ClaudePermissionsState => ({
  allowedTools: [],
  disallowedTools: [],
  skipPermissions: false,
});

const createEmptyCursorPermissions = (): CursorPermissionsState => ({
  ...DEFAULT_CURSOR_PERMISSIONS,
});

export function useSettingsController({ isOpen, initialTab, projects, onClose }: UseSettingsControllerArgs) {
  const { isDarkMode, toggleDarkMode } = useTheme() as ThemeContextValue;
  const closeTimerRef = useRef<number | null>(null);

  const [activeTab, setActiveTab] = useState<SettingsMainTab>(() => normalizeMainTab(initialTab));
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | null>(null);
  const [projectSortOrder, setProjectSortOrder] = useState<ProjectSortOrder>('name');
  const [codeEditorSettings, setCodeEditorSettings] = useState<CodeEditorSettingsState>(() => (
    readCodeEditorSettings()
  ));

  const [claudePermissions, setClaudePermissions] = useState<ClaudePermissionsState>(() => (
    createEmptyClaudePermissions()
  ));
  const [cursorPermissions, setCursorPermissions] = useState<CursorPermissionsState>(() => (
    createEmptyCursorPermissions()
  ));
  const [codexPermissionMode, setCodexPermissionMode] = useState<CodexPermissionMode>('default');

  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [cursorMcpServers, setCursorMcpServers] = useState<McpServer[]>([]);
  const [codexMcpServers, setCodexMcpServers] = useState<McpServer[]>([]);
  const [mcpTestResults, setMcpTestResults] = useState<Record<string, McpTestResult>>({});
  const [mcpServerTools, setMcpServerTools] = useState<Record<string, McpToolsResult>>({});
  const [mcpToolsLoading, setMcpToolsLoading] = useState<Record<string, boolean>>({});

  const [showMcpForm, setShowMcpForm] = useState(false);
  const [editingMcpServer, setEditingMcpServer] = useState<McpServer | null>(null);
  const [showCodexMcpForm, setShowCodexMcpForm] = useState(false);
  const [editingCodexMcpServer, setEditingCodexMcpServer] = useState<McpServer | null>(null);

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginProvider, setLoginProvider] = useState<ActiveLoginProvider>('');
  const [selectedProject, setSelectedProject] = useState<SettingsProject | null>(null);

  const [claudeAuthStatus, setClaudeAuthStatus] = useState<AuthStatus>(DEFAULT_AUTH_STATUS);
  const [cursorAuthStatus, setCursorAuthStatus] = useState<AuthStatus>(DEFAULT_AUTH_STATUS);
  const [codexAuthStatus, setCodexAuthStatus] = useState<AuthStatus>(DEFAULT_AUTH_STATUS);

  const setAuthStatusByProvider = useCallback((provider: AgentProvider, status: AuthStatus) => {
    if (provider === 'claude') {
      setClaudeAuthStatus(status);
      return;
    }

    if (provider === 'cursor') {
      setCursorAuthStatus(status);
      return;
    }

    setCodexAuthStatus(status);
  }, []);

  const checkAuthStatus = useCallback(async (provider: AgentProvider) => {
    try {
      const response = await authenticatedFetch(AUTH_STATUS_ENDPOINTS[provider]);

      if (!response.ok) {
        setAuthStatusByProvider(provider, {
          authenticated: false,
          email: null,
          loading: false,
          error: 'Failed to check authentication status',
        });
        return;
      }

      const data = await toResponseJson<StatusApiResponse>(response);
      setAuthStatusByProvider(provider, {
        authenticated: Boolean(data.authenticated),
        email: data.email || null,
        loading: false,
        error: data.error || null,
      });
    } catch (error) {
      console.error(`Error checking ${provider} auth status:`, error);
      setAuthStatusByProvider(provider, {
        authenticated: false,
        email: null,
        loading: false,
        error: getErrorMessage(error),
      });
    }
  }, [setAuthStatusByProvider]);

  const fetchCursorMcpServers = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/cursor/mcp');
      if (!response.ok) {
        console.error('Failed to fetch Cursor MCP servers');
        return;
      }

      const data = await toResponseJson<{ servers?: McpServer[] }>(response);
      setCursorMcpServers(data.servers || []);
    } catch (error) {
      console.error('Error fetching Cursor MCP servers:', error);
    }
  }, []);

  const fetchCodexMcpServers = useCallback(async () => {
    try {
      const configResponse = await authenticatedFetch('/api/codex/mcp/config/read');

      if (configResponse.ok) {
        const configData = await toResponseJson<McpReadResponse>(configResponse);
        if (configData.success && configData.servers) {
          setCodexMcpServers(configData.servers);
          return;
        }
      }

      const cliResponse = await authenticatedFetch('/api/codex/mcp/cli/list');
      if (!cliResponse.ok) {
        return;
      }

      const cliData = await toResponseJson<McpCliReadResponse>(cliResponse);
      if (!cliData.success || !cliData.servers) {
        return;
      }

      setCodexMcpServers(mapCliServersToMcpServers(cliData.servers));
    } catch (error) {
      console.error('Error fetching Codex MCP servers:', error);
    }
  }, []);

  const fetchMcpServers = useCallback(async () => {
    try {
      const configResponse = await authenticatedFetch('/api/mcp/config/read');
      if (configResponse.ok) {
        const configData = await toResponseJson<McpReadResponse>(configResponse);
        if (configData.success && configData.servers) {
          setMcpServers(configData.servers);
          return;
        }
      }

      const cliResponse = await authenticatedFetch('/api/mcp/cli/list');
      if (cliResponse.ok) {
        const cliData = await toResponseJson<McpCliReadResponse>(cliResponse);
        if (cliData.success && cliData.servers) {
          setMcpServers(mapCliServersToMcpServers(cliData.servers));
          return;
        }
      }

      const fallbackResponse = await authenticatedFetch('/api/mcp/servers?scope=user');
      if (!fallbackResponse.ok) {
        console.error('Failed to fetch MCP servers');
        return;
      }

      const fallbackData = await toResponseJson<{ servers?: McpServer[] }>(fallbackResponse);
      setMcpServers(fallbackData.servers || []);
    } catch (error) {
      console.error('Error fetching MCP servers:', error);
    }
  }, []);

  const deleteMcpServer = useCallback(async (serverId: string, scope = 'user') => {
    const response = await authenticatedFetch(`/api/mcp/cli/remove/${serverId}?scope=${scope}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await toResponseJson<JsonResult>(response);
      throw new Error(error.error || 'Failed to delete server');
    }

    const result = await toResponseJson<JsonResult>(response);
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete server via Claude CLI');
    }
  }, []);

  const saveMcpServer = useCallback(
    async (serverData: ClaudeMcpFormState, editingServer: McpServer | null) => {
      if (editingServer?.id) {
        // Editing still follows the existing behavior: remove current entry and re-create it.
        await deleteMcpServer(editingServer.id, editingServer.scope || 'user');
      }

      const response = await authenticatedFetch('/api/mcp/cli/add', {
        method: 'POST',
        body: JSON.stringify({
          name: serverData.name,
          type: serverData.type,
          scope: serverData.scope,
          projectPath: serverData.projectPath,
          command: serverData.config.command,
          args: serverData.config.args || [],
          url: serverData.config.url,
          headers: serverData.config.headers || {},
          env: serverData.config.env || {},
        }),
      });

      if (!response.ok) {
        const error = await toResponseJson<JsonResult>(response);
        throw new Error(error.error || 'Failed to save server');
      }

      const result = await toResponseJson<JsonResult>(response);
      if (!result.success) {
        throw new Error(result.error || 'Failed to save server via Claude CLI');
      }
    },
    [deleteMcpServer],
  );

  const submitMcpForm = useCallback(
    async (formData: ClaudeMcpFormState, editingServer: McpServer | null) => {
      if (formData.importMode === 'json') {
        const response = await authenticatedFetch('/api/mcp/cli/add-json', {
          method: 'POST',
          body: JSON.stringify({
            name: formData.name,
            jsonConfig: formData.jsonInput,
            scope: formData.scope,
            projectPath: formData.projectPath,
          }),
        });

        if (!response.ok) {
          const error = await toResponseJson<JsonResult>(response);
          throw new Error(error.error || 'Failed to add server');
        }

        const result = await toResponseJson<JsonResult>(response);
        if (!result.success) {
          throw new Error(result.error || 'Failed to add server via JSON');
        }
      } else {
        await saveMcpServer(formData, editingServer);
      }

      await fetchMcpServers();
      setSaveStatus('success');
      setShowMcpForm(false);
      setEditingMcpServer(null);
    },
    [fetchMcpServers, saveMcpServer],
  );

  const handleMcpDelete = useCallback(
    async (serverId: string, scope = 'user') => {
      if (!window.confirm('Are you sure you want to delete this MCP server?')) {
        return;
      }

      try {
        await deleteMcpServer(serverId, scope);
        await fetchMcpServers();
        setSaveStatus('success');
      } catch (error) {
        alert(`Error: ${getErrorMessage(error)}`);
        setSaveStatus('error');
      }
    },
    [deleteMcpServer, fetchMcpServers],
  );

  const testMcpServer = useCallback(async (serverId: string, scope = 'user') => {
    const response = await authenticatedFetch(`/api/mcp/servers/${serverId}/test?scope=${scope}`, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await toResponseJson<McpTestResponse>(response);
      throw new Error(error.error || 'Failed to test server');
    }

    const data = await toResponseJson<McpTestResponse>(response);
    return data.testResult || { success: false, message: 'No test result returned' };
  }, []);

  const discoverMcpTools = useCallback(async (serverId: string, scope = 'user') => {
    const response = await authenticatedFetch(`/api/mcp/servers/${serverId}/tools?scope=${scope}`, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await toResponseJson<McpToolsResponse>(response);
      throw new Error(error.error || 'Failed to discover tools');
    }

    const data = await toResponseJson<McpToolsResponse>(response);
    return data.toolsResult || { success: false, tools: [], resources: [], prompts: [] };
  }, []);

  const handleMcpTest = useCallback(
    async (serverId: string, scope = 'user') => {
      try {
        setMcpTestResults((prev) => ({
          ...prev,
          [serverId]: { success: false, message: 'Testing server...', details: [], loading: true },
        }));

        const result = await testMcpServer(serverId, scope);
        setMcpTestResults((prev) => ({ ...prev, [serverId]: result }));
      } catch (error) {
        setMcpTestResults((prev) => ({
          ...prev,
          [serverId]: {
            success: false,
            message: getErrorMessage(error),
            details: [],
          },
        }));
      }
    },
    [testMcpServer],
  );

  const handleMcpToolsDiscovery = useCallback(
    async (serverId: string, scope = 'user') => {
      try {
        setMcpToolsLoading((prev) => ({ ...prev, [serverId]: true }));
        const result = await discoverMcpTools(serverId, scope);
        setMcpServerTools((prev) => ({ ...prev, [serverId]: result }));
      } catch {
        setMcpServerTools((prev) => ({
          ...prev,
          [serverId]: { success: false, tools: [], resources: [], prompts: [] },
        }));
      } finally {
        setMcpToolsLoading((prev) => ({ ...prev, [serverId]: false }));
      }
    },
    [discoverMcpTools],
  );

  const deleteCodexMcpServer = useCallback(async (serverId: string) => {
    const response = await authenticatedFetch(`/api/codex/mcp/cli/remove/${serverId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await toResponseJson<JsonResult>(response);
      throw new Error(error.error || 'Failed to delete server');
    }

    const result = await toResponseJson<JsonResult>(response);
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete Codex MCP server');
    }
  }, []);

  const saveCodexMcpServer = useCallback(
    async (serverData: CodexMcpFormState, editingServer: McpServer | null) => {
      if (editingServer?.name) {
        await deleteCodexMcpServer(editingServer.name);
      }

      const response = await authenticatedFetch('/api/codex/mcp/cli/add', {
        method: 'POST',
        body: JSON.stringify({
          name: serverData.name,
          command: serverData.config.command,
          args: serverData.config.args || [],
          env: serverData.config.env || {},
        }),
      });

      if (!response.ok) {
        const error = await toResponseJson<JsonResult>(response);
        throw new Error(error.error || 'Failed to save server');
      }

      const result = await toResponseJson<JsonResult>(response);
      if (!result.success) {
        throw new Error(result.error || 'Failed to save Codex MCP server');
      }
    },
    [deleteCodexMcpServer],
  );

  const submitCodexMcpForm = useCallback(
    async (formData: CodexMcpFormState, editingServer: McpServer | null) => {
      await saveCodexMcpServer(formData, editingServer);
      await fetchCodexMcpServers();
      setSaveStatus('success');
      setShowCodexMcpForm(false);
      setEditingCodexMcpServer(null);
    },
    [fetchCodexMcpServers, saveCodexMcpServer],
  );

  const handleCodexMcpDelete = useCallback(
    async (serverName: string) => {
      if (!window.confirm('Are you sure you want to delete this MCP server?')) {
        return;
      }

      try {
        await deleteCodexMcpServer(serverName);
        await fetchCodexMcpServers();
        setSaveStatus('success');
      } catch (error) {
        alert(`Error: ${getErrorMessage(error)}`);
        setSaveStatus('error');
      }
    },
    [deleteCodexMcpServer, fetchCodexMcpServers],
  );

  const loadSettings = useCallback(async () => {
    try {
      const savedClaudeSettings = parseJson<ClaudeSettingsStorage>(
        localStorage.getItem('claude-settings'),
        {},
      );
      setClaudePermissions({
        allowedTools: savedClaudeSettings.allowedTools || [],
        disallowedTools: savedClaudeSettings.disallowedTools || [],
        skipPermissions: Boolean(savedClaudeSettings.skipPermissions),
      });
      setProjectSortOrder(savedClaudeSettings.projectSortOrder === 'date' ? 'date' : 'name');

      const savedCursorSettings = parseJson<CursorSettingsStorage>(
        localStorage.getItem('cursor-tools-settings'),
        {},
      );
      setCursorPermissions({
        allowedCommands: savedCursorSettings.allowedCommands || [],
        disallowedCommands: savedCursorSettings.disallowedCommands || [],
        skipPermissions: Boolean(savedCursorSettings.skipPermissions),
      });

      const savedCodexSettings = parseJson<CodexSettingsStorage>(
        localStorage.getItem('codex-settings'),
        {},
      );
      setCodexPermissionMode(toCodexPermissionMode(savedCodexSettings.permissionMode));

      await Promise.all([
        fetchMcpServers(),
        fetchCursorMcpServers(),
        fetchCodexMcpServers(),
      ]);
    } catch (error) {
      console.error('Error loading settings:', error);
      setClaudePermissions(createEmptyClaudePermissions());
      setCursorPermissions(createEmptyCursorPermissions());
      setCodexPermissionMode('default');
      setProjectSortOrder('name');
    }
  }, [fetchCodexMcpServers, fetchCursorMcpServers, fetchMcpServers]);

  const openLoginForProvider = useCallback((provider: AgentProvider) => {
    setLoginProvider(provider);
    setSelectedProject(getDefaultProject(projects));
    setShowLoginModal(true);
  }, [projects]);

  const handleLoginComplete = useCallback((exitCode: number) => {
    if (exitCode !== 0 || !loginProvider) {
      return;
    }

    setSaveStatus('success');
    void checkAuthStatus(loginProvider);
  }, [checkAuthStatus, loginProvider]);

  const saveSettings = useCallback(() => {
    setIsSaving(true);
    setSaveStatus(null);

    try {
      const now = new Date().toISOString();
      localStorage.setItem('claude-settings', JSON.stringify({
        allowedTools: claudePermissions.allowedTools,
        disallowedTools: claudePermissions.disallowedTools,
        skipPermissions: claudePermissions.skipPermissions,
        projectSortOrder,
        lastUpdated: now,
      }));

      localStorage.setItem('cursor-tools-settings', JSON.stringify({
        allowedCommands: cursorPermissions.allowedCommands,
        disallowedCommands: cursorPermissions.disallowedCommands,
        skipPermissions: cursorPermissions.skipPermissions,
        lastUpdated: now,
      }));

      localStorage.setItem('codex-settings', JSON.stringify({
        permissionMode: codexPermissionMode,
        lastUpdated: now,
      }));

      setSaveStatus('success');
      closeTimerRef.current = window.setTimeout(() => onClose(), 1000);
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  }, [
    claudePermissions.allowedTools,
    claudePermissions.disallowedTools,
    claudePermissions.skipPermissions,
    codexPermissionMode,
    cursorPermissions.allowedCommands,
    cursorPermissions.disallowedCommands,
    cursorPermissions.skipPermissions,
    onClose,
    projectSortOrder,
  ]);

  const updateCodeEditorSetting = useCallback(
    <K extends keyof CodeEditorSettingsState>(key: K, value: CodeEditorSettingsState[K]) => {
      setCodeEditorSettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const openMcpForm = useCallback((server?: McpServer) => {
    setEditingMcpServer(server || null);
    setShowMcpForm(true);
  }, []);

  const closeMcpForm = useCallback(() => {
    setShowMcpForm(false);
    setEditingMcpServer(null);
  }, []);

  const openCodexMcpForm = useCallback((server?: McpServer) => {
    setEditingCodexMcpServer(server || null);
    setShowCodexMcpForm(true);
  }, []);

  const closeCodexMcpForm = useCallback(() => {
    setShowCodexMcpForm(false);
    setEditingCodexMcpServer(null);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveTab(normalizeMainTab(initialTab));
    void loadSettings();
    void checkAuthStatus('claude');
    void checkAuthStatus('cursor');
    void checkAuthStatus('codex');
  }, [checkAuthStatus, initialTab, isOpen, loadSettings]);

  useEffect(() => {
    localStorage.setItem('codeEditorTheme', codeEditorSettings.theme);
    localStorage.setItem('codeEditorWordWrap', String(codeEditorSettings.wordWrap));
    localStorage.setItem('codeEditorShowMinimap', String(codeEditorSettings.showMinimap));
    localStorage.setItem('codeEditorLineNumbers', String(codeEditorSettings.lineNumbers));
    localStorage.setItem('codeEditorFontSize', codeEditorSettings.fontSize);
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorSettings]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
  }, []);

  return {
    activeTab,
    setActiveTab,
    isDarkMode,
    toggleDarkMode,
    isSaving,
    saveStatus,
    projectSortOrder,
    setProjectSortOrder,
    codeEditorSettings,
    updateCodeEditorSetting,
    claudePermissions,
    setClaudePermissions,
    cursorPermissions,
    setCursorPermissions,
    codexPermissionMode,
    setCodexPermissionMode,
    mcpServers,
    cursorMcpServers,
    codexMcpServers,
    mcpTestResults,
    mcpServerTools,
    mcpToolsLoading,
    showMcpForm,
    editingMcpServer,
    openMcpForm,
    closeMcpForm,
    submitMcpForm,
    handleMcpDelete,
    handleMcpTest,
    handleMcpToolsDiscovery,
    showCodexMcpForm,
    editingCodexMcpServer,
    openCodexMcpForm,
    closeCodexMcpForm,
    submitCodexMcpForm,
    handleCodexMcpDelete,
    claudeAuthStatus,
    cursorAuthStatus,
    codexAuthStatus,
    openLoginForProvider,
    showLoginModal,
    setShowLoginModal,
    loginProvider,
    selectedProject,
    handleLoginComplete,
    saveSettings,
  };
}
