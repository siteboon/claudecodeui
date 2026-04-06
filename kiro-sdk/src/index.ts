/**
 * kiro-sdk — public API
 *
 * Usage:
 *   import { query } from 'kiro-sdk';
 *   for await (const msg of query({ prompt: 'Hello', options: { cwd: '.' } })) { ... }
 */

import { AcpTransport } from './acp-transport.js';
import { SessionRouter } from './session.js';
import type { Options, Query, KiroMessage, AcpSessionResult } from './types.js';

// Singleton transport — one kiro-cli acp process for all queries
let transport: AcpTransport | null = null;
const router = new SessionRouter();

function getTransport(): AcpTransport {
  if (!transport) {
    transport = new AcpTransport();
    transport.setNotificationHandler((method, params) => {
      if (method !== 'session/notification') return;

      const sessionId = params.sessionId as string;
      if (!sessionId || !router.has(sessionId)) return;

      const update = (params.update || params) as Record<string, unknown>;
      const type = (update.type || update.kind) as string;

      if (type === 'AgentMessageChunk') {
        router.push(sessionId, {
          type: 'assistant',
          content: (update.text || update.content || '') as string,
          session_id: sessionId,
        });
      } else if (type === 'ToolCall') {
        router.push(sessionId, {
          type: 'tool_use',
          name: (update.name || update.toolName || 'unknown') as string,
          input: (update.parameters || update.input || {}) as Record<string, unknown>,
          id: (update.id || update.toolUseId || '') as string,
          status: (update.status || 'running') as 'running' | 'completed' | 'error',
          session_id: sessionId,
        });
      } else if (type === 'ToolCallUpdate') {
        router.push(sessionId, {
          type: 'tool_progress',
          content: (update.text || update.content || '') as string,
          tool_id: (update.id || update.toolUseId || '') as string,
          session_id: sessionId,
        });
      } else if (type === 'TurnEnd') {
        router.finish(sessionId);
      }
    });
  }
  return transport;
}

/**
 * Send a prompt to Kiro and stream back typed messages.
 *
 * Mirrors the `query()` function from @anthropic-ai/claude-agent-sdk.
 * Returns an AsyncGenerator<KiroMessage> with additional control methods.
 */
export function query(params: { prompt: string; options?: Options }): Query {
  const { prompt, options = {} } = params;
  let acpSessionId: string | null = null;

  const generator = (async function* (): AsyncGenerator<KiroMessage, void, undefined> {
    const t = getTransport();
    await t.connect(buildAcpArgs(options));

    // Set model if specified
    if (options.model && options.model !== 'auto') {
      try { await t.sendRpc('session/set_model', { model: options.model }); } catch { /* ignore */ }
    }

    // Create or load session
    if (options.resume) {
      const result = await t.sendRpc('session/load', { sessionId: options.resume }) as AcpSessionResult;
      acpSessionId = result?.sessionId || options.resume;
    } else {
      const result = await t.sendRpc('session/new', {
        cwd: options.cwd || process.cwd(),
        mcpServers: options.mcpServers || [],
      }) as AcpSessionResult;
      acpSessionId = result?.sessionId;
    }

    if (!acpSessionId) throw new Error('Failed to create ACP session');

    router.register(acpSessionId);

    try {
      // Send the prompt
      await t.sendRpc('session/prompt', {
        sessionId: acpSessionId,
        content: [{ type: 'text', text: prompt }],
      });

      // Yield messages until TurnEnd
      yield* router.iterate(acpSessionId);
    } finally {
      router.unregister(acpSessionId);
    }
  })();

  // Attach control methods to match Claude SDK's Query interface
  const query = generator as Query;

  Object.defineProperty(query, 'sessionId', {
    get: () => acpSessionId,
  });

  query.interrupt = async () => {
    if (acpSessionId) {
      const t = getTransport();
      await t.sendRpc('session/cancel', { sessionId: acpSessionId }).catch(() => {});
      router.finish(acpSessionId, false);
    }
  };

  query.setModel = async (model: string) => {
    const t = getTransport();
    await t.sendRpc('session/set_model', { model });
  };

  return query;
}

/** Disconnect the ACP process. Call on shutdown. */
export function disconnect(): void {
  transport?.disconnect();
  transport = null;
}

function buildAcpArgs(options: Options): string[] {
  const args: string[] = [];
  if (options.trustAllTools) args.push('--trust-all-tools');
  if (options.trustTools?.length) args.push('--trust-tools', options.trustTools.join(','));
  if (options.agent) args.push('--agent', options.agent);
  return args;
}

// Re-export types
export type { Options, Query, KiroMessage, KiroAssistantMessage, KiroToolUseMessage, KiroToolProgressMessage, KiroResultMessage } from './types.js';
