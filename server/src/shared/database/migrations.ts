import { Database } from "better-sqlite3";
import { APP_CONFIG_TABLE_SCHEMA_SQL, SESSION_NAMES_TABLE_SCHEMA_SQL } from "@/shared/database/schema.js";
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

        // Create session_names table if it doesn't exist (for existing installations)
        db.exec(SESSION_NAMES_TABLE_SCHEMA_SQL);
        db.exec(
            "CREATE INDEX IF NOT EXISTS idx_session_names_lookup ON session_names(session_id, provider)",
        );

        logger.info("Database migrations completed successfully");

    } catch (error: any) {
        logger.error("Error running migrations: ", error.message);
        throw error;
    }
};
