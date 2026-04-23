/**
 * Claude Permission MCP Bridge
 *
 * Exposes a localhost HTTP MCP server that the Claude CLI calls via
 * --permission-prompt-tool for runtime tool approval. Each stream session
 * registers a unique URL token; the CLI reaches that session's approval
 * callback through the URL path and the MCP tool bridges directly into the
 * shared waitForToolApproval/pendingToolApprovals flow from claude-sdk.js.
 *
 * Lifecycle: HTTP server is lazy-started on first registerSession(), lives
 * until the node process exits. Each registerSession() returns a dispose()
 * that tears down that session's McpServer instance.
 *
 * Tool contract (verified against claude CLI 2.1.118):
 *   input  : { tool_name: string, input: object, tool_use_id?: string }
 *   output : text content containing JSON
 *            { behavior: 'allow', updatedInput: object }  or
 *            { behavior: 'deny',  message: string }
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
// MCP SDK schema introspection follows the zod/v3 path; classic zod v4 trips
// an internal `_zod` lookup in zod-compat → use v3 explicitly.
import { z } from 'zod/v3';
import { createNormalizedMessage } from './shared/utils.js';
import {
  createRequestId,
  waitForToolApproval,
  matchesToolPermission,
  TOOLS_REQUIRING_INTERACTION,
  pendingToolApprovals
} from './claude-sdk.js';

const TOOL_NAME = 'permission_prompt';
const SERVER_NAME = 'cloudcli_approval';
const FULL_TOOL_NAME = `mcp__${SERVER_NAME}__${TOOL_NAME}`;

/** @type {http.Server|null} */
let httpServer = null;
let httpServerPort = 0;
/** @type {Promise<void>|null} */
let httpServerReady = null;

/**
 * @typedef {Object} SessionRegistration
 * @property {string} token            URL path segment identifying the session
 * @property {string} sessionId        CLI session ID (may be null until system/init)
 * @property {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcp
 * @property {StreamableHTTPServerTransport} transport
 * @property {(toolName: string, input: object, toolUseId: string|undefined, signal: AbortSignal) => Promise<{behavior:'allow', updatedInput: object}|{behavior:'deny', message: string}>} onApproval
 * @property {Set<string>} pendingRequestIds  Request IDs currently awaiting approval
 */

/** @type {Map<string, SessionRegistration>} */
const registrations = new Map();

/**
 * Start the singleton HTTP server on a random localhost port. Idempotent.
 * @returns {Promise<void>}
 */
function ensureHttpServer() {
  if (httpServerReady) return httpServerReady;
  httpServerReady = new Promise((resolve, reject) => {
    httpServer = http.createServer((req, res) => {
      // Path format: /claude-permission-mcp/<token>  — reject anything else.
      const url = req.url || '';
      const match = url.match(/^\/claude-permission-mcp\/([a-f0-9]{32})(?:$|[/?])/);
      if (!match) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      const reg = registrations.get(match[1]);
      if (!reg) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('session not registered');
        return;
      }
      // Force listener binding — MCP transport strips the path, treats the
      // request as though it landed at `/` on its own transport. Safe because
      // we've already routed by token.
      reg.transport.handleRequest(req, res).catch((err) => {
        console.error('[claude-permission-mcp] transport error:', err);
        if (!res.headersSent) {
          res.writeHead(500).end();
        }
      });
    });
    httpServer.on('error', (err) => {
      console.error('[claude-permission-mcp] http server error:', err);
      reject(err);
    });
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      httpServerPort = typeof addr === 'object' && addr ? addr.port : 0;
      console.log(`[claude-permission-mcp] listening on 127.0.0.1:${httpServerPort}`);
      resolve();
    });
  });
  return httpServerReady;
}

/**
 * Register a new per-session MCP server. Returns a dispose() that tears it
 * down when the stream session ends.
 *
 * @param {Object} opts
 * @param {string|null} opts.sessionId      CLI session ID (may be null until system/init)
 * @param {(toolName: string, input: object, toolUseId: string|undefined, signal: AbortSignal) => Promise<{behavior:'allow', updatedInput: object}|{behavior:'deny', message: string}>} opts.onApproval
 * @returns {Promise<{ url: string, toolName: string, mcpServerName: string, dispose: () => Promise<void>, rekey: (newSessionId: string) => void, cancelPendingApprovals: (reason?: string) => void }>}
 */
async function registerSession({ sessionId, onApproval }) {
  await ensureHttpServer();

  const token = crypto.randomBytes(16).toString('hex');

  const mcp = new McpServer(
    { name: SERVER_NAME, version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  const registration = {
    token,
    sessionId: sessionId || null,
    mcp,
    transport: null, // set below
    onApproval,
    pendingRequestIds: new Set(),
  };

  mcp.registerTool(
    TOOL_NAME,
    {
      description: 'Approve or deny a Claude tool invocation at runtime',
      inputSchema: {
        tool_name: z.string(),
        input: z.record(z.any()).optional(),
        tool_use_id: z.string().optional(),
      },
    },
    async (args, extra) => {
      const toolName = args?.tool_name || 'UnknownTool';
      const input = args?.input ?? {};
      const toolUseId = args?.tool_use_id;
      const signal = extra?.signal ?? new AbortController().signal;

      let decision;
      try {
        decision = await onApproval(toolName, input, toolUseId, signal);
      } catch (err) {
        console.error('[claude-permission-mcp] onApproval threw:', err);
        decision = { behavior: 'deny', message: 'Internal approval error' };
      }

      // Must be text content — the CLI parses content[0].text as JSON.
      return {
        content: [{ type: 'text', text: JSON.stringify(decision) }],
      };
    }
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    // DNS-rebinding defense: a page loaded in the user's browser could resolve
    // a hostile domain to 127.0.0.1:<port> and (absent Host validation) have
    // the MCP transport honor requests with an arbitrary Host header. The URL
    // token alone isn't enough here — the attacker can read `location.href`
    // from their own page to learn it. Pinning the allowlist to loopback +
    // the bound port closes the vector.
    allowedHosts: [`127.0.0.1:${httpServerPort}`, `localhost:${httpServerPort}`],
    enableDnsRebindingProtection: true,
  });
  await mcp.connect(transport);

  registration.transport = transport;
  registrations.set(token, registration);

  const url = `http://127.0.0.1:${httpServerPort}/claude-permission-mcp/${token}`;

  const dispose = async () => {
    registrations.delete(token);
    try {
      await mcp.close();
    } catch (err) {
      console.error('[claude-permission-mcp] mcp.close failed:', err);
    }
  };

  /**
   * Update sessionId after system/init arrives. Mostly informational; routing
   * still works off the token.
   */
  const rekey = (newSessionId) => {
    registration.sessionId = newSessionId;
  };

  /**
   * Force-deny every in-flight approval for this session. Called on abort so
   * the CLI can unblock quickly — SIGINT alone doesn't cancel the in-flight
   * HTTP tool call.
   */
  const cancelPendingApprovals = (reason = 'Session aborted') => {
    for (const requestId of Array.from(registration.pendingRequestIds)) {
      const resolver = pendingToolApprovals.get(requestId);
      if (resolver) {
        resolver({ behavior: 'deny', message: reason, cancelled: true });
      }
    }
    registration.pendingRequestIds.clear();
  };

  return {
    url,
    toolName: FULL_TOOL_NAME,
    mcpServerName: SERVER_NAME,
    dispose,
    rekey,
    cancelPendingApprovals,
    registration, // exposed for internal bookkeeping in onApproval bridge
  };
}

/**
 * Build the onApproval callback a stream session uses. Emits the UI
 * permission_request, honors pre-approved/denied tool rules, and awaits the
 * shared pendingToolApprovals resolver.
 *
 * @param {Object} ctx
 * @param {() => Object|null} ctx.getWriter  Latest WebSocketWriter. Callable
 *   because session.writer is reassigned on session reuse; capturing at
 *   construction time would point the bridge at a dead writer after refresh.
 * @param {() => string|null} ctx.getSessionId  Latest CLI session ID (may be null pre-init)
 * @param {() => { allowedTools: string[], disallowedTools: string[] }} ctx.getToolsSettings
 *   Callback returning the current tools settings (callable because stream
 *   sessions can update this between prompts).
 * @param {() => { registration: any }} ctx.getRegistration
 *   Lazy so the registration can be attached after the callback is built.
 * @returns {(toolName: string, input: object, toolUseId: string|undefined, signal: AbortSignal) => Promise<{behavior:'allow', updatedInput: object}|{behavior:'deny', message: string}>}
 */
function buildApprovalBridge({ getWriter, getSessionId, getToolsSettings, getRegistration }) {
  return async (toolName, input, _toolUseId, signal) => {
    const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);
    const settings = getToolsSettings() || { allowedTools: [], disallowedTools: [] };

    // Pre-check against stored rules (mirrors claude-sdk canUseTool logic).
    // In practice the CLI already honors its own --allowed-tools / --disallowed-
    // tools flags before calling us, so this only matters for tools the CLI
    // didn't auto-approve (e.g. rules added mid-session). Interactive tools
    // always prompt so the user sees the question.
    if (!requiresInteraction) {
      const isDisallowed = (settings.disallowedTools || []).some(entry =>
        matchesToolPermission(entry, toolName, input)
      );
      if (isDisallowed) {
        return { behavior: 'deny', message: 'Tool disallowed by settings' };
      }
      const isAllowed = (settings.allowedTools || []).some(entry =>
        matchesToolPermission(entry, toolName, input)
      );
      if (isAllowed) {
        return { behavior: 'allow', updatedInput: input };
      }
    }

    const requestId = createRequestId();
    const sessionId = getSessionId();
    const reg = getRegistration()?.registration;
    reg?.pendingRequestIds?.add(requestId);

    getWriter()?.send?.(createNormalizedMessage({
      kind: 'permission_request',
      requestId,
      toolName,
      input,
      sessionId: sessionId || null,
      provider: 'claude',
    }));

    try {
      const decision = await waitForToolApproval(requestId, {
        timeoutMs: requiresInteraction ? 0 : undefined,
        signal,
        metadata: {
          _sessionId: sessionId || null,
          _toolName: toolName,
          _input: input,
          _receivedAt: new Date(),
        },
        onCancel: (reason) => {
          getWriter()?.send?.(createNormalizedMessage({
            kind: 'permission_cancelled',
            requestId,
            reason,
            sessionId: sessionId || null,
            provider: 'claude',
          }));
        },
      });

      if (!decision) {
        return { behavior: 'deny', message: 'Permission request timed out' };
      }
      if (decision.cancelled) {
        return { behavior: 'deny', message: decision.message || 'Permission request cancelled' };
      }
      if (decision.allow) {
        return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
      }
      return { behavior: 'deny', message: decision.message ?? 'User denied tool use' };
    } finally {
      reg?.pendingRequestIds?.delete(requestId);
    }
  };
}

export {
  registerSession,
  buildApprovalBridge,
  FULL_TOOL_NAME,
  SERVER_NAME as PERMISSION_MCP_SERVER_NAME,
};
