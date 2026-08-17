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
 * ZCode config files keep MCP servers under the nested `mcp.servers` key
 * (integration plan §3.2.6, verified against the ZCode bundle). The `mcp`
 * object may carry other keys besides `servers`, so writes must preserve
 * them along with the config's top-level keys (e.g. `hooks`).
 */
const readServerRecords = (config: Record<string, unknown>): Record<string, unknown> => (
  readObjectRecord(readObjectRecord(config.mcp)?.servers) ?? {}
);

/**
 * Validates that a path does not escape its intended root directory.
 * Implements path security as required by integration plan §3.2.6.
 */
const validatePathSecurity = (targetPath: string, rootPath: string): void => {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(rootPath);

  if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`) && resolvedTarget !== resolvedRoot) {
    throw new AppError('Path validation failed: potential directory traversal attempt.', {
      code: 'PATH_SECURITY_VIOLATION',
      statusCode: 400,
    });
  }
};

/**
 * Finds the project-level ZCode config file (zcode.json or .zcode/config.json).
 * Based on integration plan §3.2.6 and ZCode's config discovery logic.
 */
const findProjectConfigPath = async (workspacePath: string): Promise<string | null> => {
  const candidates = [
    path.join(workspacePath, 'zcode.json'),
    path.join(workspacePath, '.zcode', 'config.json'),
  ];

  for (const candidate of candidates) {
    try {
      const stats = await stat(candidate);
      if (stats.isFile()) {
        return candidate;
      }
    } catch {
      // Try next candidate
    }
  }

  return null;
};

/**
 * ZCode MCP provider implementing ZCode-native MCP server configuration.
 * Extends McpProvider with ZCode-specific config file handling.
 */
export class ZCodeMcpProvider extends McpProvider {
  constructor() {
    // ZCode supports user and project scopes, with stdio and http transports
    super('zcode', ['user', 'project'], ['stdio', 'http']);
  }

  /**
   * Reads MCP servers for the given scope from ZCode config files.
   * Implements scope mapping: project → zcode.json, user → cli/config.json
   */
  protected async readScopedServers(
    scope: McpScope,
    workspacePath: string
  ): Promise<Record<string, unknown>> {
    if (scope === 'project') {
      const configPath = await findProjectConfigPath(workspacePath);
      if (!configPath) {
        return {}; // No project config exists
      }

      try {
        return readServerRecords(await readJsonConfig(configPath));
      } catch {
        return {}; // Config exists but is unreadable
      }
    }

    // User scope: ~/.zcode/cli/config.json
    const configPath = path.join(os.homedir(), '.zcode', 'cli', 'config.json');
    try {
      return readServerRecords(await readJsonConfig(configPath));
    } catch {
      return {}; // User config doesn't exist or is unreadable
    }
  }

  /**
   * Writes MCP servers for the given scope into the nested `mcp.servers` key,
   * preserving the config's other keys (top-level and under `mcp`) per §3.2.6.
   */
  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>
  ): Promise<void> {
    if (scope === 'project') {
      const configPath = await findProjectConfigPath(workspacePath);

      if (!configPath) {
        // Create new zcode.json if none exists
        await writeJsonConfig(path.join(workspacePath, 'zcode.json'), { mcp: { servers } });
        return;
      }

      // Validate path security
      validatePathSecurity(configPath, workspacePath);

      const config = await readJsonConfig(configPath);
      config.mcp = { ...readObjectRecord(config.mcp), servers };
      await writeJsonConfig(configPath, config);
      return;
    }

    // User scope: ~/.zcode/cli/config.json
    const configPath = path.join(os.homedir(), '.zcode', 'cli', 'config.json');

    let config: Record<string, unknown>;
    try {
      config = await readJsonConfig(configPath);
    } catch {
      // Config doesn't exist, create a fresh one
      config = {};
    }

    config.mcp = { ...readObjectRecord(config.mcp), servers };
    await writeJsonConfig(configPath, config);
  }

  /**
   * Builds ZCode-native MCP server configuration from normalized input.
   * Handles both stdio and http transport types.
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

    if (input.transport === 'http') {
      if (!input.url?.trim()) {
        throw new AppError('url is required for http MCP servers.', {
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
   * Normalizes ZCode-native server config to standard ProviderMcpServer format.
   * Handles both stdio and http configurations with proper validation.
   */
  protected normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown
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
        provider: 'zcode',
        name,
        scope,
        transport: 'stdio',
        command,
        args: readStringArray(config.args),
        env: readStringRecord(config.env),
        cwd: readOptionalString(config.cwd),
      };
    }

    // Handle http configuration
    if (typeof config.url === 'string') {
      const url = config.url.trim();
      if (!url) {
        return null;
      }

      return {
        provider: 'zcode',
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
