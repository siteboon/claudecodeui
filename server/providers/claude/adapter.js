/**
 * Claude provider adapter.
 *
 * Normalizes Claude SDK session history into NormalizedMessage format.
 * @module adapters/claude
 */

import { getSessionMessages } from '../../projects.js';
import { createNormalizedMessage, generateMessageId } from '../types.js';
import { isInternalContent } from '../utils.js';

const PROVIDER = 'claude';

/**
 * Normalize a raw JSONL message or realtime SDK event into NormalizedMessage(s).
 * Handles both history entries (JSONL `{ message: { role, content } }`) and
 * realtime streaming events (`content_block_delta`, `content_block_stop`, etc.).
 * @param {object} raw - A single entry from JSONL or a live SDK event
 * @param {string} sessionId
 * @returns {import('../types.js').NormalizedMessage[]}
 */
export function normalizeMessage(raw, sessionId) {
  // ── Streaming events (realtime) ──────────────────────────────────────────
  if (raw.type === 'content_block_delta' && raw.delta?.text) {
    return [createNormalizedMessage({ kind: 'stream_delta', content: raw.delta.text, sessionId, provider: PROVIDER })];
  }
  if (raw.type === 'content_block_stop') {
    return [createNormalizedMessage({ kind: 'stream_end', sessionId, provider: PROVIDER })];
  }

  // ── History / full-message events ────────────────────────────────────────
  const messages = [];
  const ts = raw.timestamp || new Date().toISOString();
  const baseId = raw.uuid || generateMessageId('claude');

  // User message
  if (raw.message?.role === 'user' && raw.message?.content) {
    if (Array.isArray(raw.message.content)) {
      // Handle tool_result parts
      for (const part of raw.message.content) {
        if (part.type === 'tool_result') {
          messages.push(createNormalizedMessage({
            id: `${baseId}_tr_${part.tool_use_id}`,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_result',
            toolId: part.tool_use_id,
            content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content),
            isError: Boolean(part.is_error),
            subagentTools: raw.subagentTools,
            toolUseResult: raw.toolUseResult,
          }));
        } else if (part.type === 'text') {
          // Regular text parts from user
          const text = part.text || '';
          if (text && !isInternalContent(text)) {
            messages.push(createNormalizedMessage({
              id: `${baseId}_text`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'text',
              role: 'user',
              content: text,
            }));
          }
        }
      }

      // If no text parts were found, check if it's a pure user message
      if (messages.length === 0) {
        const textParts = raw.message.content
          .filter(p => p.type === 'text')
          .map(p => p.text)
          .filter(Boolean)
          .join('\n');
        if (textParts && !isInternalContent(textParts)) {
          messages.push(createNormalizedMessage({
            id: `${baseId}_text`,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'text',
            role: 'user',
            content: textParts,
          }));
        }
      }
    } else if (typeof raw.message.content === 'string') {
      const text = raw.message.content;
      if (text && !isInternalContent(text)) {
        messages.push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'text',
          role: 'user',
          content: text,
        }));
      }
    }
    return messages;
  }

  // Thinking message
  if (raw.type === 'thinking' && raw.message?.content) {
    messages.push(createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'thinking',
      content: raw.message.content,
    }));
    return messages;
  }

  // Tool use result (codex-style in Claude)
  if (raw.type === 'tool_use' && raw.toolName) {
    messages.push(createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'tool_use',
      toolName: raw.toolName,
      toolInput: raw.toolInput,
      toolId: raw.toolCallId || baseId,
    }));
    return messages;
  }

  if (raw.type === 'tool_result') {
    messages.push(createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'tool_result',
      toolId: raw.toolCallId || '',
      content: raw.output || '',
      isError: false,
    }));
    return messages;
  }

  // Assistant message
  if (raw.message?.role === 'assistant' && raw.message?.content) {
    if (Array.isArray(raw.message.content)) {
      let partIndex = 0;
      for (const part of raw.message.content) {
        if (part.type === 'text' && part.text) {
          messages.push(createNormalizedMessage({
            id: `${baseId}_${partIndex}`,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'text',
            role: 'assistant',
            content: part.text,
          }));
        } else if (part.type === 'tool_use') {
          messages.push(createNormalizedMessage({
            id: `${baseId}_${partIndex}`,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: part.name,
            toolInput: part.input,
            toolId: part.id,
          }));
        } else if (part.type === 'thinking' && part.thinking) {
          messages.push(createNormalizedMessage({
            id: `${baseId}_${partIndex}`,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'thinking',
            content: part.thinking,
          }));
        }
        partIndex++;
      }
    } else if (typeof raw.message.content === 'string') {
      messages.push(createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'text',
        role: 'assistant',
        content: raw.message.content,
      }));
    }
    return messages;
  }

  return messages;
}

/**
 * @type {import('../types.js').ProviderAdapter}
 */
export const claudeAdapter = {
  normalizeMessage,

  /**
   * Fetch session history from JSONL files, returning normalized messages.
   */
  async fetchHistory(sessionId, opts = {}) {
    const { projectName, limit = null, offset = 0 } = opts;
    if (!projectName) {
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    let result;
    try {
      result = await getSessionMessages(projectName, sessionId, limit, offset);
    } catch (error) {
      console.warn(`[ClaudeAdapter] Failed to load session ${sessionId}:`, error.message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    // getSessionMessages returns either an array (no limit) or { messages, total, hasMore }
    const rawMessages = Array.isArray(result) ? result : (result.messages || []);
    const total = Array.isArray(result) ? rawMessages.length : (result.total || 0);
    const hasMore = Array.isArray(result) ? false : Boolean(result.hasMore);

    // First pass: collect tool results for attachment to tool_use messages
    const toolResultMap = new Map();
    for (const raw of rawMessages) {
      if (raw.message?.role === 'user' && Array.isArray(raw.message?.content)) {
        for (const part of raw.message.content) {
          if (part.type === 'tool_result') {
            toolResultMap.set(part.tool_use_id, {
              content: part.content,
              isError: Boolean(part.is_error),
              timestamp: raw.timestamp,
              subagentTools: raw.subagentTools,
              toolUseResult: raw.toolUseResult,
            });
          }
        }
      }
    }

    // Second pass: normalize all messages
    const normalized = [];
    for (const raw of rawMessages) {
      const entries = normalizeMessage(raw, sessionId);
      normalized.push(...entries);
    }

    // Attach tool results to their corresponding tool_use messages
    for (const msg of normalized) {
      if (msg.kind === 'tool_use' && msg.toolId && toolResultMap.has(msg.toolId)) {
        const tr = toolResultMap.get(msg.toolId);
        msg.toolResult = {
          content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
          isError: tr.isError,
          toolUseResult: tr.toolUseResult,
        };
        msg.subagentTools = tr.subagentTools;
      }
    }

    return {
      messages: normalized,
      total,
      hasMore,
      offset,
      limit,
    };
  },
};
