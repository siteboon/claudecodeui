import type { IProviderMcp } from '@/shared/interfaces.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

export class OpenClaudeMcpProvider implements IProviderMcp {
  async listServers(): Promise<Record<McpScope, ProviderMcpServer[]>> {
    return { user: [], local: [], project: [] };
  }

  async listServersForScope(): Promise<ProviderMcpServer[]> {
    return [];
  }

  async upsertServer(_input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    throw new AppError('OpenClaude does not support MCP servers.', {
      code: 'OPENCLAUDE_MCP_NOT_SUPPORTED',
      statusCode: 400,
    });
  }

  async removeServer(
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: 'openclaude'; name: string; scope: McpScope }> {
    return { removed: false, provider: 'openclaude', name: input.name, scope: input.scope ?? 'user' };
  }
}
