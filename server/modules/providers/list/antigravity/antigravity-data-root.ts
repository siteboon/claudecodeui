/**
 * Antigravity Data Root
 *
 * Single source of truth for every Antigravity CLI (agy) filesystem location.
 * The auth, models, sessions, and session-synchronizer providers plus the
 * sessions watcher all resolve their paths here, so the
 * `CLOUDCLI_ANTIGRAVITY_DATA_DIR` override (used by tests and sandboxed
 * setups) applies uniformly — a watcher on the override root never fires
 * events that a synchronizer then reads from the default root.
 *
 * @module antigravity-data-root
 */

import os from 'node:os';
import path from 'node:path';

/**
 * Resolves the Antigravity CLI data root (`~/.gemini/antigravity-cli` by
 * default). `CLOUDCLI_ANTIGRAVITY_DATA_DIR` overrides it so tests can point
 * file lookups at an isolated fixture tree instead of the real home directory.
 * Consumed by the auth, models, sessions, and session-synchronizer providers
 * (via this module) and by the sessions watcher (via the module barrel).
 */
export function getAntigravityDataRoot(): string {
  return process.env.CLOUDCLI_ANTIGRAVITY_DATA_DIR
    ?? path.join(os.homedir(), '.gemini', 'antigravity-cli');
}

/**
 * Resolves the conversation summaries SQLite database that agy maintains for
 * session indexing. Consumed by the session synchronizer (reads rows) and by
 * the sessions watcher (matches the file name it listens for).
 */
export function getAntigravitySummariesDbPath(): string {
  return path.join(getAntigravityDataRoot(), 'conversation_summaries.db');
}

/**
 * Resolves the `settings.json` file where agy persists the user's default
 * model. Consumed by the models provider's default-model fallback.
 */
export function getAntigravitySettingsPath(): string {
  return path.join(getAntigravityDataRoot(), 'settings.json');
}

/**
 * Resolves the OAuth token file written by a completed `agy` login — the only
 * file that counts as authenticated. Consumed by the auth provider.
 */
export function getAntigravityOauthTokenPath(): string {
  return path.join(getAntigravityDataRoot(), 'antigravity-oauth-token');
}

/**
 * Returns transcript.jsonl candidates for one session, newest layout first:
 * the current data root's brain directory, then the pre-1.1 legacy
 * `~/.gemini/antigravity` tree kept for old installations. Consumed by the
 * sessions provider's history loader. `safeSessionId` must already be
 * sanitized with `sanitizeLeafDirectoryName`.
 */
export function getAntigravityTranscriptCandidates(safeSessionId: string): string[] {
  return [
    path.join(getAntigravityDataRoot(), 'brain', safeSessionId, '.system_generated', 'logs', 'transcript.jsonl'),
    path.join(os.homedir(), '.gemini', 'antigravity', 'brain', safeSessionId, '.system_generated', 'logs', 'transcript.jsonl'),
  ];
}
