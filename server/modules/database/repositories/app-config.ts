/**
 * App config repository.
 *
 * Key-value store for application-level configuration that persists
 * across restarts (JWT secret, feature flags, etc.). Values are always
 * stored as strings; callers handle parsing.
 */

import crypto from 'crypto';

import { getConnection } from '@/modules/database/connection.js';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Narrows a secret read to a value that can actually be used for signing.
 *
 * `null` means the row is absent; an empty string means the row exists and
 * holds nothing, which INSERT OR IGNORE cannot replace. Neither may be handed
 * back: an empty signing secret would reject every token already issued, and
 * treating one as "missing" would loop over a row that never gets written.
 */
const requireUsableSecret = (key: string, value: string | null): string => {
  if (value === null) {
    throw new Error(`Failed to persist app_config secret '${key}'`);
  }
  if (value === '') {
    throw new Error(`app_config secret '${key}' exists but is empty`);
  }
  return value;
};

export const appConfigDb = {
  /**
   * Returns the stored value for a config key, or null when the key is absent.
   *
   * Read failures propagate. Callers must never be able to confuse "this key
   * has no row" with "this read did not complete": secret bootstrap treats the
   * former as permission to mint a replacement, so swallowing the latter
   * silently rotated the JWT secret out from under every issued token.
   */
  get(key: string): string | null {
    const db = getConnection();
    const row = db
      .prepare('SELECT value FROM app_config WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  },

  /** Inserts or updates a config key (upsert). */
  set(key: string, value: string): void {
    const db = getConnection();
    db.prepare(
      'INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value);
  },

  /**
   * Returns the persisted secret for `key`, generating one only when the row
   * is genuinely absent. Used by auth (JWT signing secret) and browser-use
   * (MCP token) — values whose replacement invalidates live credentials.
   *
   * The write is INSERT OR IGNORE rather than an upsert, so a racing writer
   * that inserted first keeps its value, and the value returned is always the
   * one now in the table rather than the local candidate. A row that is still
   * unreadable afterwards throws: refusing to start is safer than signing with
   * a secret that does not match the tokens already issued.
   */
  getOrCreateSecret(key: string, generateSecret: () => string): string {
    const existing = appConfigDb.get(key);
    if (existing !== null) {
      return requireUsableSecret(key, existing);
    }

    const candidate = generateSecret();
    if (candidate === '') {
      // Never let an empty candidate reach the table: INSERT OR IGNORE would
      // preserve that row for good, so every later call would fail on a key
      // that can no longer be created.
      throw new Error(`Generated app_config secret '${key}' is empty`);
    }

    const db = getConnection();
    db.prepare('INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)').run(key, candidate);

    return requireUsableSecret(key, appConfigDb.get(key));
  },

  /**
   * Returns the JWT signing secret, generating and persisting one on first
   * boot. Read by the auth middleware at module load; the secret must survive
   * every restart or previously issued tokens fail signature verification.
   */
  getOrCreateJwtSecret(): string {
    return appConfigDb.getOrCreateSecret('jwt_secret', () =>
      crypto.randomBytes(64).toString('hex')
    );
  },
};
