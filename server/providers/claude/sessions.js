/**
 * Claude provider session history.
 *
 * Fetches and normalizes persisted JSONL session data.
 * @module adapters/claude/sessions
 */

import { normalizeMessage } from './adapter.js';
import { getSessionMessages } from '../../projects.js';
import { createNormalizedMessage } from '../types.js';

/**
 * Fetch session history from JSONL files, returning normalized messages.
 * @param {string} sessionId
 * @param {import('../types.js').FetchHistoryOptions} opts
 * @returns {Promise<import('../types.js').FetchHistoryResult>}
 */
export async function fetchHistory(sessionId, opts = {}) {
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
}
