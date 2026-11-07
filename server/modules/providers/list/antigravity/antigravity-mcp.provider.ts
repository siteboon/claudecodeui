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

/** Antigravity MCP configuration adapter used by the provider registry. */
export class AntigravityMcpProvider extends McpProvider {
  /** Declares the scopes and transports supported by AGY configuration files. */
  constructor() {
    super('antigravity', ['user', 'project'], ['stdio', 'http']);
  }

  /** Keeps reads and writes on the standard AGY global/workspace configuration files. */
  private resolveConfigPath(scope: McpScope, workspacePath: string): string {
    return scope === 'user'
      ? path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json')
      : path.join(workspacePath, '.agents', 'mcp_config.json');
  }

  /** Reads the native MCP server map for one AGY scope. */
  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    const filePath = this.resolveConfigPath(scope, workspacePath);
    const config = await readJsonConfig(filePath);
    return readObjectRecord(config.mcpServers) ?? {};
  }

  /** Persists the native MCP server map for one AGY scope. */
  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    const filePath = this.resolveConfigPath(scope, workspacePath);
    const config = await readJsonConfig(filePath);
    config.mcpServers = servers;
    await writeJsonConfig(filePath, config);
  }

  /** Converts a validated shared MCP input into AGY's JSON representation. */
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
      throw new AppError('url is required for http MCP servers.', {
        code: 'MCP_URL_REQUIRED',
        statusCode: 400,
      });
    }

    return {
      serverUrl: input.url,
      headers: input.headers ?? {},
    };
  }

  /** Normalizes a valid native AGY MCP entry and rejects empty transports. */
  protected normalizeServerConfig(
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
        env: readStringRecord(config.env),
        cwd: readOptionalString(config.cwd),
      };
    }

    // Native AGY configs use serverUrl; also accept the adapter's earlier URL key.
    const url = readOptionalString(config.serverUrl) ?? readOptionalString(config.url);
    if (url) {
      return {
        provider: 'antigravity',
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
