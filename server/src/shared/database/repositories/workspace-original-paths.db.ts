import { getConnection } from '@/shared/database/connection.js';

export const workspaceOriginalPathsDb = {
    createWorkspacePath(workspacePath: string): void {
        const db = getConnection();
        db.prepare(`
            INSERT INTO workspace_original_paths (workspace_path)
            VALUES (?) 
            ON CONFLICT(workspace_path) DO NOTHING
        `).run(workspacePath);
    },
}