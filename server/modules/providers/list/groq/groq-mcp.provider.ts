import type { IProviderMcp } from '@/shared/interfaces.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

// Groq uses the OpenAI-compatible API and does not have a concept of MCP servers.
// Excluded from global MCP distribution (commit 16b1013) because Groq has no mechanism
// to configure or persist MCP server entries — attempts would silently no-op.
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
