/**
 * Cursor provider adapter.
 *
 * Normalizes Cursor CLI realtime NDJSON events into NormalizedMessage format.
 * History loading lives in ./sessions.js.
 * @module adapters/cursor
 */

import { createNormalizedMessage } from '../types.js';

const PROVIDER = 'cursor';

/**
 * Normalize a realtime NDJSON event from Cursor CLI into NormalizedMessage(s).
 * History uses normalizeCursorBlobs (SQLite DAG), this handles streaming NDJSON.
 * @param {object|string} raw - A parsed NDJSON event or a raw text line
 * @param {string} sessionId
 * @returns {import('../types.js').NormalizedMessage[]}
 */
export function normalizeMessage(raw, sessionId) {
  // Structured assistant message with content array
  if (raw && typeof raw === 'object' && raw.type === 'assistant' && raw.message?.content?.[0]?.text) {
    return [createNormalizedMessage({ kind: 'stream_delta', content: raw.message.content[0].text, sessionId, provider: PROVIDER })];
  }
  // Plain string line (non-JSON output)
  if (typeof raw === 'string' && raw.trim()) {
    return [createNormalizedMessage({ kind: 'stream_delta', content: raw, sessionId, provider: PROVIDER })];
  }
  return [];
}
