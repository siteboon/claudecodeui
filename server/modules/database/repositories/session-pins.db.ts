import { getConnection } from '@/modules/database/connection.js';
import type { SessionPinRecord } from '@/shared/index.js';

/** Providers uses this repository to persist each authenticated user's session pins. */
export const sessionPinsDb = {
  /** Visible pins are independent of recent-session pages; archived items stay hidden until restored. */
  list(userId: number): SessionPinRecord[] {
    return getConnection().prepare(`
      SELECT sessions.session_id, sessions.provider, sessions.project_path,
             projects.project_id, projects.custom_project_name, sessions.custom_name,
             COALESCE(sessions.updated_at, sessions.created_at) AS last_activity
      FROM session_pins
      JOIN sessions ON sessions.session_id = session_pins.session_id
      LEFT JOIN projects ON projects.project_path = sessions.project_path
      WHERE session_pins.user_id = ? AND sessions.isArchived = 0
        AND COALESCE(projects.isArchived, 0) = 0
      ORDER BY session_pins.pin_id DESC
    `).all(userId) as SessionPinRecord[];
  },

  /** Repeated pin requests preserve order; unpinning and pinning again puts a session first. */
  setPinned(userId: number, sessionId: string, isPinned: boolean): void {
    const db = getConnection();
    if (isPinned) {
      db.prepare(`
        INSERT INTO session_pins (user_id, session_id) VALUES (?, ?)
        ON CONFLICT(user_id, session_id) DO NOTHING
      `).run(userId, sessionId);
    } else {
      db.prepare('DELETE FROM session_pins WHERE user_id = ? AND session_id = ?')
        .run(userId, sessionId);
    }
  },
};
