import path from 'node:path';

import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  getQoderHome,
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
  writeJsonConfig,
} from '@/shared/utils.js';

const resolveQoderConfigPath = (scope: McpScope, workspacePath: string): string => {
  // Qoder reads MCP servers from the user-level settings.json (Claude-style
  // `mcpServers` key) and from a project-level `.mcp.json`.
  return scope === 'user'
    ? path.join(getQoderHome(), 'settings.json')
    : path.join(workspacePath, '.mcp.json');
};

export class QoderMcpProvider extends McpProvider {
  constructor() {
    // Qoder supports user and project scoped MCP servers; `local` scope (like
    // Claude Code's project-local launch) is not a Qoder concept.
    super('qoder', ['user', 'project'], ['stdio', 'http']);
  }

  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    const config = await readJsonConfig(resolveQoderConfigPath(scope, workspacePath));
    return readObjectRecord(config.mcpServers) ?? {};
  }

  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    const filePath = resolveQoderConfigPath(scope, workspacePath);
    const config = await readJsonConfig(filePath);
    config.mcpServers = servers;
    await writeJsonConfig(filePath, config);
  }

  protected buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown> {
    if (input.transport === 'stdio') {
      if (!input.command?.trim()) {
        throw new AppError('command is required for stdio MCP servers.', {
          code: 'MCP_COMMAND_REQUIRED',
          statusCode: 400,
        });
      }

      // Qoder (Claude-compatible) config shape: command is a plain string.
      return {
        command: input.command,
        args: input.args ?? [],
        env: input.env ?? {},
      };
    }

    if (!input.url?.trim()) {
      throw new AppError('url is required for http MCP servers.', {
        code: 'MCP_URL_REQUIRED',
        statusCode: 400,
      });
    }

    return {
      type: 'http',
      url: input.url,
      headers: input.headers ?? {},
    };
  }

  protected normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null {
    const config = readObjectRecord(rawConfig);
    if (!config) {
      return null;
    }

    // stdio: Qoder config uses a plain-string command + args array.
    if (config.type === 'local' || config.command !== undefined) {
      const command = readOptionalString(config.command);
      if (!command) {
        return null;
      }

      return {
        provider: 'qoder',
        name,
        scope,
        transport: 'stdio',
        command,
        args: readStringArray(config.args) ?? [],
        env: readStringRecord(config.env),
      };
    }

    if (config.type === 'http' || typeof config.url === 'string') {
      const url = readOptionalString(config.url);
      if (!url) {
        return null;
      }

      return {
        provider: 'qoder',
        name,
        scope,
        transport: 'http',
        url,
        headers: readStringRecord(config.headers),
      };
    }

    return null;
  }
}
