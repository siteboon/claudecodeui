import { getConnection } from '@/modules/database/connection.js';

/**
 * Identifies the scanner semantics that wrote the persisted cursor.
 *
 * Changing scanner semantics (which files a scan re-reads) without revisiting
 * what the old scanner skipped leaves stale results forever — the creation-time
 * scanner never re-read a modified transcript, so its cursor hid later CLI
 * renames. Bump this value when the scan semantics change: a cursor stamped
 * with a different (or missing) kind is treated as absent, the next scan runs
 * full, and it is then persisted under the new kind.
 */
const SCAN_CURSOR_KIND = 'mtime-v1';

type ScanStateRow = {
  last_scanned_at: string;
  cursor_kind: string | null;
};

export const scanStateDb = {
    getLastScannedAt() {
        const db = getConnection();

        const row = db
            .prepare(`SELECT last_scanned_at, cursor_kind FROM scan_state WHERE id = 1`)
            .get() as ScanStateRow | undefined;

        if (!row) {
            return null; // Before any scan, the row is undefined.
        }

        // A cursor from another scanner kind cannot be trusted to have covered
        // the files the current semantics would cover; fall back to a full scan.
        if (row.cursor_kind !== SCAN_CURSOR_KIND) {
            return null;
        }

        let lastScannedDate: Date | null = null;
        const lastScannedStr = row.last_scanned_at;

        if (lastScannedStr) {
            // SQLite CURRENT_TIMESTAMP returns UTC in "YYYY-MM-DD HH:MM:SS" format.
            // Replace space with 'T' and append 'Z' to parse reliably in JS across all platforms.
            lastScannedDate = new Date(lastScannedStr.replace(' ', 'T') + 'Z');
        }

        return lastScannedDate;
    },

    updateLastScannedAt(scannedAt: Date = new Date()) {
        const db = getConnection();
        const sqliteTimestamp = scannedAt.toISOString().slice(0, 19).replace('T', ' ');

        db.prepare(`
            INSERT INTO scan_state (id, last_scanned_at, cursor_kind)
            VALUES (1, ?, ?)
            ON CONFLICT (id)
            DO UPDATE SET
              last_scanned_at = excluded.last_scanned_at,
              cursor_kind = excluded.cursor_kind
        `).run(sqliteTimestamp, SCAN_CURSOR_KIND);
    }
};
