import { getConnection } from '@/shared/database/connection.js';
import { runMigrations } from '@/shared/database/migrations.js';
import { INIT_SCHEMA_SQL } from '@/shared/database/schema.js';
import { logger } from '@/shared/utils/logger.js';

// Initialize database with schema
export const initializeDatabase = async () => {
    try {
        const db = getConnection();
        db.exec(INIT_SCHEMA_SQL);
        logger.info('Database schema applied');
        runMigrations(db); // ? If we rename the database to something new, would a migration be still necessary?
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Database initialization failed', { error: message });
        throw err;
    }
};
