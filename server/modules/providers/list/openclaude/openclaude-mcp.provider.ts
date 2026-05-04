import type { IProviderMcp } from '@/shared/interfaces.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

// OpenClaude manages its own MCP servers via ~/.config/occ/settings.json.
// CloudCLI does not proxy MCP configuration to OCC.
export class OpenClaudeMcpProvider implements IProviderMcp {
  async listServers(): Promise<Record<McpScope, ProviderMcpServer[]>> {
    return { user: [], local: [], project: [] };
  }

  async listServersForScope(): Promise<ProviderMcpServer[]> {
    return [];
  }

  async upsertServer(_input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    throw new AppError('OpenClaude manages its own MCP servers. Configure them in ~/.config/occ/settings.json.', {
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
