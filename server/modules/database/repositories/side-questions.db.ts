import { getConnection } from '@/modules/database/connection.js';

export type SideQuestionStatus = 'running' | 'done' | 'error';

export type SideQuestionRow = {
  id: string;
  session_id: string;
  question: string;
  answer: string;
  status: SideQuestionStatus;
  error: string | null;
  model: string | null;
  created_at: string;
  finished_at: string | null;
};

const COLUMNS =
  'id, session_id, question, answer, status, error, model, created_at, finished_at';

export const sideQuestionsDb = {
  create(input: {
    id: string;
    sessionId: string;
    question: string;
    model: string | null;
  }): SideQuestionRow {
    const db = getConnection();

    db.prepare(
      `INSERT INTO side_questions (id, session_id, question, status, model, created_at)
       VALUES (?, ?, ?, 'running', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
    ).run(
      input.id,
      input.sessionId,
      input.question,
      input.model,
    );

    return db.prepare(`SELECT ${COLUMNS} FROM side_questions WHERE id = ?`).get(input.id) as SideQuestionRow;
  },

  getById(id: string): SideQuestionRow | null {
    const row = getConnection()
      .prepare(`SELECT ${COLUMNS} FROM side_questions WHERE id = ?`)
      .get(id) as SideQuestionRow | undefined;
    return row ?? null;
  },

  appendAnswer(id: string, text: string): void {
    getConnection()
      .prepare(
        `UPDATE side_questions
         SET answer = answer || ?
         WHERE id = ?`
      )
      .run(text, id);
  },

  finish(id: string, outcome: { status: 'done' | 'error'; answer: string; error?: string | null }): void {
    getConnection()
      .prepare(
        `UPDATE side_questions
         SET status = ?, answer = ?, error = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
      .run(outcome.status, outcome.answer, outcome.error ?? null, id);
  },

  listForSession(sessionId: string): SideQuestionRow[] {
    return getConnection()
      .prepare(
        `SELECT ${COLUMNS} FROM side_questions
         WHERE session_id = ?
         ORDER BY created_at ASC`
      )
      .all(sessionId) as SideQuestionRow[];
  },

  delete(sessionId: string, id: string): boolean {
    const result = getConnection()
      .prepare(
        `DELETE FROM side_questions
         WHERE id = ? AND session_id = ?`
      )
      .run(id, sessionId);

    return result.changes > 0;
  },

  failRunning(error: string): number {
    const result = getConnection()
      .prepare(
        `UPDATE side_questions
         SET status = 'error', error = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE status = 'running'`
      )
      .run(error);

    return result.changes;
  },
};
