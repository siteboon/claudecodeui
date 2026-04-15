import type {
  LLMProvider,
  McpScope,
  McpTransport,
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
 * Provider contract that both SDK and CLI families implement.
 */
export interface IProvider {
  readonly id: LLMProvider;
  readonly mcp: IProviderMcpRuntime;
}