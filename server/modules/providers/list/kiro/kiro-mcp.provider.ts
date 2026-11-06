import os from 'node:os';
import path from 'node:path';

import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
  writeJsonConfig,
} from '@/shared/utils.js';

const SETTINGS_DIR = path.join('.kiro', 'settings');

export class KiroMcpProvider extends McpProvider {
  constructor() {
    super('kiro', ['user', 'project'], ['stdio', 'http']);
  }

  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    const filePath = scope === 'user'
      ? path.join(os.homedir(), SETTINGS_DIR, 'mcp.json')
      : path.join(workspacePath, SETTINGS_DIR, 'mcp.json');
    const config = await readJsonConfig(filePath);
    return readObjectRecord(config.mcpServers) ?? {};
  }

  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    const filePath = scope === 'user'
      ? path.join(os.homedir(), SETTINGS_DIR, 'mcp.json')
      : path.join(workspacePath, SETTINGS_DIR, 'mcp.json');
    const config = await readJsonConfig(filePath);
    // Carry provider-specific flags into the same write as the edited server.
    // The base class has already normalized server names and validated scope.
    const previousServers = readObjectRecord(config.mcpServers) ?? {};
    for (const [name, rawServer] of Object.entries(servers)) {
      const previous = readObjectRecord(previousServers[name]);
      const server = readObjectRecord(rawServer);
      if (!previous || !server) continue;
      for (const key of ['disabled', 'autoApprove']) {
        if (previous[key] !== undefined) server[key] = previous[key];
      }
    }
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

    const httpConfig: Record<string, unknown> = {
      url: input.url,
      headers: input.headers ?? {},
    };
    if (input.bearerTokenEnvVar) {
      httpConfig.bearer_token_env_var = input.bearerTokenEnvVar;
    }
    return httpConfig;
  }

  protected normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null {
    if (!rawConfig || typeof rawConfig !== 'object') {
      return null;
    }

    const config = rawConfig as Record<string, unknown>;
    if (typeof config.command === 'string') {
      return {
        provider: 'kiro',
        name,
        scope,
        transport: 'stdio',
        command: config.command,
        args: readStringArray(config.args),
        env: readStringRecord(config.env),
      };
    }

    if (typeof config.url === 'string') {
      return {
        provider: 'kiro',
        name,
        scope,
        transport: 'http',
        url: config.url,
        headers: readStringRecord(config.headers),
        bearerTokenEnvVar: readOptionalString(config.bearer_token_env_var),
      };
    }

    return null;
  }

}
