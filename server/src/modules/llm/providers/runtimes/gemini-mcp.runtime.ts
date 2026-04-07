import os from 'node:os';
import path from 'node:path';

import { AppError } from '@/shared/utils/app-error.js';
import type {
  McpScope,
  ProviderMcpServer,
  UpsertProviderMcpServerInput,
} from '@/modules/llm/providers/provider.interface.js';
import { BaseProviderMcpRuntime } from '@/modules/llm/providers/runtimes/base-provider-mcp.runtime.js';
import {
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
  writeJsonConfig,
} from '@/modules/llm/providers/runtimes/mcp-runtime.utils.js';

/**
 * Gemini MCP runtime backed by user/project `.gemini/settings.json`.
 */
export class GeminiMcpRuntime extends BaseProviderMcpRuntime {
  constructor() {
    super('gemini', ['user', 'project'], ['stdio', 'http', 'sse']);
  }

  /**
   * Reads Gemini MCP servers from user/project config files.
   */
  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    const filePath = scope === 'user'
      ? path.join(os.homedir(), '.gemini', 'settings.json')
      : path.join(workspacePath, '.gemini', 'settings.json');
    const config = await readJsonConfig(filePath);
    return readObjectRecord(config.mcpServers) ?? {};
  }

  /**
   * Writes Gemini MCP servers to user/project config files.
   */
  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    const filePath = scope === 'user'
      ? path.join(os.homedir(), '.gemini', 'settings.json')
      : path.join(workspacePath, '.gemini', 'settings.json');
    const config = await readJsonConfig(filePath);
    config.mcpServers = servers;
    await writeJsonConfig(filePath, config);
  }

  /**
   * Builds one Gemini-native server object from the unified input payload.
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
        command: input.command,
        args: input.args ?? [],
        env: input.env ?? {},
        cwd: input.cwd,
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
   * Normalizes one Gemini server object.
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
        provider: 'gemini',
        name,
        scope,
        transport: 'stdio',
        command: config.command,
        args: readStringArray(config.args),
        env: readStringRecord(config.env),
        cwd: readOptionalString(config.cwd),
      };
    }

    if (typeof config.url === 'string') {
      const transport = readOptionalString(config.type) === 'sse' ? 'sse' : 'http';
      return {
        provider: 'gemini',
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
