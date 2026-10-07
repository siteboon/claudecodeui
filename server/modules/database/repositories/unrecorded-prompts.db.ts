import { getConnection } from '@/modules/database/connection.js';

/** One prompt a provider accepted for a turn but never wrote to its transcript. */
type UnrecordedPromptRecord = {
  sessionId: string;
  provider: string;
  providerSessionId: string;
  /** The provider turn the prompt opened, or null when none was opened. */
  turnId: string | null;
  text: string;
  imagePaths: string[];
  /** ISO 8601 UTC. */
  submittedAt: string;
};

type UnrecordedPromptRow = {
  session_id: string;
  provider: string;
  provider_session_id: string;
  turn_id: string | null;
  prompt_text: string;
  image_paths: string;
  submitted_at: string;
};

/** A stored path list that no longer parses is treated as no images, not fatal. */
function parseImagePaths(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Used by the Providers module: the Codex runtime keeps a prompt Codex never
 * wrote to its rollout, and the Codex history reader puts it back in place.
 */
export const unrecordedPromptsDb = {
  add(record: UnrecordedPromptRecord): void {
    getConnection()
      .prepare(
        `INSERT INTO unrecorded_prompts
           (session_id, provider, provider_session_id, turn_id, prompt_text, image_paths, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.sessionId,
        record.provider,
        record.providerSessionId,
        record.turnId,
        record.text,
        JSON.stringify(record.imagePaths),
        record.submittedAt,
      );
  },

  /**
   * Prompts kept for one transcript of a session, oldest first.
   *
   * Scoped to the provider session because an edit moves a session onto a
   * branched transcript, and prompts kept for the one it left are not part of
   * the branch.
   */
  listForProviderSession(sessionId: string, provider: string, providerSessionId: string): UnrecordedPromptRecord[] {
    const rows = getConnection()
      .prepare(
        `SELECT session_id, provider, provider_session_id, turn_id, prompt_text, image_paths, submitted_at
         FROM unrecorded_prompts
         WHERE session_id = ? AND provider = ? AND provider_session_id = ?
         ORDER BY submitted_at ASC, id ASC`
      )
      .all(sessionId, provider, providerSessionId) as UnrecordedPromptRow[];

    return rows.map((row) => ({
      sessionId: row.session_id,
      provider: row.provider,
      providerSessionId: row.provider_session_id,
      turnId: row.turn_id,
      text: row.prompt_text,
      imagePaths: parseImagePaths(row.image_paths),
      submittedAt: row.submitted_at,
    }));
  },
};
