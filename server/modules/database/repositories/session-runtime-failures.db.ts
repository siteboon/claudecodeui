import { getConnection } from '@/modules/database/connection.js';
import type { SessionRuntimeFailure } from '@/shared/index.js';

/** Providers stores bounded, prompt-free failure evidence and restores notices after reconnects. */
export const sessionRuntimeFailuresDb = {
  record(failure: SessionRuntimeFailure): void {
    const db = getConnection();
    db.transaction(() => {
      // An unindexed/direct SDK invocation has no app session to attach to.
      db.prepare(`INSERT OR IGNORE INTO session_runtime_failures (id, session_id, timestamp, payload_json)
        SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM sessions WHERE session_id = ?)`)
        .run(failure.id, failure.sessionId, failure.timestamp, JSON.stringify(failure), failure.sessionId);
      db.prepare(`DELETE FROM session_runtime_failures WHERE julianday(timestamp) < julianday('now', '-90 days')`).run();
      db.prepare(`DELETE FROM session_runtime_failures WHERE session_id = ? AND id NOT IN (
        SELECT id FROM session_runtime_failures WHERE session_id = ? ORDER BY timestamp DESC, id DESC LIMIT 100
      )`).run(failure.sessionId, failure.sessionId);
    })();
  },

  list(sessionId: string): SessionRuntimeFailure[] {
    const rows = getConnection().prepare(`SELECT payload_json FROM session_runtime_failures
      WHERE session_id = ? ORDER BY timestamp, id`).all(sessionId) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as SessionRuntimeFailure);
  },
};
