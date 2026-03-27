import { getConnection } from '@/shared/database/connection.js';
import type { WorkspaceOriginalPathRow } from '@/shared/database/types.js';

export const workspaceOriginalPathsDb = {
    createWorkspacePath(workspacePath: string, customWorkspaceName: string | null = null): void {
        const db = getConnection();
        db.prepare(`
            INSERT INTO workspace_original_paths (workspace_path, custom_workspace_name)
            VALUES (?, ?)
            ON CONFLICT(workspace_path) DO UPDATE SET
              custom_workspace_name = CASE
                WHEN workspace_original_paths.custom_workspace_name IS NULL OR workspace_original_paths.custom_workspace_name = ''
                THEN excluded.custom_workspace_name
                ELSE workspace_original_paths.custom_workspace_name
              END
        `).run(workspacePath, customWorkspaceName);
    },

    getCustomWorkspaceName(workspacePath: string): string | null {
        const db = getConnection();
        const row = db.prepare(`
            SELECT custom_workspace_name
            FROM workspace_original_paths
            WHERE workspace_path = ?
        `).get(workspacePath) as Pick<WorkspaceOriginalPathRow, 'custom_workspace_name'> | undefined;

        return row?.custom_workspace_name ?? null;
    },

    updateCustomWorkspaceName(workspacePath: string, customWorkspaceName: string | null): void {
        const db = getConnection();
        db.prepare(`
            INSERT INTO workspace_original_paths (workspace_path, custom_workspace_name)
            VALUES (?, ?)
            ON CONFLICT(workspace_path) DO UPDATE SET custom_workspace_name = excluded.custom_workspace_name
        `).run(workspacePath, customWorkspaceName);
    },
};
