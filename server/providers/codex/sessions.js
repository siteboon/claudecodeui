/**
 * Codex session history fetcher.
 *
 * Extracted from adapter.js — pure data-access concern.
 * @module providers/codex/sessions
 */

import { normalizeCodexHistoryEntry } from './adapter.js';
import { getCodexSessionMessages } from '../../projects.js';

/**
 * Fetch session history from Codex JSONL files.
 * @param {string} sessionId
 * @param {object} opts
 * @param {number|null} [opts.limit]
 * @param {number} [opts.offset]
 * @returns {Promise<{messages: import('../../providers/types.js').NormalizedMessage[], total: number, hasMore: boolean, offset: number, limit: number|null, tokenUsage: object|null}>}
 */
export async function fetchHistory(sessionId, opts = {}) {
  const { limit = null, offset = 0 } = opts;

  let result;
  try {
    result = await getCodexSessionMessages(sessionId, limit, offset);
  } catch (error) {
    console.warn(`[CodexAdapter] Failed to load session ${sessionId}:`, error.message);
    return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
  }

  const rawMessages = Array.isArray(result) ? result : (result.messages || []);
  const total = Array.isArray(result) ? rawMessages.length : (result.total || 0);
  const hasMore = Array.isArray(result) ? false : Boolean(result.hasMore);
  const tokenUsage = result.tokenUsage || null;

  const normalized = [];
  for (const raw of rawMessages) {
    const entries = normalizeCodexHistoryEntry(raw, sessionId);
    normalized.push(...entries);
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
    total,
    hasMore,
    offset,
    limit,
    tokenUsage,
  };
}
