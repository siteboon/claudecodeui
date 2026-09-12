import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * MCP adapter for Pi.
 *
 * Pi has no MCP integration, so the facet registers with no supported scopes
 * or transports: reads resolve to the empty set, and the shared base rejects
 * every upsert/removal through its own scope guards. The remaining write hooks
 * throw for the same reason should future base behavior ever reach them.
 */
export class PiMcpProvider extends McpProvider {
  constructor() {
    super('pi', [], []);
  }

  protected async readScopedServers(): Promise<Record<string, unknown>> {
    return {};
  }

  protected async writeScopedServers(): Promise<void> {
    throw new AppError('Pi does not support MCP server configuration.', {
      code: 'NOT_SUPPORTED',
    });
  }

  protected buildServerConfig(_input: UpsertProviderMcpServerInput): Record<string, unknown> {
    throw new AppError('Pi does not support MCP server configuration.', {
      code: 'NOT_SUPPORTED',
    });
  }

  protected normalizeServerConfig(): ProviderMcpServer | null {
    return null;
  }
}
