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
 * Command Code MCP config adapter.
 *
 * Command Code reads the same `{"mcpServers":{...}}` JSON shape as Claude, from
 * `.mcp.json` (project), `~/.commandcode/mcp.json` (user) and a private "local"
 * scope under `~/.commandcode/projects/<slug>/mcp.json`. Unlike Claude's
 * per-server `type` discriminator, Command Code's canonical per-server entries
 * use a `transport` field (stdio/http), with `type` accepted only as a legacy
 * alias on read. Writes always emit `transport`.
 */
export class CommandCodeMcpProvider extends McpProvider {
  constructor() {
    super('command-code', ['user', 'local', 'project'], ['stdio', 'http', 'sse']);
  }

  private resolveMcpFilePath(scope: McpScope, workspacePath: string): string {
    if (scope === 'project') {
      return path.join(workspacePath, '.mcp.json');
    }

    if (scope === 'user') {
      return path.join(os.homedir(), '.commandcode', 'mcp.json');
    }

    // Local scope: a private, machine-specific config under the project slug.
    const slug = this.slugifyProjectPath(workspacePath);
    return path.join(os.homedir(), '.commandcode', 'projects', slug, 'mcp.json');
  }

  /**
   * Encodes a workspace path into Command Code's project-slug directory name.
   *
   * The CLI slugs the working directory (e.g. `d-rn-d-claudecodeui-contrib`).
   * This mirrors that transformation closely enough to read/write the
   * machine-local config; sessions are keyed the same way on disk.
   */
  private slugifyProjectPath(workspacePath: string): string {
    const normalized = workspacePath.trim().replace(/[\\/]+$/, '');
    const baseName = normalized.split(/[\\/]/).filter(Boolean).pop() || 'default';
    return baseName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  }

  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    const filePath = this.resolveMcpFilePath(scope, workspacePath);
    const config = await readJsonConfig(filePath);
    return readObjectRecord(config.mcpServers) ?? {};
  }

  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    const filePath = this.resolveMcpFilePath(scope, workspacePath);
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

      return {
        transport: 'stdio',
        command: input.command,
        args: input.args ?? [],
        env: input.env ?? {},
        enabled: true,
      };
    }

    if (!input.url?.trim()) {
      throw new AppError('url is required for http/sse MCP servers.', {
        code: 'MCP_URL_REQUIRED',
        statusCode: 400,
      });
    }

    return {
      transport: input.transport,
      url: input.url,
      headers: input.headers ?? {},
      enabled: true,
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

    // `transport` is the canonical discriminator; `type` is accepted as a
    // legacy alias so configs written by Claude-style tools still load.
    const transport = readOptionalString(config.transport)
      ?? readOptionalString(config.type)
      ?? (typeof config.command === 'string' || Array.isArray(config.command) ? 'stdio' : undefined)
      ?? (typeof config.url === 'string' ? 'http' : undefined);

    if (transport === 'stdio') {
      const commandParts = typeof config.command === 'string'
        ? [config.command, ...(readStringArray(config.args) ?? [])]
        : readStringArray(config.command);
      const command = commandParts?.[0];
      if (!command) {
        return null;
      }

      return {
        provider: 'command-code',
        name,
        scope,
        transport: 'stdio',
        command,
        args: commandParts.slice(1),
        env: readStringRecord(config.env) ?? readStringRecord(config.environment),
      };
    }

    if (transport === 'http' || transport === 'sse') {
      const url = readOptionalString(config.url);
      if (!url) {
        return null;
      }

      return {
        provider: 'command-code',
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
