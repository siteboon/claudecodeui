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
<<<<<<< HEAD
=======
 * Load raw blobs from Cursor's SQLite store.db, parse the DAG structure,
 * and return sorted message blobs in chronological order.
 * @param {string} sessionId
 * @param {string} projectPath - Absolute project path (used to compute cwdId hash)
 * @returns {Promise<Array<{id: string, sequence: number, rowid: number, content: object}>>}
 */
async function loadCursorBlobs(sessionId, projectPath) {
  // Lazy-import better-sqlite3 so the module doesn't fail if it's unavailable
  const { default: Database } = await import('better-sqlite3');

  const cwdId = crypto.createHash('md5').update(projectPath || process.cwd()).digest('hex');
  const storeDbPath = path.join(os.homedir(), '.cursor', 'chats', cwdId, sessionId, 'store.db');

  const db = new Database(storeDbPath, { readonly: true, fileMustExist: true });

  try {
    const allBlobs = db.prepare('SELECT rowid, id, data FROM blobs').all();

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
    db.close();
  }
}

/**
>>>>>>> refactor/split-server-index
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
