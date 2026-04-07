import os from 'node:os';
import path from 'node:path';

import { AppError } from '@/shared/utils/app-error.js';
import type {
  McpScope,
  ProviderMcpServer,
  UpsertProviderMcpServerInput,
} from '@/modules/ai-runtime/types/index.js';
import { BaseProviderMcpRuntime } from '@/modules/ai-runtime/providers/shared/mcp/base-provider-mcp.runtime.js';
import {
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
  writeJsonConfig,
} from '@/modules/ai-runtime/providers/shared/mcp/mcp-runtime.utils.js';

/**
 * Claude MCP runtime backed by `~/.claude.json` and project `.mcp.json`.
 */
export class ClaudeMcpRuntime extends BaseProviderMcpRuntime {
  constructor() {
    super('claude', ['user', 'local', 'project'], ['stdio', 'http', 'sse']);
  }

  /**
   * Reads Claude MCP servers from user/local/project config locations.
   */
  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    if (scope === 'project') {
      const filePath = path.join(workspacePath, '.mcp.json');
      const config = await readJsonConfig(filePath);
      return readObjectRecord(config.mcpServers) ?? {};
    }

    const filePath = path.join(os.homedir(), '.claude.json');
    const config = await readJsonConfig(filePath);
    if (scope === 'user') {
      return readObjectRecord(config.mcpServers) ?? {};
    }

    const projects = readObjectRecord(config.projects) ?? {};
    const projectConfig = readObjectRecord(projects[workspacePath]) ?? {};
    return readObjectRecord(projectConfig.mcpServers) ?? {};
  }

  /**
   * Writes Claude MCP servers to user/local/project config locations.
   */
  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    if (scope === 'project') {
      const filePath = path.join(workspacePath, '.mcp.json');
      const config = await readJsonConfig(filePath);
      config.mcpServers = servers;
      await writeJsonConfig(filePath, config);
      return;
    }

    const filePath = path.join(os.homedir(), '.claude.json');
    const config = await readJsonConfig(filePath);
    if (scope === 'user') {
      config.mcpServers = servers;
      await writeJsonConfig(filePath, config);
      return;
    }

    const projects = readObjectRecord(config.projects) ?? {};
    const projectConfig = readObjectRecord(projects[workspacePath]) ?? {};
    projectConfig.mcpServers = servers;
    projects[workspacePath] = projectConfig;
    config.projects = projects;
    await writeJsonConfig(filePath, config);
  }

  /**
   * Builds one Claude-native server object from the unified input payload.
   */
  protected buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown> {
    if (input.transport === 'stdio') {
      if (!input.command?.trim()) {
        throw new AppError('command is required for stdio MCP servers.', {
          code: 'MCP_COMMAND_REQUIRED',
          statusCode: 400,
        });
      }

      return {
        type: 'stdio',
        command: input.command,
        args: input.args ?? [],
        env: input.env ?? {},
      };
    }

    if (!input.url?.trim()) {
      throw new AppError('url is required for http/sse MCP servers.', {
        code: 'MCP_URL_REQUIRED',
        statusCode: 400,
      });
    }

    return {
      type: input.transport,
      url: input.url,
      headers: input.headers ?? {},
    };
  }

  /**
   * Normalizes one Claude server object.
   */
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
        provider: 'claude',
        name,
        scope,
        transport: 'stdio',
        command: config.command,
        args: readStringArray(config.args),
        env: readStringRecord(config.env),
      };
    }

    if (typeof config.url === 'string') {
      const transport = readOptionalString(config.type) === 'sse' ? 'sse' : 'http';
      return {
        provider: 'claude',
        name,
        scope,
        transport,
        url: config.url,
        headers: readStringRecord(config.headers),
      };
    }

    return null;
  }
}
