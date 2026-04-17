import type {
  FetchHistoryOptions,
  FetchHistoryResult,
  LLMProvider,
  McpScope,
  McpTransport,
  NormalizedMessage,
  ProviderMcpServer,
  UpsertProviderMcpServerInput,
} from '@/shared/types.js';


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
 * Main provider contract for CLI and SDK integrations.
 *
 * Each concrete provider owns its MCP runtime plus the provider-specific logic
 * for converting native events/history into the app's normalized message shape.
 */
export interface IProvider {
  readonly id: LLMProvider;
  readonly mcp: IProviderMcpRuntime;

  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[];
  fetchHistory(sessionId: string, options?: FetchHistoryOptions): Promise<FetchHistoryResult>;
}
