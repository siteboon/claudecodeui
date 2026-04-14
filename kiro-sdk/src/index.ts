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
      if (method === 'session/update') {
        const sessionId = params.sessionId as string;
        const update = (params.update || params) as Record<string, unknown>;
        const type = (update.sessionUpdate || update.type || update.kind) as string;
        if (!sessionId || !router.has(sessionId)) {
          console.log('[kiro-sdk] notification for unregistered session:', sessionId?.slice(0,8), 'type:', type);
          return;
        }

      if (type === 'agent_message_chunk') {
        const content = update.content as Record<string, unknown> | undefined;
        const text = (content?.text || '') as string;
        if (text) {
          router.push(sessionId, {
            type: 'assistant',
            content: text,
            session_id: sessionId,
          });
        }
      } else if (type === 'tool_call') {
        router.push(sessionId, {
          type: 'tool_use',
          name: (update.name || update.toolName || 'unknown') as string,
          input: (update.parameters || update.input || {}) as Record<string, unknown>,
          id: (update.id || update.toolUseId || '') as string,
          status: (update.status || 'running') as 'running' | 'completed' | 'error',
          session_id: sessionId,
        });
      } else if (type === 'tool_call_update') {
        const content = update.content as Record<string, unknown> | undefined;
        router.push(sessionId, {
          type: 'tool_progress',
          content: (content?.text || update.text || '') as string,
          tool_id: (update.id || update.toolUseId || '') as string,
          session_id: sessionId,
        });
      } else if (type === 'turn_end') {
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

    // Always create a new session — session/load + session/prompt crashes kiro-cli (v1.29.x bug).
    // The resume option is accepted but not used until the kiro-cli bug is fixed.
    const result = await t.sendRpc('session/new', {
      cwd: options.cwd || process.cwd(),
      mcpServers: options.mcpServers || [],
    }) as AcpSessionResult;
    acpSessionId = result?.sessionId;

    if (!acpSessionId) throw new Error('Failed to create ACP session');

    router.register(acpSessionId);

    try {
      // Note: set_model is intentionally skipped — it crashes kiro-cli with
      // certain model ID formats. Kiro uses 'auto' by default which works well.

      // Send the prompt — response arrives after streaming completes
      const promptResult = await t.sendRpc('session/prompt', {
        sessionId: acpSessionId,
        prompt: [{ type: 'text', text: prompt }],
      }) as Record<string, unknown>;

      // If turn already ended (stopReason in response), finish the session
      if (promptResult?.stopReason) {
        router.finish(acpSessionId);
      }

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
