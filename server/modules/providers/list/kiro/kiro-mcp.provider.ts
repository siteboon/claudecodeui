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

  /**
   * Override the base `upsertServer` to preserve Kiro-specific fields that the
   * provider-neutral `UpsertProviderMcpServerInput` does not carry: `disabled`
   * (per-server enabled/disabled toggle) and `autoApprove` (whitelist of tool
   * names the user has pre-trusted). Without this override, every UI edit
   * silently re-enables disabled servers and wipes auto-approve lists.
   *
   * Strategy: read the existing entry BEFORE `super.upsertServer` rewrites the
   * file, then re-apply the preserved Kiro-only keys with a follow-up write.
   */
  async upsertServer(input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    const scope = input.scope ?? 'project';
    const workspacePath = scope === 'user'
      ? os.homedir()
      : (input.workspacePath ?? '');
    const filePath = scope === 'user'
      ? path.join(os.homedir(), SETTINGS_DIR, 'mcp.json')
      : path.join(workspacePath, SETTINGS_DIR, 'mcp.json');

    // Capture Kiro-only fields BEFORE the base class wipes them on rewrite.
    const preWriteConfig = await readJsonConfig(filePath);
    const preWriteServers = readObjectRecord(preWriteConfig.mcpServers) ?? {};
    const preWriteEntry = readObjectRecord(preWriteServers[input.name]);
    const preservedDisabled = preWriteEntry
      ? (preWriteEntry as Record<string, unknown>).disabled
      : undefined;
    const preservedAutoApprove = preWriteEntry
      ? (preWriteEntry as Record<string, unknown>).autoApprove
      : undefined;

    const result = await super.upsertServer(input);

    if (preservedDisabled !== undefined || preservedAutoApprove !== undefined) {
      const config = await readJsonConfig(filePath);
      const servers = readObjectRecord(config.mcpServers) ?? {};
      const updated = readObjectRecord(servers[input.name]) ?? {};
      if (preservedDisabled !== undefined) {
        updated.disabled = preservedDisabled;
      }
      if (preservedAutoApprove !== undefined) {
        updated.autoApprove = preservedAutoApprove;
      }
      servers[input.name] = updated;
      config.mcpServers = servers;
      await writeJsonConfig(filePath, config);
    }

    return result;
  }
}
