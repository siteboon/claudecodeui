/**
 * Gemini provider adapter.
 *
 * Normalizes Gemini CLI session history into NormalizedMessage format.
 * @module adapters/gemini
 */

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
