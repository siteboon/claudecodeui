import type { IProviderMcp } from '@/shared/interfaces.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

export class GroqMcpProvider implements IProviderMcp {
  async listServers(): Promise<Record<McpScope, ProviderMcpServer[]>> {
    return { user: [], local: [], project: [] };
  }

  async listServersForScope(): Promise<ProviderMcpServer[]> {
    return [];
  }

  async upsertServer(_input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    throw new AppError('Groq does not support MCP servers.', {
      code: 'GROQ_MCP_NOT_SUPPORTED',
      statusCode: 400,
    });
  }

  async removeServer(
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: 'groq'; name: string; scope: McpScope }> {
    return { removed: false, provider: 'groq', name: input.name, scope: input.scope ?? 'user' };
  }
}
