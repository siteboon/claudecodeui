/**
 * Cursor provider adapter.
 *
 * Normalizes Cursor CLI session history into NormalizedMessage format.
 * @module adapters/cursor
 */

import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { createNormalizedMessage, generateMessageId } from '../types.js';

const PROVIDER = 'cursor';

/**
 * Load raw blobs from Cursor's SQLite store.db, parse the DAG structure,
 * and return sorted message blobs in chronological order.
 * @param {string} sessionId
 * @param {string} projectPath - Absolute project path (used to compute cwdId hash)
 * @returns {Promise<Array<{id: string, sequence: number, rowid: number, content: object}>>}
 */
async function loadCursorBlobs(sessionId, projectPath) {
  // Lazy-import sqlite so the module doesn't fail if sqlite3 is unavailable
  const { default: sqlite3 } = await import('sqlite3');
  const { open } = await import('sqlite');

  const cwdId = crypto.createHash('md5').update(projectPath || process.cwd()).digest('hex');
  const storeDbPath = path.join(os.homedir(), '.cursor', 'chats', cwdId, sessionId, 'store.db');

  const db = await open({
    filename: storeDbPath,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY,
  });

  try {
    const allBlobs = await db.all('SELECT rowid, id, data FROM blobs');

    const blobMap = new Map();
    const parentRefs = new Map();
    const childRefs = new Map();
    const jsonBlobs = [];

    for (const blob of allBlobs) {
      blobMap.set(blob.id, blob);

      if (blob.data && blob.data[0] === 0x7B) {
        try {
          const parsed = JSON.parse(blob.data.toString('utf8'));
          jsonBlobs.push({ ...blob, parsed });
        } catch {
          // skip unparseable blobs
        }
      } else if (blob.data) {
        const parents = [];
        let i = 0;
        while (i < blob.data.length - 33) {
          if (blob.data[i] === 0x0A && blob.data[i + 1] === 0x20) {
            const parentHash = blob.data.slice(i + 2, i + 34).toString('hex');
            if (blobMap.has(parentHash)) {
              parents.push(parentHash);
            }
            i += 34;
          } else {
            i++;
          }
        }
        if (parents.length > 0) {
          parentRefs.set(blob.id, parents);
          for (const parentId of parents) {
            if (!childRefs.has(parentId)) childRefs.set(parentId, []);
            childRefs.get(parentId).push(blob.id);
          }
        }
      }
    }

    // Topological sort (DFS)
    const visited = new Set();
    const sorted = [];
    function visit(nodeId) {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      for (const pid of (parentRefs.get(nodeId) || [])) visit(pid);
      const b = blobMap.get(nodeId);
      if (b) sorted.push(b);
    }
    for (const blob of allBlobs) {
      if (!parentRefs.has(blob.id)) visit(blob.id);
    }
    for (const blob of allBlobs) visit(blob.id);

    // Order JSON blobs by DAG appearance
    const messageOrder = new Map();
    let orderIndex = 0;
    for (const blob of sorted) {
      if (blob.data && blob.data[0] !== 0x7B) {
        for (const jb of jsonBlobs) {
          try {
            const idBytes = Buffer.from(jb.id, 'hex');
            if (blob.data.includes(idBytes) && !messageOrder.has(jb.id)) {
              messageOrder.set(jb.id, orderIndex++);
            }
          } catch { /* skip */ }
        }
      }
    }

    const sortedJsonBlobs = jsonBlobs.sort((a, b) => {
      const oa = messageOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const ob = messageOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return oa !== ob ? oa - ob : a.rowid - b.rowid;
    });

    const messages = [];
    for (let idx = 0; idx < sortedJsonBlobs.length; idx++) {
      const blob = sortedJsonBlobs[idx];
      const parsed = blob.parsed;
      if (!parsed) continue;
      const role = parsed?.role || parsed?.message?.role;
      if (role === 'system') continue;
      messages.push({
        id: blob.id,
        sequence: idx + 1,
        rowid: blob.rowid,
        content: parsed,
      });
    }

    return messages;
  } finally {
    await db.close();
  }
}

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

/**
 * @type {import('../types.js').ProviderAdapter}
 */
export const cursorAdapter = {
  normalizeMessage,
  /**
   * Fetch session history for Cursor from SQLite store.db.
   */
  async fetchHistory(sessionId, opts = {}) {
    const { projectPath = '', limit = null, offset = 0 } = opts;

    try {
      const blobs = await loadCursorBlobs(sessionId, projectPath);
      const allNormalized = cursorAdapter.normalizeCursorBlobs(blobs, sessionId);

      // Apply pagination
      if (limit !== null && limit > 0) {
        const start = offset;
        const page = allNormalized.slice(start, start + limit);
        return {
          messages: page,
          total: allNormalized.length,
          hasMore: start + limit < allNormalized.length,
          offset,
          limit,
        };
      }

      return {
        messages: allNormalized,
        total: allNormalized.length,
        hasMore: false,
        offset: 0,
        limit: null,
      };
    } catch (error) {
      // DB doesn't exist or is unreadable — return empty
      console.warn(`[CursorAdapter] Failed to load session ${sessionId}:`, error.message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }
  },

  /**
   * Normalize raw Cursor blob messages into NormalizedMessage[].
   * @param {any[]} blobs - Raw cursor blobs from store.db ({id, sequence, rowid, content})
   * @param {string} sessionId
   * @returns {import('../types.js').NormalizedMessage[]}
   */
  normalizeCursorBlobs(blobs, sessionId) {
    const messages = [];
    const toolUseMap = new Map();

    // Use a fixed base timestamp so messages have stable, monotonically-increasing
    // timestamps based on their sequence number rather than wall-clock time.
    const baseTime = Date.now();

    for (let i = 0; i < blobs.length; i++) {
      const blob = blobs[i];
      const content = blob.content;
      const ts = new Date(baseTime + (blob.sequence ?? i) * 100).toISOString();
      const baseId = blob.id || generateMessageId('cursor');

      try {
        if (!content?.role || !content?.content) {
          // Try nested message format
          if (content?.message?.role && content?.message?.content) {
            if (content.message.role === 'system') continue;
            const role = content.message.role === 'user' ? 'user' : 'assistant';
            let text = '';
            if (Array.isArray(content.message.content)) {
              text = content.message.content
                .map(p => typeof p === 'string' ? p : p?.text || '')
                .filter(Boolean)
                .join('\n');
            } else if (typeof content.message.content === 'string') {
              text = content.message.content;
            }
            if (text?.trim()) {
              messages.push(createNormalizedMessage({
                id: baseId,
                sessionId,
                timestamp: ts,
                provider: PROVIDER,
                kind: 'text',
                role,
                content: text,
                sequence: blob.sequence,
                rowid: blob.rowid,
              }));
            }
          }
          continue;
        }

        if (content.role === 'system') continue;

        // Tool results
        if (content.role === 'tool') {
          const toolItems = Array.isArray(content.content) ? content.content : [];
          for (const item of toolItems) {
            if (item?.type !== 'tool-result') continue;
            const toolCallId = item.toolCallId || content.id;
            messages.push(createNormalizedMessage({
              id: `${baseId}_tr`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'tool_result',
              toolId: toolCallId,
              content: item.result || '',
              isError: false,
            }));
          }
          continue;
        }

        const role = content.role === 'user' ? 'user' : 'assistant';

        if (Array.isArray(content.content)) {
          for (let partIdx = 0; partIdx < content.content.length; partIdx++) {
            const part = content.content[partIdx];

            if (part?.type === 'text' && part?.text) {
              messages.push(createNormalizedMessage({
                id: `${baseId}_${partIdx}`,
                sessionId,
                timestamp: ts,
                provider: PROVIDER,
                kind: 'text',
                role,
                content: part.text,
                sequence: blob.sequence,
                rowid: blob.rowid,
              }));
            } else if (part?.type === 'reasoning' && part?.text) {
              messages.push(createNormalizedMessage({
                id: `${baseId}_${partIdx}`,
                sessionId,
                timestamp: ts,
                provider: PROVIDER,
                kind: 'thinking',
                content: part.text,
              }));
            } else if (part?.type === 'tool-call' || part?.type === 'tool_use') {
              const toolName = (part.toolName || part.name || 'Unknown Tool') === 'ApplyPatch'
                ? 'Edit' : (part.toolName || part.name || 'Unknown Tool');
              const toolId = part.toolCallId || part.id || `tool_${i}_${partIdx}`;
              messages.push(createNormalizedMessage({
                id: `${baseId}_${partIdx}`,
                sessionId,
                timestamp: ts,
                provider: PROVIDER,
                kind: 'tool_use',
                toolName,
                toolInput: part.args || part.input,
                toolId,
              }));
              toolUseMap.set(toolId, messages[messages.length - 1]);
            }
          }
        } else if (typeof content.content === 'string' && content.content.trim()) {
          messages.push(createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'text',
            role,
            content: content.content,
            sequence: blob.sequence,
            rowid: blob.rowid,
          }));
        }
      } catch (error) {
        console.warn('Error normalizing cursor blob:', error);
      }
    }

    // Attach tool results to tool_use messages
    for (const msg of messages) {
      if (msg.kind === 'tool_result' && msg.toolId && toolUseMap.has(msg.toolId)) {
        const toolUse = toolUseMap.get(msg.toolId);
        toolUse.toolResult = {
          content: msg.content,
          isError: msg.isError,
        };
      }
    }

    // Sort by sequence/rowid
    messages.sort((a, b) => {
      if (a.sequence !== undefined && b.sequence !== undefined) return a.sequence - b.sequence;
      if (a.rowid !== undefined && b.rowid !== undefined) return a.rowid - b.rowid;
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    return messages;
  },
};
