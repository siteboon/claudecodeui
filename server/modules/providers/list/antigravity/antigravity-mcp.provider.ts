import os from 'node:os';
import path from 'node:path';

import type { IProviderMcp, McpScope, ProviderMcpServer } from '@/shared/index.js';
import {
  AppError,
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
} from '@/shared/index.js';

// Native configuration is read-only in CloudCLI; expose keys for inspection
// without returning credentials to another authenticated server user.
const redactValues = (value: unknown): Record<string, string> | undefined => {
  const record = readStringRecord(value);
  return record ? Object.fromEntries(Object.keys(record).map((key) => [key, '[redacted]'])) : undefined;
};

const nativeMcpEditError = () => new AppError('Manage Antigravity MCP servers in Antigravity using /mcp.', {
  code: 'MCP_NATIVE_CONFIG_READ_ONLY',
  statusCode: 405,
});

/** Lists Antigravity MCP servers for the provider registry. Antigravity owns configuration edits. */
export class AntigravityMcpProvider implements IProviderMcp {
  readonly supportsMutations = false;

  async listServers(options?: { workspacePath?: string }): Promise<Record<McpScope, ProviderMcpServer[]>> {
    const [user, project] = await Promise.all([
      this.listServersForScope('user', options),
      this.listServersForScope('project', options),
    ]);
    return { user, project, local: [] };
  }

  async listServersForScope(
    scope: McpScope,
    options?: { workspacePath?: string },
  ): Promise<ProviderMcpServer[]> {
    if (scope !== 'user' && scope !== 'project') return [];

    const filePath = scope === 'user'
      ? path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json')
      : path.resolve(options?.workspacePath ?? process.cwd(), '.agents', 'mcp_config.json');
    const config = await readJsonConfig(filePath);
    return Object.entries(readObjectRecord(config.mcpServers) ?? {})
      .map(([name, entry]) => this.normalizeServerConfig(scope, name, entry))
      .filter((entry): entry is ProviderMcpServer => entry !== null);
  }

  async upsertServer(): Promise<never> {
    throw nativeMcpEditError();
  }

  async removeServer(): Promise<never> {
    throw nativeMcpEditError();
  }

  /** Normalizes a valid native AGY MCP entry and rejects empty transports. */
  private normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null {
    const config = readObjectRecord(rawConfig);
    if (!config) {
      return null;
    }

    const command = readOptionalString(config.command);
    if (command) {
      return {
        provider: 'antigravity',
        name,
        scope,
        transport: 'stdio',
        command,
        args: readStringArray(config.args),
        env: redactValues(config.env),
        cwd: readOptionalString(config.cwd),
      };
    }

    const url = readOptionalString(config.serverUrl) ?? readOptionalString(config.url);
    if (url) {
      return {
        provider: 'antigravity',
        name,
        scope,
        transport: 'http',
        url,
        headers: redactValues(config.headers),
        env: redactValues(config.env),
      };
    }

    return null;
  }
}
