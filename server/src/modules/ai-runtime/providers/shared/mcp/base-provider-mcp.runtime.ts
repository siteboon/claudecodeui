import type { LLMProvider } from '@/shared/types/app.js';
import { AppError } from '@/shared/utils/app-error.js';
import type {
  IProviderMcpRuntime,
  McpScope,
  McpTransport,
  ProviderMcpServer,
  UpsertProviderMcpServerInput,
} from '@/modules/ai-runtime/types/index.js';
import {
  normalizeServerName,
  resolveWorkspacePath,
  runHttpServerProbe,
  runStdioServerProbe,
} from '@/modules/ai-runtime/providers/shared/mcp/mcp-runtime.utils.js';

/**
 * Shared MCP runtime for provider-specific config readers/writers.
 */
export abstract class BaseProviderMcpRuntime implements IProviderMcpRuntime {
  protected readonly provider: LLMProvider;
  protected readonly supportedScopes: McpScope[];
  protected readonly supportedTransports: McpTransport[];

  protected constructor(
    provider: LLMProvider,
    supportedScopes: McpScope[],
    supportedTransports: McpTransport[],
  ) {
    this.provider = provider;
    this.supportedScopes = supportedScopes;
    this.supportedTransports = supportedTransports;
  }

  /**
   * Lists MCP servers grouped by user/local/project scopes.
   */
  async listServers(options?: { workspacePath?: string }): Promise<Record<McpScope, ProviderMcpServer[]>> {
    const grouped: Record<McpScope, ProviderMcpServer[]> = {
      user: [],
      local: [],
      project: [],
    };

    for (const scope of this.supportedScopes) {
      grouped[scope] = await this.listServersForScope(scope, options);
    }

    return grouped;
  }

  /**
   * Lists MCP servers for one scope.
   */
  async listServersForScope(
    scope: McpScope,
    options?: { workspacePath?: string },
  ): Promise<ProviderMcpServer[]> {
    if (!this.supportedScopes.includes(scope)) {
      return [];
    }

    const workspacePath = resolveWorkspacePath(options?.workspacePath);
    const scopedServers = await this.readScopedServers(scope, workspacePath);
    return Object.entries(scopedServers)
      .map(([name, rawConfig]) => this.normalizeServerConfig(scope, name, rawConfig))
      .filter((entry): entry is ProviderMcpServer => entry !== null);
  }

  /**
   * Adds or updates one MCP server.
   */
  async upsertServer(input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    const scope = input.scope ?? 'project';
    this.assertScopeAndTransport(scope, input.transport);

    const workspacePath = resolveWorkspacePath(input.workspacePath);
    const normalizedName = normalizeServerName(input.name);
    const scopedServers = await this.readScopedServers(scope, workspacePath);
    scopedServers[normalizedName] = this.buildServerConfig(input);
    await this.writeScopedServers(scope, workspacePath, scopedServers);

    return {
      provider: this.provider,
      name: normalizedName,
      scope,
      transport: input.transport,
      command: input.command,
      args: input.args,
      env: input.env,
      cwd: input.cwd,
      url: input.url,
      headers: input.headers,
      envVars: input.envVars,
      bearerTokenEnvVar: input.bearerTokenEnvVar,
      envHttpHeaders: input.envHttpHeaders,
    };
  }

  /**
   * Removes one MCP server for the selected scope.
   */
  async removeServer(
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: LLMProvider; name: string; scope: McpScope }> {
    const scope = input.scope ?? 'project';
    this.assertScope(scope);

    const workspacePath = resolveWorkspacePath(input.workspacePath);
    const normalizedName = normalizeServerName(input.name);
    const scopedServers = await this.readScopedServers(scope, workspacePath);
    const removed = Object.prototype.hasOwnProperty.call(scopedServers, normalizedName);
    if (removed) {
      delete scopedServers[normalizedName];
      await this.writeScopedServers(scope, workspacePath, scopedServers);
    }

    return { removed, provider: this.provider, name: normalizedName, scope };
  }

  /**
   * Executes a lightweight startup/connectivity probe for one configured MCP server.
   */
  async runServer(
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{
    provider: LLMProvider;
    name: string;
    scope: McpScope;
    transport: McpTransport;
    reachable: boolean;
    statusCode?: number;
    error?: string;
  }> {
    const scope = input.scope ?? 'project';
    this.assertScope(scope);

    const workspacePath = resolveWorkspacePath(input.workspacePath);
    const normalizedName = normalizeServerName(input.name);
    const scopedServers = await this.readScopedServers(scope, workspacePath);
    const rawConfig = scopedServers[normalizedName];
    if (!rawConfig || typeof rawConfig !== 'object') {
      throw new AppError(`MCP server "${normalizedName}" was not found.`, {
        code: 'MCP_SERVER_NOT_FOUND',
        statusCode: 404,
      });
    }

    const normalized = this.normalizeServerConfig(scope, normalizedName, rawConfig);
    if (!normalized) {
      throw new AppError(`MCP server "${normalizedName}" has an invalid configuration.`, {
        code: 'MCP_SERVER_INVALID_CONFIG',
        statusCode: 400,
      });
    }

    if (normalized.transport === 'stdio') {
      const result = await runStdioServerProbe(normalized, workspacePath);
      return {
        provider: this.provider,
        name: normalizedName,
        scope,
        transport: normalized.transport,
        reachable: result.reachable,
        error: result.error,
      };
    }

    const result = await runHttpServerProbe(normalized.url ?? '');
    return {
      provider: this.provider,
      name: normalizedName,
      scope,
      transport: normalized.transport,
      reachable: result.reachable,
      statusCode: result.statusCode,
      error: result.error,
    };
  }

  /**
   * Reads one scope's raw server map from provider-native files.
   */
  protected abstract readScopedServers(
    scope: McpScope,
    workspacePath: string,
  ): Promise<Record<string, unknown>>;

  /**
   * Persists one scope's raw server map back to provider-native files.
   */
  protected abstract writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Creates one provider-native config object from a unified input payload.
   */
  protected abstract buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown>;

  /**
   * Maps one provider-native server object into the unified response shape.
   */
  protected abstract normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null;

  /**
   * Ensures one scope is supported for the current provider.
   */
  protected assertScope(scope: McpScope): void {
    if (!this.supportedScopes.includes(scope)) {
      throw new AppError(`Provider "${this.provider}" does not support "${scope}" MCP scope.`, {
        code: 'MCP_SCOPE_NOT_SUPPORTED',
        statusCode: 400,
      });
    }
  }

  /**
   * Ensures one scope + transport pair is supported for the current provider.
   */
  protected assertScopeAndTransport(scope: McpScope, transport: McpTransport): void {
    this.assertScope(scope);
    if (!this.supportedTransports.includes(transport)) {
      throw new AppError(`Provider "${this.provider}" does not support "${transport}" MCP transport.`, {
        code: 'MCP_TRANSPORT_NOT_SUPPORTED',
        statusCode: 400,
      });
    }
  }
}
