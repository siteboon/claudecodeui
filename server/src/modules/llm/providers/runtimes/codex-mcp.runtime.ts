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
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
  readTomlConfig,
  writeTomlConfig,
} from '@/modules/llm/providers/runtimes/mcp-runtime.utils.js';

/**
 * Codex MCP runtime backed by user/project `.codex/config.toml`.
 */
export class CodexMcpRuntime extends BaseProviderMcpRuntime {
  constructor() {
    super('codex', ['user', 'project'], ['stdio', 'http']);
  }

  /**
   * Reads Codex MCP servers from user/project config.toml scopes.
   */
  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    const filePath = scope === 'user'
      ? path.join(os.homedir(), '.codex', 'config.toml')
      : path.join(workspacePath, '.codex', 'config.toml');
    const config = await readTomlConfig(filePath);
    return readObjectRecord(config.mcp_servers) ?? {};
  }

  /**
   * Writes Codex MCP servers to user/project config.toml scopes.
   */
  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    const filePath = scope === 'user'
      ? path.join(os.homedir(), '.codex', 'config.toml')
      : path.join(workspacePath, '.codex', 'config.toml');
    const config = await readTomlConfig(filePath);
    config.mcp_servers = servers;
    await writeTomlConfig(filePath, config);
  }

  /**
   * Builds one Codex-native server object from the unified input payload.
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
        env_vars: input.envVars ?? [],
        cwd: input.cwd,
      };
    }

    if (!input.url?.trim()) {
      throw new AppError('url is required for http MCP servers.', {
        code: 'MCP_URL_REQUIRED',
        statusCode: 400,
      });
    }

    return {
      url: input.url,
      bearer_token_env_var: input.bearerTokenEnvVar,
      http_headers: input.headers ?? {},
      env_http_headers: input.envHttpHeaders ?? {},
    };
  }

  /**
   * Normalizes one Codex server object.
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
        provider: 'codex',
        name,
        scope,
        transport: 'stdio',
        command: config.command,
        args: readStringArray(config.args),
        env: readStringRecord(config.env),
        cwd: readOptionalString(config.cwd),
        envVars: readStringArray(config.env_vars),
      };
    }

    if (typeof config.url === 'string') {
      return {
        provider: 'codex',
        name,
        scope,
        transport: 'http',
        url: config.url,
        headers: readStringRecord(config.http_headers),
        bearerTokenEnvVar: readOptionalString(config.bearer_token_env_var),
        envHttpHeaders: readStringRecord(config.env_http_headers),
      };
    }

    return null;
  }
}
