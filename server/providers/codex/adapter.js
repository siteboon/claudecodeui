/**
 * Codex (OpenAI) provider adapter.
 *
 * Normalizes Codex SDK session history into NormalizedMessage format.
 * @module adapters/codex
 */

import { getCodexSessionMessages } from '../../projects.js';
import { createNormalizedMessage, generateMessageId } from '../types.js';

const PROVIDER = 'codex';

/**
 * Normalize a raw Codex JSONL message into NormalizedMessage(s).
 * @param {object} raw - A single parsed message from Codex JSONL
 * @param {string} sessionId
 * @returns {import('../types.js').NormalizedMessage[]}
 */
function normalizeCodexHistoryEntry(raw, sessionId) {
  const ts = raw.timestamp || new Date().toISOString();
  const baseId = raw.uuid || generateMessageId('codex');

  // User message
  if (raw.message?.role === 'user') {
    const content = typeof raw.message.content === 'string'
      ? raw.message.content
      : Array.isArray(raw.message.content)
        ? raw.message.content.map(p => typeof p === 'string' ? p : p?.text || '').filter(Boolean).join('\n')
        : String(raw.message.content || '');
    if (!content.trim()) return [];
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'text',
      role: 'user',
      content,
    })];
  }

  // Assistant message
  if (raw.message?.role === 'assistant') {
    const content = typeof raw.message.content === 'string'
      ? raw.message.content
      : Array.isArray(raw.message.content)
        ? raw.message.content.map(p => typeof p === 'string' ? p : p?.text || '').filter(Boolean).join('\n')
        : '';
    if (!content.trim()) return [];
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'text',
      role: 'assistant',
      content,
    })];
  }

  // Thinking/reasoning
  if (raw.type === 'thinking' || raw.isReasoning) {
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'thinking',
      content: raw.message?.content || '',
    })];
  }

  // Tool use
  if (raw.type === 'tool_use' || raw.toolName) {
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'tool_use',
      toolName: raw.toolName || 'Unknown',
      toolInput: raw.toolInput,
      toolId: raw.toolCallId || baseId,
    })];
  }

  // Tool result
  if (raw.type === 'tool_result') {
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'tool_result',
      toolId: raw.toolCallId || '',
      content: raw.output || '',
      isError: Boolean(raw.isError),
    })];
  }

  return [];
}

/**
 * Normalize a raw Codex event (history JSONL or transformed SDK event) into NormalizedMessage(s).
 * @param {object} raw - A history entry (has raw.message.role) or transformed SDK event (has raw.type)
 * @param {string} sessionId
 * @returns {import('../types.js').NormalizedMessage[]}
 */
export function normalizeMessage(raw, sessionId) {
  // History format: has message.role
  if (raw.message?.role) {
    return normalizeCodexHistoryEntry(raw, sessionId);
  }

  const ts = raw.timestamp || new Date().toISOString();
  const baseId = raw.uuid || generateMessageId('codex');

  // SDK event format (output of transformCodexEvent)
  if (raw.type === 'item') {
    switch (raw.itemType) {
      case 'agent_message':
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'text', role: 'assistant', content: raw.message?.content || '',
        })];
      case 'reasoning':
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'thinking', content: raw.message?.content || '',
        })];
      case 'command_execution':
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'tool_use', toolName: 'Bash', toolInput: { command: raw.command },
          toolId: baseId,
          output: raw.output, exitCode: raw.exitCode, status: raw.status,
        })];
      case 'file_change':
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'tool_use', toolName: 'FileChanges', toolInput: raw.changes,
          toolId: baseId, status: raw.status,
        })];
      case 'mcp_tool_call':
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'tool_use', toolName: raw.tool || 'MCP', toolInput: raw.arguments,
          toolId: baseId, server: raw.server, result: raw.result,
          error: raw.error, status: raw.status,
        })];
      case 'web_search':
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'tool_use', toolName: 'WebSearch', toolInput: { query: raw.query },
          toolId: baseId,
        })];
      case 'todo_list':
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'tool_use', toolName: 'TodoList', toolInput: { items: raw.items },
          toolId: baseId,
        })];
      case 'error':
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'error', content: raw.message?.content || 'Unknown error',
        })];
      default:
        // Unknown item type — pass through as generic tool_use
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'tool_use', toolName: raw.itemType || 'Unknown',
          toolInput: raw.item || raw, toolId: baseId,
        })];
    }
  }

  if (raw.type === 'turn_complete') {
    return [createNormalizedMessage({
      id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
      kind: 'complete',
    })];
  }
  if (raw.type === 'turn_failed') {
    return [createNormalizedMessage({
      id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
      kind: 'error', content: raw.error?.message || 'Turn failed',
    })];
  }

  return [];
}

/**
 * @type {import('../types.js').ProviderAdapter}
 */
export const codexAdapter = {
  normalizeMessage,
  /**
   * Fetch session history from Codex JSONL files.
   */
  async fetchHistory(sessionId, opts = {}) {
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
  },
};
