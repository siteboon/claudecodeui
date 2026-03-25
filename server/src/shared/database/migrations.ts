import { Database } from "better-sqlite3";
import { APP_CONFIG_TABLE_SCHEMA_SQL, LAST_SCANNED_AT_SQL, SESSIONS_TABLE_SCHEMA_SQL, WORK_SPACE_PATH_SQL } from "@/shared/database/schema.js";
import { logger } from "@/shared/utils/logger.js";

const addColumnToUsersTableIfNotExists = (
    db: Database,
    columnNames: string[],
    columnName: string,
    columnType: string,
) => {
    if (!columnNames.includes(columnName)) {
        logger.info(
            `Running migration: Adding ${columnName} column to users table`,
        );
        db.exec(`ALTER TABLE users ADD COLUMN ${columnName} ${columnType}`);
    }
};

export const runMigrations = (db: Database) => {
    try {
        const tableInfo = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
        const columnNames = tableInfo.map((col) => col.name);

        addColumnToUsersTableIfNotExists(db, columnNames, "git_name", "TEXT");
        addColumnToUsersTableIfNotExists(db, columnNames, "git_email", "TEXT");
        addColumnToUsersTableIfNotExists(db, columnNames, "has_completed_onboarding", "BOOLEAN DEFAULT 0",
        );

        // Create app_config table if it doesn't exist (for existing installations)
        db.exec(APP_CONFIG_TABLE_SCHEMA_SQL);

        // Create sessions table if it doesn't exist (for existing installations)
        db.exec(SESSIONS_TABLE_SCHEMA_SQL);
        db.exec(
            "CREATE INDEX IF NOT EXISTS idx_session_ids_lookup ON sessions(session_id)"
        );

        db.exec(WORK_SPACE_PATH_SQL);

        db.exec(LAST_SCANNED_AT_SQL);

        logger.info("Database migrations completed successfully");

    } catch (error: any) {
        logger.error("Error running migrations: ", error.message);
        throw error;
    }
};
