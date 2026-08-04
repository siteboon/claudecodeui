import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
} from '@/shared/utils.js';

type QoderConfigPath = {
  filePath: string;
  exists: boolean;
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const readQoderConfig = async (filePath: string): Promise<Record<string, unknown>> => {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    return readObjectRecord(parsed) ?? {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {};
    }

    throw error;
  }
};

const writeQoderConfig = async (filePath: string, data: Record<string, unknown>): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

const resolveQoderConfigPath = async (scope: McpScope, workspacePath: string): Promise<QoderConfigPath> => {
  // Qoder reads MCP servers from the user-level settings.json (Claude-style
  // `mcpServers` key) and from a project-level `.mcp.json`.
  const filePath = scope === 'user'
    ? path.join(os.homedir(), '.qoder', 'settings.json')
    : path.join(workspacePath, '.mcp.json');

  return { filePath, exists: await fileExists(filePath) };
};

export class QoderMcpProvider extends McpProvider {
  constructor() {
    // Qoder supports user and project scoped MCP servers; `local` scope (like
    // Claude Code's project-local launch) is not a Qoder concept.
    super('qoder', ['user', 'project'], ['stdio', 'http']);
  }

  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    const { filePath } = await resolveQoderConfigPath(scope, workspacePath);
    const config = await readQoderConfig(filePath);
    return readObjectRecord(config.mcpServers) ?? {};
  }

  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    const { filePath } = await resolveQoderConfigPath(scope, workspacePath);
    const config = await readQoderConfig(filePath);
    config.mcpServers = servers;
    await writeQoderConfig(filePath, config);
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
