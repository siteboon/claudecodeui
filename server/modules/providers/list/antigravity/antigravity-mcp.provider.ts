/**
 * Antigravity MCP Provider
 *
 * Implements MCP configuration management for the Antigravity CLI.
 * Adapts to `mcp_config.json` (`{"mcpServers": { ... }}`) for project and user scopes.
 *
 * @module antigravity-mcp.provider
 */

import { stat } from 'node:fs/promises';
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

/**
 * Reads server records from `{"mcpServers": { ... }}` envelope.
 */
const readServerRecords = (config: Record<string, unknown>): Record<string, unknown> => (
  readObjectRecord(config.mcpServers) ?? readObjectRecord(config.mcp_servers) ?? {}
);

/**
 * Finds the project-level MCP config file.
 */
const findProjectConfigPath = async (workspacePath: string): Promise<string | null> => {
  const candidates = [
    path.join(workspacePath, '.gemini', 'mcp_config.json'),
    path.join(workspacePath, 'mcp_config.json'),
    path.join(workspacePath, '.antigravity', 'mcp_config.json'),
  ];

  for (const candidate of candidates) {
    try {
      const stats = await stat(candidate);
      if (stats.isFile()) {
        return candidate;
      }
    } catch {
      // Try next
    }
  }

  return null;
};

/**
 * Resolves the user-level global MCP config file path. agy 1.1+ keeps its
 * global MCP config in `~/.gemini/config/mcp_config.json`; the previous
 * `~/.gemini/antigravity/` location only exists on old installations and is
 * kept as a read-only fallback.
 */
const resolveUserConfigPath = (): string => (
  path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json')
);

/**
 * Resolves the legacy user-level MCP config location written by older agy
 * versions. Used only for reading; writes always go to the current path.
 */
const resolveLegacyUserConfigPath = (): string => (
  path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json')
);

export class AntigravityMcpProvider extends McpProvider {
  constructor() {
    super('antigravity', ['user', 'project'], ['stdio', 'http', 'sse']);
  }

  /**
   * Reads MCP servers for the given scope from Antigravity config files.
   */
  protected async readScopedServers(
    scope: McpScope,
    workspacePath: string,
  ): Promise<Record<string, unknown>> {
    if (scope === 'project') {
      const configPath = await findProjectConfigPath(workspacePath);
      if (!configPath) {
        return {};
      }

      try {
        return readServerRecords(await readJsonConfig(configPath));
      } catch {
        return {};
      }
    }

    // User scope. `readJsonConfig` resolves a missing file to `{}` instead of
    // throwing, so fall back to the legacy location when the current one yields
    // no servers rather than via a catch.
    const currentServers = readServerRecords(await readJsonConfig(resolveUserConfigPath()));
    if (Object.keys(currentServers).length > 0) {
      return currentServers;
    }

    return readServerRecords(await readJsonConfig(resolveLegacyUserConfigPath()));
  }

  /**
   * Writes MCP servers for the given scope, preserving existing top-level keys.
   */
  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    if (scope === 'project') {
      let configPath = await findProjectConfigPath(workspacePath);

      if (!configPath) {
        configPath = path.join(workspacePath, '.gemini', 'mcp_config.json');
      }

      this.assertPathSecurity(configPath, workspacePath);

      let config: Record<string, unknown> = {};
      try {
        config = await readJsonConfig(configPath);
      } catch {
        config = {};
      }

      config.mcpServers = servers;
      await writeJsonConfig(configPath, config);
      return;
    }

    // User scope
    const configPath = resolveUserConfigPath();
    let config: Record<string, unknown> = {};
    try {
      config = await readJsonConfig(configPath);
    } catch {
      config = {};
    }

    config.mcpServers = servers;
    await writeJsonConfig(configPath, config);
  }

  /**
   * Builds Antigravity MCP server configuration from normalized input.
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
      };
    }

    if (input.transport === 'http' || input.transport === 'sse') {
      if (!input.url?.trim()) {
        throw new AppError(`url is required for ${input.transport} MCP servers.`, {
          code: 'MCP_URL_REQUIRED',
          statusCode: 400,
        });
      }

      return {
        url: input.url,
        headers: input.headers ?? {},
      };
    }

    throw new AppError(`Unsupported transport type: ${input.transport}`, {
      code: 'MCP_TRANSPORT_UNSUPPORTED',
      statusCode: 400,
    });
  }

  /**
   * Normalizes Antigravity server config to standard ProviderMcpServer format.
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

    // Handle stdio configuration
    if (typeof config.command === 'string') {
      const command = config.command.trim();
      if (!command) {
        return null;
      }

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

    // Handle http/sse configuration
    if (typeof config.url === 'string') {
      const url = config.url.trim();
      if (!url) {
        return null;
      }

      const transport = (typeof config.transport === 'string' && config.transport === 'sse')
        ? 'sse'
        : 'http';

      return {
        provider: 'antigravity',
        name,
        scope,
        transport,
        url,
        headers: readStringRecord(config.headers),
      };
    }

    return null;
  }
}
