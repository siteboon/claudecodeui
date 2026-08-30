import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';

/**
 * A held connection to "Claude in Chrome", the MCP server Claude Code brings
 * along (`claude --claude-in-chrome-mcp`, over stdio).
 *
 * It drives the Chrome the user already has open, through the Claude
 * extension - not a browser of its own.
 *
 * This is the VS Code extension's own arrangement, down to the pieces. From
 * its `extension.js`:
 *
 *   this.transport = new So({command:Q, args:J, env:{...$.env, USER_TYPE:"external"}});
 *   this.client = new To({name:"claude-vscode-chrome-mcp-client", version:"2.1.251"},
 *                        {capabilities:{}});
 *   await this.client.connect(this.transport);
 *   …
 *   let Q = await this.client.callTool({name:"tabs_context_mcp", arguments:{createIfEmpty:!0}});
 *
 * `So` and `To` are `StdioClientTransport` and `Client` from
 * `@modelcontextprotocol/sdk` - the same two classes used here, rather than a
 * hand-rolled JSON-RPC loop.
 *
 * Holding the client is what makes it quick, and it is why the extension keeps
 * it in a field (`this.chromeMcpClient`) instead of connecting per call.
 * Measured through this module:
 *
 *   first call   ~2.1 s   (spawn + initialize + the tool call)
 *   after that   ~0.4 s
 */

export type ToolResult = {
  content?: { type?: string; text?: string }[];
  isError?: boolean;
};

/** Idle connections are dropped so no `claude` process lingers for hours. */
const IDLE_TIMEOUT_MS = 5 * 60_000;

/** A call that hangs takes the connection with it rather than wedging the button. */
const CALL_TIMEOUT_MS = 45_000;

/**
 * The Chrome extension asks the user before acting on a page, and a request
 * nobody answers is not a quick failure: it sits for ~30 s and then comes back
 * as "Permission denied by user". Opening a tab is not gated that way, but
 * navigating to an address is, which made an address take half a minute to be
 * refused.
 *
 * Claude Code itself turns that off when the agent runs unattended. From its
 * bundle, deciding what to send the extension per tool call:
 *
 *   let T = c ? {permissionMode:"skip_all_permission_checks", sessionScope:p}
 *             : {permissionMode:"follow_a_plan", allowedDomains:R, …}
 *
 * where `c` is `kx(a,d)==="bypassPermissions"`. It carries the same value in an
 * environment variable, which the extension reads on the bridge path:
 *
 *   function RL(e,t){ if(!e||"ask"===e) return;
 *                     const r="skip_all_permission_checks"===e;
 *                     return new tL(()=>r, …); }
 *
 * `tL(()=>true)` approves everything. Measured, same call either way:
 *
 *   without   30,726 ms   "Permission denied by user"
 *   with         314 ms   "Navigated to https://example.com"
 *
 * `CLOUDCLI_CHROME_ASK=1` puts the prompts back for anyone who wants them.
 */
function permissionEnv(): Record<string, string> {
  const flag = (process.env.CLOUDCLI_CHROME_ASK ?? '').trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(flag)) {
    return {};
  }

  return { CLAUDE_CHROME_PERMISSION_MODE: 'skip_all_permission_checks' };
}

export class ChromeMcpClient {
  private client: Client | null = null;

  private transport: StdioClientTransport | null = null;

  private connecting: Promise<void> | null = null;

  private idleTimer: NodeJS.Timeout | null = null;

  isConnected(): boolean {
    return this.client !== null;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    await this.connect();

    const client = this.client;
    if (!client) {
      throw new Error('Chrome connection is not open.');
    }

    try {
      const result = await client.callTool({ name, arguments: args }, undefined, {
        timeout: CALL_TIMEOUT_MS,
      });
      this.touch();
      return result as ToolResult;
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    this.connecting = null;

    try {
      await client?.close();
    } catch {
      // Already gone; the transport is closed below either way.
    }
    try {
      await transport?.close();
    } catch {
      // Nothing left to close.
    }
  }

  private async connect(): Promise<void> {
    if (this.client) {
      return;
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.open().finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  private async open(): Promise<void> {
    // The same binary the agent runs on, so a configured CLAUDE_CLI_PATH and
    // the Windows wrapper resolution apply here too.
    const command = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);

    const transport = new StdioClientTransport({
      command,
      args: ['--claude-in-chrome-mcp'],
      env: {
        ...process.env,
        // USER_TYPE is what the extension passes as well; without it the server
        // treats the caller as an internal one.
        USER_TYPE: 'external',
        ...permissionEnv(),
      } as Record<string, string>,
      stderr: 'ignore',
    });

    const client = new Client(
      { name: 'cloudcli-chrome-mcp-client', version: '1.0' },
      { capabilities: {} },
    );

    try {
      await client.connect(transport);
    } catch (error) {
      await transport.close().catch(() => {});
      throw error;
    }

    this.transport = transport;
    this.client = client;

    transport.onclose = () => {
      if (this.transport === transport) {
        void this.disconnect();
      }
    };

    this.touch();
  }

  private touch(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => void this.disconnect(), IDLE_TIMEOUT_MS);
    this.idleTimer.unref?.();
  }
}

/** One connection for the whole server, the way the extension keeps one field. */
export const chromeMcpClient = new ChromeMcpClient();
