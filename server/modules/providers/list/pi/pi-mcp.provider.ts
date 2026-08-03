import type { IProviderMcp } from '@/shared/interfaces.js';
import type {
  LLMProvider,
  McpScope,
  ProviderMcpServer,
  UpsertProviderMcpServerInput,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/** Every MCP scope the shared contract defines. */
const ALL_SCOPES: readonly McpScope[] = ['user', 'local', 'project'];

const unsupported = (): never => {
  throw new AppError('该 provider 不支持此能力', {
    code: 'PROVIDER_CAPABILITY_UNSUPPORTED',
    statusCode: 400,
  });
};

/**
 * MCP adapter for Pi.
 *
 * Pi does not support MCP servers, so reads return a complete grouping with an
 * empty array for every scope, and writes throw
 * `ERR-PROVIDER-CAPABILITY-UNSUPPORTED`.
 */
export class PiMcpProvider implements IProviderMcp {
  async listServers(): Promise<Record<McpScope, ProviderMcpServer[]>> {
    return ALL_SCOPES.reduce((grouped, scope) => {
      grouped[scope] = [];
      return grouped;
    }, {} as Record<McpScope, ProviderMcpServer[]>);
  }

  async listServersForScope(
    _scope: McpScope,
    _options?: { workspacePath?: string },
  ): Promise<ProviderMcpServer[]> {
    return [];
  }

  async upsertServer(_input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    return unsupported();
  }

  async removeServer(
    _input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: LLMProvider; name: string; scope: McpScope }> {
    return unsupported();
  }
}
