/**
 * Gemini session history fetcher.
 *
 * Extracted from adapter.js — pure data-access concern.
 * @module providers/gemini/sessions
 */

import sessionManager from '../../sessionManager.js';
import { getGeminiCliSessionMessages } from '../../projects.js';
import { createNormalizedMessage, generateMessageId } from '../types.js';

const PROVIDER = 'gemini';

/**
 * Fetch session history for Gemini.
 * First tries in-memory session manager, then falls back to CLI sessions on disk.
 * @param {string} sessionId
 * @param {object} opts
 * @returns {Promise<{messages: import('../types.js').NormalizedMessage[], total: number, hasMore: boolean, offset: number, limit: number|null}>}
 */
export async function fetchHistory(sessionId, opts = {}) {
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
}
