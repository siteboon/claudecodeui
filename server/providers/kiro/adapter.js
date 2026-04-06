/**
 * Kiro provider adapter.
 *
 * Normalizes Kiro CLI session history into NormalizedMessage format.
 * Kiro is AWS's agentic IDE built on Claude (https://kiro.dev).
 *
 * TODO: verify actual Kiro CLI output format once CLI is available.
 * Currently modeled after the Gemini/Codex adapter patterns with stubs
 * for the unknown parts.
 *
 * @module adapters/kiro
 */

import sessionManager from '../../sessionManager.js';
import { getKiroCliSessionMessages } from '../../projects.js';
import { createNormalizedMessage, generateMessageId } from '../types.js';

const PROVIDER = 'kiro';

/**
 * Normalize a realtime NDJSON event from Kiro CLI into NormalizedMessage(s).
 *
 * TODO: verify Kiro CLI output format — event type names and field names
 * are inferred from similarity to Gemini CLI. Update once actual CLI output
 * is confirmed.
 *
 * @param {object} raw - A parsed NDJSON event from Kiro CLI stdout
 * @param {string} sessionId
 * @returns {import('../types.js').NormalizedMessage[]}
 */
export function normalizeMessage(raw, sessionId) {
  const ts = raw.timestamp || new Date().toISOString();
  const baseId = raw.uuid || generateMessageId('kiro');

  // TODO: verify actual Kiro CLI event type values
  // Assuming similar structure to Gemini CLI for now

  if (raw.type === 'message' && raw.role === 'assistant') {
    const content = raw.content || raw.text || '';
    const msgs = [];
    if (content) {
      msgs.push(createNormalizedMessage({ id: baseId, sessionId, timestamp: ts, provider: PROVIDER, kind: 'stream_delta', content }));
    }
    // If not a delta, also send stream_end
    if (raw.delta !== true) {
      msgs.push(createNormalizedMessage({ sessionId, timestamp: ts, provider: PROVIDER, kind: 'stream_end' }));
    }
    return msgs;
  }

  // TODO: verify Kiro CLI tool_use event field names
  if (raw.type === 'tool_use') {
    return [createNormalizedMessage({
      id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
      kind: 'tool_use', toolName: raw.tool_name, toolInput: raw.parameters || raw.input || {},
      toolId: raw.tool_id || baseId,
    })];
  }

  // TODO: verify Kiro CLI tool_result event field names
  if (raw.type === 'tool_result') {
    return [createNormalizedMessage({
      id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
      kind: 'tool_result', toolId: raw.tool_id || '',
      content: raw.output === undefined ? '' : String(raw.output),
      isError: raw.status === 'error',
    })];
  }

  // TODO: verify Kiro CLI result/completion event type name and fields
  if (raw.type === 'result' || raw.type === 'complete') {
    const msgs = [createNormalizedMessage({ sessionId, timestamp: ts, provider: PROVIDER, kind: 'stream_end' })];
    if (raw.stats?.total_tokens) {
      msgs.push(createNormalizedMessage({
        sessionId, timestamp: ts, provider: PROVIDER,
        kind: 'status', text: 'Complete', tokens: raw.stats.total_tokens, canInterrupt: false,
      }));
    }
    return msgs;
  }

  if (raw.type === 'error') {
    return [createNormalizedMessage({
      id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
      kind: 'error', content: raw.error || raw.message || 'Unknown Kiro streaming error',
    })];
  }

  return [];
}

/**
 * @type {import('../types.js').ProviderAdapter}
 */
export const kiroAdapter = {
  normalizeMessage,
  /**
   * Fetch session history for Kiro.
   * First tries in-memory session manager, then falls back to CLI sessions on disk.
   *
   * TODO: verify actual Kiro session storage path once CLI is available.
   */
  async fetchHistory(sessionId, opts = {}) {
    const { limit = null, offset = 0 } = opts;
    let rawMessages;
    try {
      // For Kiro, prefer disk sessions (JSONL files) as they contain the full conversation
      rawMessages = await getKiroCliSessionMessages(sessionId);

      // Fall back to in-memory sessionManager (for live ACP sessions)
      if (rawMessages.length === 0) {
        rawMessages = sessionManager.getSessionMessages(sessionId);
      }
    } catch (error) {
      console.warn(`[KiroAdapter] Failed to load session ${sessionId}:`, error.message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    const normalized = [];
    // Use incrementing synthetic timestamps to preserve file order when real timestamps are absent
    const baseTime = Date.now();
    for (let i = 0; i < rawMessages.length; i++) {
      const raw = rawMessages[i];
      const ts = raw.timestamp || new Date(baseTime + i).toISOString();
      const baseId = raw.uuid || generateMessageId('kiro');

      // sessionManager format: { type: 'message', message: { role, content }, timestamp }
      const role = raw.message?.role || raw.role;
      const content = raw.message?.content || raw.content;

      if (!role || !content) continue;

      const normalizedRole = (role === 'user') ? 'user' : 'assistant';

      if (Array.isArray(content)) {
        for (let partIdx = 0; partIdx < content.length; partIdx++) {
          const part = content[partIdx];
          if (part.type === 'text' && part.text) {
            normalized.push(createNormalizedMessage({
              id: `${baseId}_${partIdx}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'text',
              role: normalizedRole,
              content: part.text,
            }));
          } else if (part.type === 'tool_use') {
            normalized.push(createNormalizedMessage({
              id: `${baseId}_${partIdx}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'tool_use',
              toolName: part.name,
              toolInput: part.input,
              toolId: part.id || generateMessageId('kiro_tool'),
            }));
          } else if (part.type === 'tool_result') {
            normalized.push(createNormalizedMessage({
              id: `${baseId}_${partIdx}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'tool_result',
              toolId: part.tool_use_id || '',
              content: part.content === undefined ? '' : String(part.content),
              isError: Boolean(part.is_error),
            }));
          }
        }
      } else if (typeof content === 'string' && content.trim()) {
        normalized.push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'text',
          role: normalizedRole,
          content,
        }));
      }
    }

    // Attach tool results to tool_use messages
    const toolResultMap = new Map();
    for (const msg of normalized) {
      if (msg.kind === 'tool_result' && msg.toolId) {
        toolResultMap.set(msg.toolId, msg);
      }
    }
    for (const msg of normalized) {
      if (msg.kind === 'tool_use' && msg.toolId && toolResultMap.has(msg.toolId)) {
        const tr = toolResultMap.get(msg.toolId);
        msg.toolResult = { content: tr.content, isError: tr.isError };
      }
    }

    const total = normalized.length;
    const sliced = limit !== null ? normalized.slice(offset, offset + limit) : normalized.slice(offset);

    return {
      messages: sliced,
      total,
      hasMore: limit !== null ? offset + limit < total : false,
      offset,
      limit,
    };
  },
};
