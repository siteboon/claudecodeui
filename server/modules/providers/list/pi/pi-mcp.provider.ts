import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * MCP adapter for pi.
 *
 * pi has no MCP integration at all: the facet registers with no supported
 * scopes or transports, so the shared base answers reads with the empty set.
 * Every read/write hook and both public write entry points reject with
 * `NOT_SUPPORTED` so nothing can mistake "no servers configured" for "pi
 * cannot do MCP".
 */
export class PiMcpProvider extends McpProvider {
  constructor() {
    super('pi', [], []);
  }

  async upsertServer(_input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    throw new AppError('Pi does not support MCP', { code: 'NOT_SUPPORTED' });
  }

  async removeServer(_input: {
    name: string;
    scope?: McpScope;
    workspacePath?: string;
  }): Promise<{ removed: boolean; provider: 'pi'; name: string; scope: McpScope }> {
    throw new AppError('Pi does not support MCP', { code: 'NOT_SUPPORTED' });
  }

  protected async readScopedServers(_scope: McpScope, _workspacePath: string): Promise<Record<string, unknown>> {
    throw new AppError('Pi does not support MCP', { code: 'NOT_SUPPORTED' });
  }

  protected async writeScopedServers(
    _scope: McpScope,
    _workspacePath: string,
    _servers: Record<string, unknown>,
  ): Promise<void> {
    throw new AppError('Pi does not support MCP', { code: 'NOT_SUPPORTED' });
  }

  protected buildServerConfig(_input: UpsertProviderMcpServerInput): Record<string, unknown> {
    throw new AppError('Pi does not support MCP', { code: 'NOT_SUPPORTED' });
  }

  protected normalizeServerConfig(
    _scope: McpScope,
    _name: string,
    _rawConfig: unknown,
  ): ProviderMcpServer | null {
    throw new AppError('Pi does not support MCP', { code: 'NOT_SUPPORTED' });
  }
}
