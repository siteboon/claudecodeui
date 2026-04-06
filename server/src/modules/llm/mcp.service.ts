import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

import spawn from 'cross-spawn';
import TOML from '@iarna/toml';

import type { LLMProvider } from '@/shared/types/app.js';
import { AppError } from '@/shared/utils/app-error.js';

export type McpScope = 'user' | 'local' | 'project';
export type McpTransport = 'stdio' | 'http' | 'sse';

export type UnifiedMcpServer = {
  provider: LLMProvider;
  name: string;
  scope: McpScope;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  envVars?: string[];
  bearerTokenEnvVar?: string;
  envHttpHeaders?: Record<string, string>;
};

export type UpsertMcpServerInput = {
  name: string;
  scope?: McpScope;
  transport: McpTransport;
  workspacePath?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  envVars?: string[];
  bearerTokenEnvVar?: string;
  envHttpHeaders?: Record<string, string>;
};

const PROVIDER_CAPABILITIES: Record<LLMProvider, { scopes: McpScope[]; transports: McpTransport[] }> = {
  claude: { scopes: ['user', 'local', 'project'], transports: ['stdio', 'http', 'sse'] },
  codex: { scopes: ['user', 'project'], transports: ['stdio', 'http'] },
  cursor: { scopes: ['user', 'project'], transports: ['stdio', 'http', 'sse'] },
  gemini: { scopes: ['user', 'project'], transports: ['stdio', 'http', 'sse'] },
};

const PROVIDERS: LLMProvider[] = ['claude', 'codex', 'cursor', 'gemini'];

/**
 * Unified MCP configuration service backed by provider-native config files.
 */
export const llmMcpService = {
  /**
   * Lists MCP servers for one provider grouped by user/local/project scopes.
   */
  async listProviderServers(
    provider: LLMProvider,
    options?: { workspacePath?: string },
  ): Promise<Record<McpScope, UnifiedMcpServer[]>> {
    const workspacePath = resolveWorkspacePath(options?.workspacePath);
    const grouped: Record<McpScope, UnifiedMcpServer[]> = {
      user: [],
      local: [],
      project: [],
    };

    const capability = PROVIDER_CAPABILITIES[provider];
    for (const scope of capability.scopes) {
      const servers = await this.listProviderServersForScope(provider, scope, workspacePath);
      grouped[scope] = servers;
    }

    return grouped;
  },

  /**
   * Writes one MCP server definition into the provider's config file for the selected scope.
   */
  async upsertProviderServer(provider: LLMProvider, input: UpsertMcpServerInput): Promise<UnifiedMcpServer> {
    validateProviderScopeAndTransport(provider, input.scope ?? 'project', input.transport);
    const scope = input.scope ?? 'project';
    const workspacePath = resolveWorkspacePath(input.workspacePath);
    const normalizedName = normalizeServerName(input.name);
    const scopedServers = await readScopedProviderServers(provider, scope, workspacePath);
    scopedServers[normalizedName] = buildProviderServerConfig(provider, input);
    await writeScopedProviderServers(provider, scope, workspacePath, scopedServers);

    return {
      provider,
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
  },

  /**
   * Removes one MCP server definition from the provider's config file.
   */
  async removeProviderServer(
    provider: LLMProvider,
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: LLMProvider; name: string; scope: McpScope }> {
    const scope = input.scope ?? 'project';
    validateProviderScopeAndTransport(provider, scope, 'stdio');
    const workspacePath = resolveWorkspacePath(input.workspacePath);
    const normalizedName = normalizeServerName(input.name);
    const scopedServers = await readScopedProviderServers(provider, scope, workspacePath);
    const removed = Object.prototype.hasOwnProperty.call(scopedServers, normalizedName);
    if (removed) {
      delete scopedServers[normalizedName];
      await writeScopedProviderServers(provider, scope, workspacePath, scopedServers);
    }

    return { removed, provider, name: normalizedName, scope };
  },

  /**
   * Adds one MCP server to all providers using the same input shape.
   */
  async addServerToAllProviders(
    input: Omit<UpsertMcpServerInput, 'scope'> & { scope?: Exclude<McpScope, 'local'> },
  ): Promise<Array<{ provider: LLMProvider; created: boolean; error?: string }>> {
    if (input.transport !== 'stdio' && input.transport !== 'http') {
      throw new AppError('Global MCP add supports only "stdio" and "http".', {
        code: 'INVALID_GLOBAL_MCP_TRANSPORT',
        statusCode: 400,
      });
    }

    const scope = input.scope ?? 'project';
    const results: Array<{ provider: LLMProvider; created: boolean; error?: string }> = [];
    for (const provider of PROVIDERS) {
      try {
        await this.upsertProviderServer(provider, { ...input, scope });
        results.push({ provider, created: true });
      } catch (error) {
        results.push({
          provider,
          created: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  },

  /**
   * Performs a lightweight startup/connectivity check for one configured MCP server.
   */
  async runProviderServer(input: {
    provider: LLMProvider;
    name: string;
    scope?: McpScope;
    workspacePath?: string;
  }): Promise<{
    provider: LLMProvider;
    name: string;
    scope: McpScope;
    transport: McpTransport;
    reachable: boolean;
    statusCode?: number;
    error?: string;
  }> {
    const scope = input.scope ?? 'project';
    const workspacePath = resolveWorkspacePath(input.workspacePath);
    const normalizedName = normalizeServerName(input.name);
    const scopedServers = await readScopedProviderServers(input.provider, scope, workspacePath);
    const rawConfig = scopedServers[normalizedName];
    if (!rawConfig || typeof rawConfig !== 'object') {
      throw new AppError(`MCP server "${normalizedName}" was not found.`, {
        code: 'MCP_SERVER_NOT_FOUND',
        statusCode: 404,
      });
    }

    const normalized = normalizeServerConfig(input.provider, scope, normalizedName, rawConfig);
    if (!normalized) {
      throw new AppError(`MCP server "${normalizedName}" has an invalid configuration.`, {
        code: 'MCP_SERVER_INVALID_CONFIG',
        statusCode: 400,
      });
    }

    if (normalized.transport === 'stdio') {
      const result = await runStdioServerProbe(normalized, workspacePath);
      return {
        provider: input.provider,
        name: normalizedName,
        scope,
        transport: normalized.transport,
        reachable: result.reachable,
        error: result.error,
      };
    }

    const result = await runHttpServerProbe(normalized.url ?? '');
    return {
      provider: input.provider,
      name: normalizedName,
      scope,
      transport: normalized.transport,
      reachable: result.reachable,
      statusCode: result.statusCode,
      error: result.error,
    };
  },

  /**
   * Reads and normalizes one provider scope into unified MCP server records.
   */
  async listProviderServersForScope(
    provider: LLMProvider,
    scope: McpScope,
    workspacePath: string,
  ): Promise<UnifiedMcpServer[]> {
    if (!PROVIDER_CAPABILITIES[provider].scopes.includes(scope)) {
      return [];
    }

    const scopedServers = await readScopedProviderServers(provider, scope, workspacePath);
    return Object.entries(scopedServers)
      .map(([name, rawConfig]) => normalizeServerConfig(provider, scope, name, rawConfig))
      .filter((entry): entry is UnifiedMcpServer => entry !== null);
  },
};

/**
 * Resolves workspace paths once so all scope loaders read from a consistent absolute root.
 */
function resolveWorkspacePath(workspacePath?: string): string {
  return path.resolve(workspacePath ?? process.cwd());
}

/**
 * Restricts MCP server names to non-empty trimmed strings.
 */
function normalizeServerName(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new AppError('MCP server name is required.', {
      code: 'MCP_SERVER_NAME_REQUIRED',
      statusCode: 400,
    });
  }

  return normalized;
}

/**
 * Applies provider capability checks before read/write operations.
 */
function validateProviderScopeAndTransport(
  provider: LLMProvider,
  scope: McpScope,
  transport: McpTransport,
): void {
  const capability = PROVIDER_CAPABILITIES[provider];
  if (!capability.scopes.includes(scope)) {
    throw new AppError(`Provider "${provider}" does not support "${scope}" MCP scope.`, {
      code: 'MCP_SCOPE_NOT_SUPPORTED',
      statusCode: 400,
    });
  }

  if (!capability.transports.includes(transport)) {
    throw new AppError(`Provider "${provider}" does not support "${transport}" MCP transport.`, {
      code: 'MCP_TRANSPORT_NOT_SUPPORTED',
      statusCode: 400,
    });
  }
}

/**
 * Loads one scope's raw server map from a provider-native config file.
 */
async function readScopedProviderServers(
  provider: LLMProvider,
  scope: McpScope,
  workspacePath: string,
): Promise<Record<string, unknown>> {
  switch (provider) {
    case 'claude':
      return readClaudeScopedServers(scope, workspacePath);
    case 'codex':
      return readCodexScopedServers(scope, workspacePath);
    case 'cursor':
      return readCursorScopedServers(scope, workspacePath);
    case 'gemini':
      return readGeminiScopedServers(scope, workspacePath);
    default:
      return {};
  }
}

/**
 * Persists one scope's raw server map back to provider-native config files.
 */
async function writeScopedProviderServers(
  provider: LLMProvider,
  scope: McpScope,
  workspacePath: string,
  servers: Record<string, unknown>,
): Promise<void> {
  switch (provider) {
    case 'claude':
      await writeClaudeScopedServers(scope, workspacePath, servers);
      return;
    case 'codex':
      await writeCodexScopedServers(scope, workspacePath, servers);
      return;
    case 'cursor':
      await writeCursorScopedServers(scope, workspacePath, servers);
      return;
    case 'gemini':
      await writeGeminiScopedServers(scope, workspacePath, servers);
      return;
    default:
      return;
  }
}

/**
 * Creates one provider-native server config object from unified input payload.
 */
function buildProviderServerConfig(provider: LLMProvider, input: UpsertMcpServerInput): Record<string, unknown> {
  const scope = input.scope ?? 'project';
  validateProviderScopeAndTransport(provider, scope, input.transport);

  if (input.transport === 'stdio') {
    if (!input.command?.trim()) {
      throw new AppError('command is required for stdio MCP servers.', {
        code: 'MCP_COMMAND_REQUIRED',
        statusCode: 400,
      });
    }

    if (provider === 'claude') {
      return {
        type: 'stdio',
        command: input.command,
        args: input.args ?? [],
        env: input.env ?? {},
      };
    }

    if (provider === 'codex') {
      return {
        command: input.command,
        args: input.args ?? [],
        env: input.env ?? {},
        env_vars: input.envVars ?? [],
        cwd: input.cwd,
      };
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

  if (provider === 'codex') {
    return {
      url: input.url,
      bearer_token_env_var: input.bearerTokenEnvVar,
      http_headers: input.headers ?? {},
      env_http_headers: input.envHttpHeaders ?? {},
    };
  }

  if (provider === 'cursor') {
    return {
      url: input.url,
      headers: input.headers ?? {},
    };
  }

  return {
    type: input.transport,
    url: input.url,
    headers: input.headers ?? {},
  };
}

/**
 * Maps one provider-native server object into the unified response shape.
 */
function normalizeServerConfig(
  provider: LLMProvider,
  scope: McpScope,
  name: string,
  rawConfig: unknown,
): UnifiedMcpServer | null {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return null;
  }

  const config = rawConfig as Record<string, unknown>;
  if (typeof config.command === 'string') {
    const transport: McpTransport = 'stdio';
    return {
      provider,
      name,
      scope,
      transport,
      command: config.command,
      args: readStringArray(config.args),
      env: readStringRecord(config.env),
      cwd: readOptionalString(config.cwd),
      envVars: readStringArray(config.env_vars),
    };
  }

  if (typeof config.url === 'string') {
    let transport: McpTransport = 'http';
    if (provider === 'claude' || provider === 'gemini') {
      const typeValue = readOptionalString(config.type);
      if (typeValue === 'sse') {
        transport = 'sse';
      }
    }

    return {
      provider,
      name,
      scope,
      transport,
      url: config.url,
      headers: readStringRecord(config.headers) ?? readStringRecord(config.http_headers),
      bearerTokenEnvVar: readOptionalString(config.bearer_token_env_var),
      envHttpHeaders: readStringRecord(config.env_http_headers),
    };
  }

  return null;
}

/**
 * Reads Claude MCP servers from ~/.claude.json and project .mcp.json files.
 */
async function readClaudeScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
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

  if (scope === 'local') {
    const projects = readObjectRecord(config.projects) ?? {};
    const projectConfig = readObjectRecord(projects[workspacePath]) ?? {};
    return readObjectRecord(projectConfig.mcpServers) ?? {};
  }

  return {};
}

/**
 * Persists Claude MCP servers back to ~/.claude.json or .mcp.json depending on scope.
 */
async function writeClaudeScopedServers(
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
 * Reads Codex MCP servers from config.toml user or project scopes.
 */
async function readCodexScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
  if (scope === 'local') {
    throw new AppError('Codex does not support local MCP scope.', {
      code: 'MCP_SCOPE_NOT_SUPPORTED',
      statusCode: 400,
    });
  }

  const filePath = scope === 'user'
    ? path.join(os.homedir(), '.codex', 'config.toml')
    : path.join(workspacePath, '.codex', 'config.toml');
  const config = await readTomlConfig(filePath);
  return readObjectRecord(config.mcp_servers) ?? {};
}

/**
 * Persists Codex MCP servers to config.toml user/project scopes.
 */
async function writeCodexScopedServers(
  scope: McpScope,
  workspacePath: string,
  servers: Record<string, unknown>,
): Promise<void> {
  if (scope === 'local') {
    throw new AppError('Codex does not support local MCP scope.', {
      code: 'MCP_SCOPE_NOT_SUPPORTED',
      statusCode: 400,
    });
  }

  const filePath = scope === 'user'
    ? path.join(os.homedir(), '.codex', 'config.toml')
    : path.join(workspacePath, '.codex', 'config.toml');
  const config = await readTomlConfig(filePath);
  config.mcp_servers = servers;
  await writeTomlConfig(filePath, config);
}

/**
 * Reads Gemini MCP servers from settings.json user/project scopes.
 */
async function readGeminiScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
  if (scope === 'local') {
    throw new AppError('Gemini does not support local MCP scope.', {
      code: 'MCP_SCOPE_NOT_SUPPORTED',
      statusCode: 400,
    });
  }

  const filePath = scope === 'user'
    ? path.join(os.homedir(), '.gemini', 'settings.json')
    : path.join(workspacePath, '.gemini', 'settings.json');
  const config = await readJsonConfig(filePath);
  return readObjectRecord(config.mcpServers) ?? {};
}

/**
 * Persists Gemini MCP servers to settings.json user/project scopes.
 */
async function writeGeminiScopedServers(
  scope: McpScope,
  workspacePath: string,
  servers: Record<string, unknown>,
): Promise<void> {
  if (scope === 'local') {
    throw new AppError('Gemini does not support local MCP scope.', {
      code: 'MCP_SCOPE_NOT_SUPPORTED',
      statusCode: 400,
    });
  }

  const filePath = scope === 'user'
    ? path.join(os.homedir(), '.gemini', 'settings.json')
    : path.join(workspacePath, '.gemini', 'settings.json');
  const config = await readJsonConfig(filePath);
  config.mcpServers = servers;
  await writeJsonConfig(filePath, config);
}

/**
 * Reads Cursor MCP servers from mcp.json user/project scopes.
 */
async function readCursorScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
  if (scope === 'local') {
    throw new AppError('Cursor does not support local MCP scope.', {
      code: 'MCP_SCOPE_NOT_SUPPORTED',
      statusCode: 400,
    });
  }

  const filePath = scope === 'user'
    ? path.join(os.homedir(), '.cursor', 'mcp.json')
    : path.join(workspacePath, '.cursor', 'mcp.json');
  const config = await readJsonConfig(filePath);
  return readObjectRecord(config.mcpServers) ?? {};
}

/**
 * Persists Cursor MCP servers to mcp.json user/project scopes.
 */
async function writeCursorScopedServers(
  scope: McpScope,
  workspacePath: string,
  servers: Record<string, unknown>,
): Promise<void> {
  if (scope === 'local') {
    throw new AppError('Cursor does not support local MCP scope.', {
      code: 'MCP_SCOPE_NOT_SUPPORTED',
      statusCode: 400,
    });
  }

  const filePath = scope === 'user'
    ? path.join(os.homedir(), '.cursor', 'mcp.json')
    : path.join(workspacePath, '.cursor', 'mcp.json');
  const config = await readJsonConfig(filePath);
  config.mcpServers = servers;
  await writeJsonConfig(filePath, config);
}

/**
 * Runs a short stdio process startup probe.
 */
async function runStdioServerProbe(
  server: UnifiedMcpServer,
  workspacePath: string,
): Promise<{ reachable: boolean; error?: string }> {
  if (!server.command) {
    return { reachable: false, error: 'Missing stdio command.' };
  }

  try {
    const child = spawn(server.command, server.args ?? [], {
      cwd: server.cwd ? path.resolve(workspacePath, server.cwd) : workspacePath,
      env: {
        ...process.env,
        ...(server.env ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      if (!child.killed && child.exitCode === null) {
        child.kill('SIGTERM');
      }
    }, 1_500);

    const errorPromise = once(child, 'error').then(([error]) => {
      throw error;
    });
    const closePromise = once(child, 'close');
    await Promise.race([closePromise, errorPromise]);
    clearTimeout(timeout);

    if (typeof child.exitCode === 'number' && child.exitCode !== 0) {
      return {
        reachable: false,
        error: `Process exited with code ${child.exitCode}.`,
      };
    }

    return { reachable: true };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : 'Failed to start stdio process',
    };
  }
}

/**
 * Runs a lightweight HTTP/SSE reachability probe.
 */
async function runHttpServerProbe(url: string): Promise<{ reachable: boolean; statusCode?: number; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timeout);
    return {
      reachable: true,
      statusCode: response.status,
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      reachable: false,
      error: error instanceof Error ? error.message : 'Network probe failed',
    };
  }
}

/**
 * Safely reads a JSON config file and returns an empty object when missing.
 */
async function readJsonConfig(filePath: string): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return readObjectRecord(parsed) ?? {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

/**
 * Writes one JSON config with stable formatting.
 */
async function writeJsonConfig(filePath: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/**
 * Safely reads a TOML config and returns an empty object when missing.
 */
async function readTomlConfig(filePath: string): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = TOML.parse(content) as Record<string, unknown>;
    return readObjectRecord(parsed) ?? {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

/**
 * Writes one TOML config file.
 */
async function writeTomlConfig(filePath: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const toml = TOML.stringify(data as any);
  await writeFile(filePath, toml, 'utf8');
}

/**
 * Reads plain object records.
 */
function readObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Reads optional strings.
 */
function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : undefined;
}

/**
 * Reads optional string arrays.
 */
function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Reads optional string maps.
 */
function readStringRecord(value: unknown): Record<string, string> | undefined {
  const record = readObjectRecord(value);
  if (!record) {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'string') {
      normalized[key] = entry;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}
