import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type {
  McpConnectionState,
  McpScope,
  ProviderMcpServer,
  ProviderMcpServerStatus,
  UpsertProviderMcpServerInput,
} from '@/shared/types.js';
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
 * Runs `claude mcp list` from `workspacePath` and resolves with its combined
 * output. Kept behind a function type so tests can exercise the parser against
 * recorded CLI output without spawning anything.
 */
type ClaudeMcpListRunner = (workspacePath: string) => Promise<string>;

/**
 * Constructor seam for `ClaudeMcpProvider`. Used by the providers module's MCP
 * status test, which substitutes recorded `claude mcp list` output so the
 * parser and the status mapping are covered without a real CLI on the box.
 */
export type ClaudeMcpProviderDependencies = {
  runMcpList?: ClaudeMcpListRunner;
};

// `claude mcp list` connects to every configured server before printing, so it
// is bounded here: one unreachable server must not hold an Express request
// open. The CLI's own per-server health check already times out well inside
// this, which is the ceiling for the whole listing.
const CLAUDE_MCP_LIST_TIMEOUT_MS = 20_000;

// The status glyphs `claude mcp list` prints per server: ✔ connected,
// ✘ failed to connect, ⏸ pending approval (an unapproved `.mcp.json` entry the
// CLI deliberately never contacted).
const CONNECTED_MARKER = '\u2714';
const PENDING_MARKER = '\u23f8';
const STATUS_MARKER_PATTERN = /[\u2714\u2718\u23f8]/;

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g;

const readMarkerState = (marker: string): McpConnectionState => {
  if (marker === CONNECTED_MARKER) {
    return 'connected';
  }

  return marker === PENDING_MARKER ? 'pending' : 'failed';
};

/**
 * Turns `claude mcp list` output into per-server statuses.
 *
 * Each server occupies one line shaped `<name>: <target> - <glyph> <text>`;
 * anything else the CLI prints (the "Checking MCP server health" banner, blank
 * lines, future footers) has no glyph and is skipped. The split is anchored on
 * the glyph rather than on the first ` - ` because both the target and the
 * failure text can contain that sequence.
 */
const parseClaudeMcpListOutput = (output: string): ProviderMcpServerStatus[] => {
  const statuses: ProviderMcpServerStatus[] = [];

  for (const rawLine of output.replace(ANSI_ESCAPE_PATTERN, '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const markerIndex = line.search(STATUS_MARKER_PATTERN);
    if (markerIndex === -1) {
      continue;
    }

    const separatorIndex = line.lastIndexOf(' - ', markerIndex);
    if (separatorIndex === -1) {
      continue;
    }

    const nameEndIndex = line.indexOf(':');
    if (nameEndIndex <= 0 || nameEndIndex > separatorIndex) {
      continue;
    }

    const name = line.slice(0, nameEndIndex).trim();
    if (!name) {
      continue;
    }

    const state = readMarkerState(line[markerIndex]);
    const detail = line.slice(markerIndex + 1).trim();
    statuses.push({
      name,
      state,
      // "Connected" carries no information the state does not already give.
      ...(state === 'connected' || !detail ? {} : { detail }),
    });
  }

  return statuses;
};

const runClaudeMcpListWithCli: ClaudeMcpListRunner = (workspacePath) => (
  new Promise<string>((resolve, reject) => {
    // cross-spawn resolves shims and PATHEXT itself, so the bare command stays a
    // usable fallback, exactly as in the Claude auth probe.
    const cliPath = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH) ?? 'claude';
    const child = spawn(cliPath, ['mcp', 'list'], {
      cwd: workspacePath,
      timeout: CLAUDE_MCP_LIST_TIMEOUT_MS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // NO_COLOR keeps the glyph line free of ANSI styling on terminals that
      // would otherwise get it; the parser strips escapes anyway.
      env: { ...process.env, NO_COLOR: '1' },
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      reject(new Error(`Could not run "claude mcp list": ${error.message}`));
    });
    child.on('close', (code, signal) => {
      // The CLI exits 0 even when individual servers fail, so a signal (the
      // timeout kill) or a non-zero exit with no parsable output is the only
      // real failure — and stdout is still the authority when it has lines.
      if (signal) {
        reject(new Error(`"claude mcp list" timed out after ${CLAUDE_MCP_LIST_TIMEOUT_MS}ms.`));
        return;
      }

      if (code !== 0 && !STATUS_MARKER_PATTERN.test(stdout)) {
        reject(new Error(stderr.trim() || `"claude mcp list" exited with code ${code}.`));
        return;
      }

      resolve(stdout);
    });
  })
);

export class ClaudeMcpProvider extends McpProvider {
  private readonly runMcpList: ClaudeMcpListRunner;

  constructor(dependencies: ClaudeMcpProviderDependencies = {}) {
    super('claude', ['user', 'local', 'project'], ['stdio', 'http', 'sse']);
    this.runMcpList = dependencies.runMcpList ?? runClaudeMcpListWithCli;
  }

  /**
   * Asks the Claude CLI to health-check every server it can see from
   * `workspacePath` — user scope plus that workspace's project and local
   * scopes — and returns one status per server name it reported.
   */
  async probeServerStatuses(options?: { workspacePath?: string }): Promise<ProviderMcpServerStatus[]> {
    const workspacePath = path.resolve(options?.workspacePath ?? process.cwd());
    return parseClaudeMcpListOutput(await this.runMcpList(workspacePath));
  }

  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
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

    const projects = readObjectRecord(config.projects) ?? {};
    const projectConfig = readObjectRecord(projects[workspacePath]) ?? {};
    return readObjectRecord(projectConfig.mcpServers) ?? {};
  }

  protected async writeScopedServers(
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

  protected buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown> {
    if (input.transport === 'stdio') {
      if (!input.command?.trim()) {
        throw new AppError('command is required for stdio MCP servers.', {
          code: 'MCP_COMMAND_REQUIRED',
          statusCode: 400,
        });
      }

      return {
        type: 'stdio',
        command: input.command,
        args: input.args ?? [],
        env: input.env ?? {},
      };
    }

    if (!input.url?.trim()) {
      throw new AppError('url is required for http/sse MCP servers.', {
        code: 'MCP_URL_REQUIRED',
        statusCode: 400,
      });
    }

    return {
      type: input.transport,
      url: input.url,
      headers: input.headers ?? {},
    };
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
        provider: 'claude',
        name,
        scope,
        transport: 'stdio',
        command: config.command,
        args: readStringArray(config.args),
        env: readStringRecord(config.env),
      };
    }

    if (typeof config.url === 'string') {
      const transport = readOptionalString(config.type) === 'sse' ? 'sse' : 'http';
      return {
        provider: 'claude',
        name,
        scope,
        transport,
        url: config.url,
        headers: readStringRecord(config.headers),
      };
    }

    return null;
  }
}
