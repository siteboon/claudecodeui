import type { IProviderMcp } from '@/shared/interfaces.js';
import type { LLMProvider, McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const NOT_SUPPORTED = () =>
  new AppError('MCP management for omp is not supported yet', {
    code: 'MCP_NOT_SUPPORTED',
    statusCode: 501,
  });

/**
 * MCP stub for omp — reading returns no servers; mutating throws 501.
 *
 * Listing must stay non-throwing so the global MCP list/read paths and the
 * settings UI render omp cleanly; only direct writes are rejected. The global
 * add/remove helpers in mcp.service.ts skip providers with no writable scopes, so
 * omp is absent from those results rather than reported as a failure.
 */
export class OmpMcpProvider implements IProviderMcp {
  // Empty → MCP management is unsupported; the global add/remove helpers skip omp.
  readonly supportedScopes: McpScope[] = [];

  async listServers(_options?: { workspacePath?: string }): Promise<Record<McpScope, ProviderMcpServer[]>> {
    return { user: [], local: [], project: [] };
  }

  async listServersForScope(
    _scope: McpScope,
    _options?: { workspacePath?: string },
  ): Promise<ProviderMcpServer[]> {
    return [];
  }

  async upsertServer(_input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    throw NOT_SUPPORTED();
  }

  async removeServer(
    _input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: LLMProvider; name: string; scope: McpScope }> {
    throw NOT_SUPPORTED();
  }
}
