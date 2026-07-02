import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { getConnection } from '@/modules/database/connection.js';
import type { CreateProjectPathOptions, CreateProjectPathResult, ProjectRepositoryRow } from '@/shared/types.js';
import { normalizeProjectPath } from '@/shared/utils.js';

function normalizeProjectDisplayName(projectPath: string, customProjectName: string | null): string {
    const trimmedCustomName = typeof customProjectName === 'string' ? customProjectName.trim() : '';
    if (trimmedCustomName.length > 0) {
        return trimmedCustomName;
    }

    const directoryName = path.basename(projectPath);
    return directoryName || projectPath;
}

export const projectsDb = {
    /**
     * Ensures a `projects` row exists for `projectPath` and returns the outcome.
     *
     * `reactivateArchived` (default `true`) controls what happens when the path already exists
     * but is archived: explicit user actions (creating a project, starting a session) reactivate it,
     * but the background session synchronizer must pass `false`. Otherwise any passive re-scan that
     * re-touches a transcript would silently un-archive a project the user deliberately hid.
     */
    createProjectPath(
        projectPath: string,
        customProjectName: string | null = null,
        options: CreateProjectPathOptions = {},
    ): CreateProjectPathResult {
        const { reactivateArchived = true } = options;
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const normalizedProjectName = normalizeProjectDisplayName(normalizedProjectPath, customProjectName);
        const attemptedId = randomUUID();
        // Explicit user actions (reactivateArchived) revive an archived OR force-deleted
        // (tombstoned) row. The background synchronizer passes false and instead relies on the
        // tombstone guard in `sessionsDb.createSession`, so it must not revive here.
        const conflictClause = reactivateArchived
            ? 'DO UPDATE SET isArchived = 0, isDeleted = 0, deleted_at = NULL WHERE projects.isArchived = 1 OR projects.isDeleted = 1'
            : 'DO NOTHING';
        const row = db.prepare(`
        INSERT INTO projects (project_id, project_path, custom_project_name, isArchived)
            VALUES (?, ?, ?, 0)
            ON CONFLICT(project_path) ${conflictClause}
            RETURNING project_id, project_path, custom_project_name, isStarred, isArchived
        `).get(attemptedId, normalizedProjectPath, normalizedProjectName) as ProjectRepositoryRow | undefined;

        if (row) {
            return {
                outcome: row.project_id === attemptedId ? 'created' : 'reactivated_archived',
                project: row,
            };
        }

        const existingProject = projectsDb.getProjectPath(normalizedProjectPath);
        return {
            outcome: existingProject?.isArchived ? 'archived_conflict' : 'active_conflict',
            project: existingProject,
        };
    },

    getProjectPath(projectPath: string): ProjectRepositoryRow | null {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const row = db.prepare(`
            SELECT project_id, project_path, custom_project_name, isStarred, isArchived
            FROM projects
            WHERE project_path = ?
        `).get(normalizedProjectPath) as ProjectRepositoryRow | undefined;

        return row ?? null;
    },

    getProjectById(projectId: string): ProjectRepositoryRow | null {
        const db = getConnection();
        const row = db.prepare(`
            SELECT project_id, project_path, custom_project_name, isStarred, isArchived
            FROM projects
            WHERE project_id = ?
        `).get(projectId) as ProjectRepositoryRow | undefined;

        return row ?? null;
    },

    /**
     * Resolve the absolute project directory from a database project_id.
     *
     * This is the canonical lookup used after the projectName → projectId migration:
     * API routes receive the DB-assigned `projectId` and must resolve the real folder
     * path through this helper before touching the filesystem. Returns `null` when the
     * project row does not exist so callers can respond with a 404.
     */
    getProjectPathById(projectId: string): string | null {
        const db = getConnection();
        const row = db.prepare(`
            SELECT project_path
            FROM projects
            WHERE project_id = ?
        `).get(projectId) as Pick<ProjectRepositoryRow, 'project_path'> | undefined;

        return row?.project_path ?? null;
    },

    getProjectPaths(): ProjectRepositoryRow[] {
        const db = getConnection();
        return db.prepare(`
            SELECT project_id, project_path, custom_project_name, isStarred, isArchived
            FROM projects
            WHERE isArchived = 0 AND isDeleted = 0
        `).all() as ProjectRepositoryRow[];
    },

    /**
     * Archived rows are queried separately so archive-focused UIs can present
     * hidden workspaces without reintroducing them into the active sidebar list.
     * Force-deleted (tombstoned) rows are excluded from both lists.
     */
    getArchivedProjectPaths(): ProjectRepositoryRow[] {
        const db = getConnection();
        return db.prepare(`
            SELECT project_id, project_path, custom_project_name, isStarred, isArchived
            FROM projects
            WHERE isArchived = 1 AND isDeleted = 0
        `).all() as ProjectRepositoryRow[];
    },

    /**
     * Force-delete tombstone: keep the `projects` row but hide it and record when it was
     * deleted. The synchronizer consults this (via `getDeletedAtByPath`) so a stale transcript
     * left on disk by ANY provider cannot recreate the project on the next scan. A genuinely new
     * session (activity after `deleted_at`) or an explicit user re-create clears the tombstone.
     */
    markProjectDeletedById(projectId: string): void {
        const db = getConnection();
        db.prepare(`
            UPDATE projects
            SET isDeleted = 1, deleted_at = CURRENT_TIMESTAMP
            WHERE project_id = ?
        `).run(projectId);
    },

    /**
     * Returns the tombstone `deleted_at` for a path when the row is force-deleted, else null.
     */
    getDeletedAtByPath(projectPath: string): string | null {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const row = db.prepare(`
            SELECT deleted_at
            FROM projects
            WHERE project_path = ? AND isDeleted = 1
        `).get(normalizedProjectPath) as { deleted_at: string | null } | undefined;

        return row?.deleted_at ?? null;
    },

    /**
     * Clears the force-delete tombstone for a path (row becomes active again).
     */
    clearProjectDeletedByPath(projectPath: string): void {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        db.prepare(`
            UPDATE projects
            SET isDeleted = 0, deleted_at = NULL
            WHERE project_path = ?
        `).run(normalizedProjectPath);
    },

    getCustomProjectName(projectPath: string): string | null {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const row = db.prepare(`
            SELECT custom_project_name
            FROM projects
            WHERE project_path = ?
        `).get(normalizedProjectPath) as Pick<ProjectRepositoryRow, 'custom_project_name'> | undefined;

        return row?.custom_project_name ?? null;
    },

    updateCustomProjectName(projectPath: string, customProjectName: string | null): void {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        db.prepare(`
            INSERT INTO projects (project_id, project_path, custom_project_name)
            VALUES (?, ?, ?)
            ON CONFLICT(project_path) DO UPDATE SET custom_project_name = excluded.custom_project_name
        `).run(randomUUID(), normalizedProjectPath, customProjectName);
    },

    updateCustomProjectNameById(projectId: string, customProjectName: string | null): void {
        const db = getConnection();
        db.prepare(`
            UPDATE projects
            SET custom_project_name = ?
            WHERE project_id = ?
        `).run(customProjectName, projectId);
    },

    updateProjectIsStarred(projectPath: string, isStarred: boolean): void {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        db.prepare(`
            UPDATE projects
            SET isStarred = ?
            WHERE project_path = ?
        `).run(isStarred ? 1 : 0, normalizedProjectPath);
    },

    updateProjectIsStarredById(projectId: string, isStarred: boolean): void {
        const db = getConnection();
        db.prepare(`
            UPDATE projects
            SET isStarred = ?
            WHERE project_id = ?
        `).run(isStarred ? 1 : 0, projectId);
    },

    updateProjectIsArchived(projectPath: string, isArchived: boolean): void {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        db.prepare(`
            UPDATE projects
            SET isArchived = ?
            WHERE project_path = ?
        `).run(isArchived ? 1 : 0, normalizedProjectPath);
    },

    updateProjectIsArchivedById(projectId: string, isArchived: boolean): void {
        const db = getConnection();
        db.prepare(`
            UPDATE projects
            SET isArchived = ?
            WHERE project_id = ?
        `).run(isArchived ? 1 : 0, projectId);
    },

    deleteProjectPath(projectPath: string): void {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        db.prepare(`
            DELETE FROM projects
            WHERE project_path = ?
        `).run(normalizedProjectPath);
    },

    deleteProjectById(projectId: string): void {
        const db = getConnection();
        db.prepare(`
            DELETE FROM projects
            WHERE project_id = ?
        `).run(projectId);
    },
};
