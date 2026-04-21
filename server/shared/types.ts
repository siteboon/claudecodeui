// -------------- HTTP API response shapes for the server, shared across modules --------------

export type ApiSuccessShape<TData = unknown> = {
  success: true;
  data: TData;
};

export type AnyRecord = Record<string, any>;

// ---------------------------------------------------------------------------------------------

export type LLMProvider = 'claude' | 'codex' | 'gemini' | 'cursor';

// ---------------------------------------------------------------------------------------------

export type MessageKind =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'thinking'
  | 'stream_delta'
  | 'stream_end'
  | 'error'
  | 'complete'
  | 'status'
  | 'permission_request'
  | 'permission_cancelled'
  | 'session_created'
  | 'interactive_prompt'
  | 'task_notification';

/**
 * Provider-neutral message event emitted over REST and realtime transports.
 *
 * Providers all produce their own native SDK/CLI event shapes, so this type keeps
 * the common envelope strict while allowing provider-specific details to ride
 * along as optional properties.
 */
export type NormalizedMessage = {
  id: string;
  sessionId: string;
  timestamp: string;
  provider: LLMProvider;
  kind: MessageKind;
  role?: 'user' | 'assistant';
  content?: string;
  images?: unknown;
  toolName?: string;
  toolInput?: unknown;
  toolId?: string;
  toolResult?: {
    content?: string;
    isError?: boolean;
    toolUseResult?: unknown;
  };
  isError?: boolean;
  text?: string;
  tokens?: number;
  canInterrupt?: boolean;
  requestId?: string;
  input?: unknown;
  context?: unknown;
  reason?: string;
  newSessionId?: string;
  status?: string;
  summary?: string;
  tokenBudget?: unknown;
  subagentTools?: unknown;
  toolUseResult?: unknown;
  sequence?: number;
  rowid?: number;
  [key: string]: unknown;
};

/**
 * Pagination and provider lookup options for reading persisted session history.
 */
export type FetchHistoryOptions = {
  /** Claude project folder name. Required by Claude history lookup. */
  projectName?: string;
  /** Absolute workspace path. Required by Cursor to compute its chat hash. */
  projectPath?: string;
  /** Page size. `null` means all messages. */
  limit?: number | null;
  /** Pagination offset from the newest messages. */
  offset?: number;
};

/**
 * Provider-neutral history result returned by the unified messages endpoint.
 */
export type FetchHistoryResult = {
  messages: NormalizedMessage[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number | null;
  tokenUsage?: unknown;
};

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

// ---------------------------------------------------------------------------------------------

// -------------------- Provider auth status types --------------------
/**
 * Result of a provider status check (installation + authentication).
 *
 * installed - Whether the provider's CLI/SDK is available
 * provider - Provider id the status belongs to
 * authenticated - Whether valid credentials exist
 * email - User email or auth method identifier
 * method - Auth method (e.g. 'api_key', 'credentials_file')
 * [error] - Error message if not installed or not authenticated
 */
export type ProviderAuthStatus = {
  installed: boolean;
  provider: LLMProvider;
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};
