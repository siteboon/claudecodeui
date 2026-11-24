import crossSpawn from 'cross-spawn';

import { resolveAgyBinary } from '@/modules/providers/list/antigravity/antigravity-runtime.provider.js';
import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type {
  McpScope,
  McpTransport,
  ProviderMcpServer,
  UpsertProviderMcpServerInput,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const PROVIDER = 'antigravity';
const CLI_TIMEOUT_MS = 20_000;

const SUPPORTED_SCOPES: McpScope[] = ['user'];
const SUPPORTED_TRANSPORTS: McpTransport[] = ['stdio', 'http'];

/**
 * MCP adapter for Antigravity.
 *
 * agy owns its MCP configuration through `agy mcp add|remove|list|enable|disable`
 * and does not document a file this app could edit safely, so every operation
 * goes through that CLI. `list` prints a fixed-width table:
 *
 *   NAME        TYPE   STATUS   COMMAND/URL
 *   probe-test  stdio  enabled  npx -y @modelcontextprotocol/server-everything
 *
 * The base class drives writes as "read the whole map, mutate, write it back",
 * so `writeScopedServers` diffs the desired map against the CLI's current one
 * and issues the minimum set of add/remove calls.
 */
export class AntigravityMcpProvider extends McpProvider {
  constructor() {
    super(PROVIDER, SUPPORTED_SCOPES, SUPPORTED_TRANSPORTS);
  }

  private runAgy(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      let settled = false;
      let child: ReturnType<typeof crossSpawn> | undefined;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          child?.kill();
          resolve({ code: null, stdout: '', stderr: 'agy command timed out' });
        }
      }, CLI_TIMEOUT_MS);

      try {
        child = crossSpawn(resolveAgyBinary(), args, { windowsHide: true });
      } catch (error) {
        clearTimeout(timeout);
        resolve({ code: null, stdout: '', stderr: (error as Error).message });
        return;
      }

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve({ code: null, stdout, stderr: error.message });
      });
      child.on('close', (code: number | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve({ code, stdout, stderr });
      });
    });
  }

  private async readCliServers(): Promise<Record<string, ProviderMcpServer>> {
    const { code, stdout } = await this.runAgy(['mcp', 'list']);
    const servers: Record<string, ProviderMcpServer> = {};
    if (code !== 0 || !stdout.trim() || /No MCP servers configured/i.test(stdout)) {
      return servers;
    }

    const lines = stdout.split(/\r?\n/).filter((line) => line.trim());
    for (const line of lines) {
      const columns = line.trim().split(/\s{2,}/);
      // The header row, and any row the CLI lays out differently, is skipped
      // rather than guessed at.
      if (columns.length < 4 || /^NAME$/i.test(columns[0])) {
        continue;
      }
      const [name, type, status, ...rest] = columns;
      const target = rest.join('  ').trim();
      const transport: McpTransport = type.toLowerCase() === 'http' ? 'http' : 'stdio';
      servers[name] = {
        provider: PROVIDER,
        name,
        scope: 'user',
        transport,
        ...(transport === 'http'
          ? { url: target }
          : { command: target.split(/\s+/)[0], args: target.split(/\s+/).slice(1) }),
        ...(status.toLowerCase() === 'enabled' ? {} : {}),
      };
    }
    return servers;
  }

  protected async readScopedServers(
    scope: McpScope,
    _workspacePath: string,
  ): Promise<Record<string, unknown>> {
    this.assertScope(scope);
    return this.readCliServers() as unknown as Record<string, unknown>;
  }

  protected async writeScopedServers(
    scope: McpScope,
    _workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    this.assertScope(scope);
    const current = await this.readCliServers();
    const desiredNames = new Set(Object.keys(servers));

    for (const name of Object.keys(current)) {
      if (!desiredNames.has(name)) {
        const { code, stderr } = await this.runAgy(['mcp', 'remove', name]);
        if (code !== 0) {
          throw new AppError(`Failed to remove MCP server "${name}": ${stderr.trim()}`, {
            code: 'ANTIGRAVITY_MCP_REMOVE_FAILED',
            statusCode: 502,
          });
        }
      }
    }

    for (const [name, rawConfig] of Object.entries(servers)) {
      const config = this.buildServerConfig(rawConfig as UpsertProviderMcpServerInput);
      const transport = String(config.transport) === 'http' ? 'http' : 'stdio';
      const target = transport === 'http'
        ? String(config.url ?? '')
        : String(config.command ?? '');
      if (!target) {
        continue;
      }
      const args = ['mcp', 'add', '--type', transport];
      for (const [key, value] of Object.entries((config.env ?? {}) as Record<string, string>)) {
        args.push('--env', `${key}=${value}`);
      }
      for (const [key, value] of Object.entries((config.headers ?? {}) as Record<string, string>)) {
        args.push('--header', `${key}: ${value}`);
      }
      args.push(name, target);
      if (transport === 'stdio' && Array.isArray(config.args)) {
        args.push('--', ...(config.args as string[]));
      }

      const { code, stderr } = await this.runAgy(args);
      if (code !== 0) {
        throw new AppError(`Failed to add MCP server "${name}": ${stderr.trim()}`, {
          code: 'ANTIGRAVITY_MCP_ADD_FAILED',
          statusCode: 502,
        });
      }
    }
  }

  protected buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown> {
    return {
      transport: input.transport,
      command: input.command,
      args: input.args,
      env: input.env,
      url: input.url,
      headers: input.headers,
    };
  }

  protected normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null {
    const config = rawConfig as Record<string, unknown> | null;
    if (!config || typeof config !== 'object') {
      return null;
    }
    const transport: McpTransport = config.transport === 'http' ? 'http' : 'stdio';
    return {
      provider: PROVIDER,
      name,
      scope,
      transport,
      command: typeof config.command === 'string' ? config.command : undefined,
      args: Array.isArray(config.args) ? (config.args as string[]) : undefined,
      url: typeof config.url === 'string' ? config.url : undefined,
      env: (config.env as Record<string, string>) ?? undefined,
      headers: (config.headers as Record<string, string>) ?? undefined,
    };
  }
}
