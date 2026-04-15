// -------------- HTTP API response shapes for the server, shared across modules --------------

export type ApiSuccessShape<TData = unknown> = {
  success: true;
  data: TData;
};

export type ApiErrorShape = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

// ---------------------------------------------------------------------------------------------

export type LLMProvider = 'claude' | 'codex' | 'gemini' | 'cursor';

// ---------------------------------------------------------------------------------------------

export type AppErrorOptions = {
  code?: string;
  statusCode?: number;
  details?: unknown;
};

// -------------------- MCP related shared types --------------------
export type McpScope = 'user' | 'local' | 'project';

export type McpTransport = 'stdio' | 'http' | 'sse';

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
