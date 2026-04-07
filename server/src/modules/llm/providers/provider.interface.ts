import type { LLMProvider } from '@/shared/types/app.js';

export type ProviderExecutionFamily = 'sdk' | 'cli';

export type ProviderSessionStatus = 'running' | 'completed' | 'failed' | 'stopped';

export type RuntimePermissionMode = 'ask' | 'allow' | 'deny';

export type McpScope = 'user' | 'local' | 'project';

export type McpTransport = 'stdio' | 'http' | 'sse';

export type ProviderSkillScope = 'user' | 'project' | 'plugin' | 'repo' | 'admin' | 'system';

/**
 * Advertises optional provider behaviors so route/service code can gate features.
 */
export type ProviderCapabilities = {
  supportsRuntimePermissionRequests: boolean;
  supportsThinkingModeControl: boolean;
};

/**
 * Provider MCP server descriptor normalized for frontend consumption.
 */
export type ProviderMcpServer = {
  provider: LLMProvider;
  name: string;
  scope: McpScope;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  envVars?: string[];
  bearerTokenEnvVar?: string;
  envHttpHeaders?: Record<string, string>;
};

/**
 * Shared payload shape for MCP server create/update operations.
 */
export type UpsertProviderMcpServerInput = {
  name: string;
  scope?: McpScope;
  transport: McpTransport;
  workspacePath?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  envVars?: string[];
  bearerTokenEnvVar?: string;
  envHttpHeaders?: Record<string, string>;
};

/**
 * Unified skill descriptor returned by provider skill runtimes.
 */
export type ProviderSkill = {
  provider: LLMProvider;
  scope: ProviderSkillScope;
  name: string;
  description?: string;
  invocation: string;
  filePath: string;
  pluginName?: string;
};

/**
 * Provider model descriptor normalized for frontend consumption.
 */
export type ProviderModel = {
  value: string;
  displayName: string;
  description?: string;
  default?: boolean;
  current?: boolean;
  supportsThinkingModes?: boolean;
  supportedThinkingModes?: string[];
};

/**
 * Unified in-memory event emitted while a provider session runs.
 */
export type ProviderSessionEvent = {
  timestamp: string;
  channel: 'sdk' | 'stdout' | 'stderr' | 'json' | 'system' | 'error';
  message?: string;
  data?: unknown;
};

/**
 * Common launch/resume payload consumed by all providers.
 */
export type StartSessionInput = {
  prompt: string;
  workspacePath?: string;
  sessionId?: string;
  model?: string;
  thinkingMode?: string;
  imagePaths?: string[];
  runtimePermissionMode?: RuntimePermissionMode;
  allowYolo?: boolean;
};

/**
 * Snapshot shape exposed externally for a provider session.
 */
export type ProviderSessionSnapshot = {
  sessionId: string;
  provider: LLMProvider;
  family: ProviderExecutionFamily;
  status: ProviderSessionStatus;
  startedAt: string;
  endedAt?: string;
  model?: string;
  thinkingMode?: string;
  events: ProviderSessionEvent[];
  error?: string;
};

/**
 * Provider contract that both SDK and CLI families implement.
 */
export interface IProvider {
  readonly id: LLMProvider;
  readonly family: ProviderExecutionFamily;
  readonly capabilities: ProviderCapabilities;
  readonly mcp: IProviderMcpRuntime;
  readonly skills: IProviderSkillsRuntime;

  listModels(): Promise<ProviderModel[]>;

  launchSession(input: StartSessionInput): Promise<ProviderSessionSnapshot>;
  resumeSession(input: StartSessionInput & { sessionId: string }): Promise<ProviderSessionSnapshot>;

  stopSession(sessionId: string): Promise<boolean>;

  getSession(sessionId: string): ProviderSessionSnapshot | null;
  listSessions(): ProviderSessionSnapshot[];
}

/**
 * MCP runtime contract for one provider.
 */
export interface IProviderMcpRuntime {
  listServers(options?: { workspacePath?: string }): Promise<Record<McpScope, ProviderMcpServer[]>>;
  listServersForScope(scope: McpScope, options?: { workspacePath?: string }): Promise<ProviderMcpServer[]>;
  upsertServer(input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer>;
  removeServer(
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: LLMProvider; name: string; scope: McpScope }>;
  runServer(
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{
    provider: LLMProvider;
    name: string;
    scope: McpScope;
    transport: McpTransport;
    reachable: boolean;
    statusCode?: number;
    error?: string;
  }>;
}

/**
 * Skills runtime contract for one provider.
 */
export interface IProviderSkillsRuntime {
  listSkills(options?: { workspacePath?: string }): Promise<ProviderSkill[]>;
}

/**
 * Internal mutable session state used by provider base classes.
 */
export type MutableProviderSession = Omit<ProviderSessionSnapshot, 'events'> & {
  events: ProviderSessionEvent[];
  completion: Promise<void>;
  stop: () => Promise<boolean>;
};
