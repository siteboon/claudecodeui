import { getConnection } from '@/modules/database/connection.js';

type ScanStateRow = {
  last_scanned_at: string;
};

export const scanStateDb = {
    getLastScannedAt() {
        const db = getConnection();

        const row = db
            .prepare(`SELECT last_scanned_at FROM scan_state WHERE id = 1`)
            .get() as ScanStateRow;

        if (!row) {
            return null; // Before any scan, the row is undefined.
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

    updateLastScannedAt() {
        const db = getConnection();

        db.prepare(`
            INSERT INTO scan_state (id, last_scanned_at)
            VALUES (1, CURRENT_TIMESTAMP)
            ON CONFLICT (id)
            DO UPDATE SET last_scanned_at = CURRENT_TIMESTAMP
        `).run();
    }
};
