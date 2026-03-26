import { Database } from "better-sqlite3";
import { APP_CONFIG_TABLE_SCHEMA_SQL, LAST_SCANNED_AT_SQL, SESSIONS_TABLE_SCHEMA_SQL, WORK_SPACE_PATH_SQL } from "@/shared/database/schema.js";
import { logger } from "@/shared/utils/logger.js";

const addColumnToTableIfNotExists = (
    db: Database,
    tableName: string,
    columnNames: string[],
    columnName: string,
    columnType: string,
) => {
    if (!columnNames.includes(columnName)) {
        logger.info(
            `Running migration: Adding ${columnName} column to ${tableName} table`,
        );
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
    }
};

export const runMigrations = (db: Database) => {
    try {
        const usersTableInfo = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
        const userColumnNames = usersTableInfo.map((col) => col.name);

        addColumnToTableIfNotExists(db, "users", userColumnNames, "git_name", "TEXT");
        addColumnToTableIfNotExists(db, "users", userColumnNames, "git_email", "TEXT");
        addColumnToTableIfNotExists(db, "users", userColumnNames, "has_completed_onboarding", "BOOLEAN DEFAULT 0",
        );

        // Create app_config table if it doesn't exist (for existing installations)
        db.exec(APP_CONFIG_TABLE_SCHEMA_SQL);

        // Create sessions table if it doesn't exist (for existing installations)
        db.exec(SESSIONS_TABLE_SCHEMA_SQL);
        db.exec(
            "CREATE INDEX IF NOT EXISTS idx_session_ids_lookup ON sessions(session_id)"
        );

        db.exec(WORK_SPACE_PATH_SQL);
        const workspaceOriginalPathsTableInfo = db.prepare("PRAGMA table_info(workspace_original_paths)").all() as { name: string }[];
        const workspaceOriginalPathsColumnNames = workspaceOriginalPathsTableInfo.map((col) => col.name);
        addColumnToTableIfNotExists(
            db,
            "workspace_original_paths",
            workspaceOriginalPathsColumnNames,
            "custom_workspace_name",
            "TEXT DEFAULT NULL",
        );

        db.exec(LAST_SCANNED_AT_SQL);

        logger.info("Database migrations completed successfully");

    } catch (error: any) {
        logger.error("Error running migrations: ", error.message);
        throw error;
    }
};
