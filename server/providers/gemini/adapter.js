/**
 * Gemini provider adapter.
 *
 * Normalizes Gemini CLI session history into NormalizedMessage format.
 * @module adapters/gemini
 */

import sessionManager from '../../sessionManager.js';
import { getGeminiCliSessionMessages } from '../../projects.js';
import { createNormalizedMessage, generateMessageId } from '../types.js';

const PROVIDER = 'gemini';

/**
 * Normalize a realtime NDJSON event from Gemini CLI into NormalizedMessage(s).
 * Handles: message (delta/final), tool_use, tool_result, result, error.
 * @param {object} raw - A parsed NDJSON event
 * @param {string} sessionId
 * @returns {import('../types.js').NormalizedMessage[]}
 */
export function normalizeMessage(raw, sessionId) {
  const ts = raw.timestamp || new Date().toISOString();
  const baseId = raw.uuid || generateMessageId('gemini');

  if (raw.type === 'message' && raw.role === 'assistant') {
    const content = raw.content || '';
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

  if (raw.type === 'tool_use') {
    return [createNormalizedMessage({
      id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
      kind: 'tool_use', toolName: raw.tool_name, toolInput: raw.parameters || {},
      toolId: raw.tool_id || baseId,
    })];
  }

  if (raw.type === 'tool_result') {
    return [createNormalizedMessage({
      id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
      kind: 'tool_result', toolId: raw.tool_id || '',
      content: raw.output === undefined ? '' : String(raw.output),
      isError: raw.status === 'error',
    })];
  }

  if (raw.type === 'result') {
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
      kind: 'error', content: raw.error || raw.message || 'Unknown Gemini streaming error',
    })];
  }

  return [];
}

/**
 * @type {import('../types.js').ProviderAdapter}
 */
export const geminiAdapter = {
  normalizeMessage,
  /**
   * Fetch session history for Gemini.
   * First tries in-memory session manager, then falls back to CLI sessions on disk.
   */
  async fetchHistory(sessionId, opts = {}) {
    let rawMessages;
    try {
      rawMessages = sessionManager.getSessionMessages(sessionId);

      // Fallback to Gemini CLI sessions on disk
      if (rawMessages.length === 0) {
        rawMessages = await getGeminiCliSessionMessages(sessionId);
      }
    } catch (error) {
      console.warn(`[GeminiAdapter] Failed to load session ${sessionId}:`, error.message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    const normalized = [];
    for (let i = 0; i < rawMessages.length; i++) {
      const raw = rawMessages[i];
      const ts = raw.timestamp || new Date().toISOString();
      const baseId = raw.uuid || generateMessageId('gemini');

      // sessionManager format: { type: 'message', message: { role, content }, timestamp }
      // CLI format: { role: 'user'|'gemini'|'assistant', content: string|array }
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
              toolId: part.id || generateMessageId('gemini_tool'),
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

    return {
      messages: normalized,
      total: normalized.length,
      hasMore: false,
      offset: 0,
      limit: null,
    };
  },
};
