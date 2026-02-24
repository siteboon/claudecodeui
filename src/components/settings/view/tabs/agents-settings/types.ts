import type {
  AgentProvider,
  AuthStatus,
  AgentCategory,
  ClaudePermissionsState,
  CodexPermissionMode,
  CursorPermissionsState,
  McpServer,
  McpToolsResult,
  McpTestResult,
} from '../../../types/types';

export type AgentContext = {
  authStatus: AuthStatus;
  onLogin: () => void;
};

export type AgentContextByProvider = Record<AgentProvider, AgentContext>;

export type AgentsSettingsTabProps = {
  claudeAuthStatus: AuthStatus;
  cursorAuthStatus: AuthStatus;
  codexAuthStatus: AuthStatus;
  onClaudeLogin: () => void;
  onCursorLogin: () => void;
  onCodexLogin: () => void;
  claudePermissions: ClaudePermissionsState;
  onClaudePermissionsChange: (value: ClaudePermissionsState) => void;
  cursorPermissions: CursorPermissionsState;
  onCursorPermissionsChange: (value: CursorPermissionsState) => void;
  codexPermissionMode: CodexPermissionMode;
  onCodexPermissionModeChange: (value: CodexPermissionMode) => void;
  mcpServers: McpServer[];
  cursorMcpServers: McpServer[];
  codexMcpServers: McpServer[];
  mcpTestResults: Record<string, McpTestResult>;
  mcpServerTools: Record<string, McpToolsResult>;
  mcpToolsLoading: Record<string, boolean>;
  deleteError: string | null;
  onOpenMcpForm: (server?: McpServer) => void;
  onDeleteMcpServer: (serverId: string, scope?: string) => void;
  onTestMcpServer: (serverId: string, scope?: string) => void;
  onDiscoverMcpTools: (serverId: string, scope?: string) => void;
  onOpenCodexMcpForm: (server?: McpServer) => void;
  onDeleteCodexMcpServer: (serverId: string) => void;
};

export type AgentCategoryTabsSectionProps = {
  selectedCategory: AgentCategory;
  onSelectCategory: (category: AgentCategory) => void;
};

export type AgentSelectorSectionProps = {
  selectedAgent: AgentProvider;
  onSelectAgent: (agent: AgentProvider) => void;
  agentContextById: AgentContextByProvider;
};

export type AgentCategoryContentSectionProps = {
  selectedAgent: AgentProvider;
  selectedCategory: AgentCategory;
  agentContextById: AgentContextByProvider;
  claudePermissions: ClaudePermissionsState;
  onClaudePermissionsChange: (value: ClaudePermissionsState) => void;
  cursorPermissions: CursorPermissionsState;
  onCursorPermissionsChange: (value: CursorPermissionsState) => void;
  codexPermissionMode: CodexPermissionMode;
  onCodexPermissionModeChange: (value: CodexPermissionMode) => void;
  mcpServers: McpServer[];
  cursorMcpServers: McpServer[];
  codexMcpServers: McpServer[];
  mcpTestResults: Record<string, McpTestResult>;
  mcpServerTools: Record<string, McpToolsResult>;
  mcpToolsLoading: Record<string, boolean>;
  deleteError: string | null;
  onOpenMcpForm: (server?: McpServer) => void;
  onDeleteMcpServer: (serverId: string, scope?: string) => void;
  onTestMcpServer: (serverId: string, scope?: string) => void;
  onDiscoverMcpTools: (serverId: string, scope?: string) => void;
  onOpenCodexMcpForm: (server?: McpServer) => void;
  onDeleteCodexMcpServer: (serverId: string) => void;
};
