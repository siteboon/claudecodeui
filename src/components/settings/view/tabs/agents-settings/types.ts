import type {
  AgentProvider,
  AuthStatus,
  AgentCategory,
  ClaudePermissionsState,
  CodexPermissionMode,
  SettingsProject,
} from '../../../types/types';

export type AgentContext = {
  authStatus: AuthStatus;
  onLogin: () => void;
};

export type AgentContextByProvider = Record<AgentProvider, AgentContext>;
export type ProviderAuthStatusByProvider = Record<AgentProvider, AuthStatus>;

export type AgentsSettingsTabProps = {
  providerAuthStatus: ProviderAuthStatusByProvider;
  onProviderLogin: (provider: AgentProvider) => void;
  claudePermissions: ClaudePermissionsState;
  onClaudePermissionsChange: (value: ClaudePermissionsState) => void;
  codexPermissionMode: CodexPermissionMode;
  onCodexPermissionModeChange: (value: CodexPermissionMode) => void;
  projects: SettingsProject[];
};

export type AgentCategoryTabsSectionProps = {
  categories: AgentCategory[];
  selectedCategory: AgentCategory;
  onSelectCategory: (category: AgentCategory) => void;
};

export type AgentSelectorSectionProps = {
  agents: AgentProvider[];
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
  codexPermissionMode: CodexPermissionMode;
  onCodexPermissionModeChange: (value: CodexPermissionMode) => void;
  projects: SettingsProject[];
};
