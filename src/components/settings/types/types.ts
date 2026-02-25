import type { Dispatch, SetStateAction } from 'react';

export type SettingsMainTab = 'agents' | 'appearance' | 'git' | 'api' | 'tasks';
export type AgentProvider = 'claude' | 'cursor' | 'codex';
export type AgentCategory = 'account' | 'permissions' | 'mcp';
export type ProjectSortOrder = 'name' | 'date';
export type SaveStatus = 'success' | 'error' | null;
export type CodexPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';
export type McpImportMode = 'form' | 'json';
export type McpScope = 'user' | 'local';
export type McpTransportType = 'stdio' | 'sse' | 'http';

export type SettingsProject = {
  name: string;
  displayName?: string;
  fullPath?: string;
  path?: string;
};

export type AuthStatus = {
  authenticated: boolean;
  email: string | null;
  loading: boolean;
  error: string | null;
};

export type KeyValueMap = Record<string, string>;

export type McpServerConfig = {
  command?: string;
  args?: string[];
  env?: KeyValueMap;
  url?: string;
  headers?: KeyValueMap;
  timeout?: number;
};

export type McpServer = {
  id?: string;
  name: string;
  type?: string;
  scope?: string;
  projectPath?: string;
  config?: McpServerConfig;
  raw?: unknown;
  created?: string;
  updated?: string;
};

export type ClaudeMcpFormConfig = {
  command: string;
  args: string[];
  env: KeyValueMap;
  url: string;
  headers: KeyValueMap;
  timeout: number;
};

export type ClaudeMcpFormState = {
  name: string;
  type: McpTransportType;
  scope: McpScope;
  projectPath: string;
  config: ClaudeMcpFormConfig;
  importMode: McpImportMode;
  jsonInput: string;
  raw?: unknown;
};

export type CodexMcpFormConfig = {
  command: string;
  args: string[];
  env: KeyValueMap;
};

export type CodexMcpFormState = {
  name: string;
  type: 'stdio';
  config: CodexMcpFormConfig;
};

export type McpTestResult = {
  success: boolean;
  message: string;
  details?: string[];
  loading?: boolean;
};

export type McpTool = {
  name: string;
  [key: string]: unknown;
};

export type McpToolsResult = {
  success?: boolean;
  tools?: McpTool[];
  resources?: unknown[];
  prompts?: unknown[];
};

export type ClaudePermissionsState = {
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
};

export type CursorPermissionsState = {
  allowedCommands: string[];
  disallowedCommands: string[];
  skipPermissions: boolean;
};

export type CodeEditorSettingsState = {
  theme: 'dark' | 'light';
  wordWrap: boolean;
  showMinimap: boolean;
  lineNumbers: boolean;
  fontSize: string;
};

export type SettingsStoragePayload = {
  claude: ClaudePermissionsState & { projectSortOrder: ProjectSortOrder; lastUpdated: string };
  cursor: CursorPermissionsState & { lastUpdated: string };
  codex: { permissionMode: CodexPermissionMode; lastUpdated: string };
};

export type SettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  projects?: SettingsProject[];
  initialTab?: string;
};

export type SetState<T> = Dispatch<SetStateAction<T>>;
