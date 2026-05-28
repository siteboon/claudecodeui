import os from 'node:os';

import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { LLMProvider, McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/** Cursor MCP is not supported on Windows hosts (no Cursor CLI integration). */
function includeProviderInGlobalMcp(providerId: LLMProvider): boolean {
  if (providerId === 'cursor' && os.platform() === 'win32') {
    return false;
  }

  return true;
}


export const providerMcpService = {
  /**
   * Lists MCP servers for one provider grouped by supported scopes.
   */
  async listProviderMcpServers(
    providerName: string,
    options?: { workspacePath?: string },
  ): Promise<Record<McpScope, ProviderMcpServer[]>> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.mcp.listServers(options);
  },

  /**
   * Lists MCP servers for one provider scope.
   */
  async listProviderMcpServersForScope(
    providerName: string,
    scope: McpScope,
    options?: { workspacePath?: string },
  ): Promise<ProviderMcpServer[]> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.mcp.listServersForScope(scope, options);
  },

  /**
   * Adds or updates one provider MCP server.
   */
  async upsertProviderMcpServer(
    providerName: string,
    input: UpsertProviderMcpServerInput,
  ): Promise<ProviderMcpServer> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.mcp.upsertServer(input);
  },

  /**
   * Removes one provider MCP server.
   */
  async removeProviderMcpServer(
    providerName: string,
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: LLMProvider; name: string; scope: McpScope }> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.mcp.removeServer(input);
  },

  /**
   * Adds one HTTP/stdio MCP server to every provider.
   */
  async addMcpServerToAllProviders(
    input: Omit<UpsertProviderMcpServerInput, 'scope'> & { scope?: Exclude<McpScope, 'local'> },
  ): Promise<Array<{ provider: LLMProvider; created: boolean; error?: string }>> {
    if (input.transport !== 'stdio' && input.transport !== 'http') {
      throw new AppError('Global MCP add supports only "stdio" and "http".', {
        code: 'INVALID_GLOBAL_MCP_TRANSPORT',
        statusCode: 400,
      });
    }

    const scope = input.scope ?? 'project';
    const results: Array<{ provider: LLMProvider; created: boolean; error?: string }> = [];
    const providers = providerRegistry.listProviders().filter((p) => includeProviderInGlobalMcp(p.id));
    for (const provider of providers) {
      try {
        await provider.mcp.upsertServer({ ...input, scope });
        results.push({ provider: provider.id, created: true });
      } catch (error) {
        results.push({
          provider: provider.id,
          created: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  },
};
