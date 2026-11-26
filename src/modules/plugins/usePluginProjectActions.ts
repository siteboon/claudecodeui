import { useCallback, useRef } from 'react';

import { api, readApiErrorMessage } from '@/shared/api';
import { useOptionalProjectActions } from '@/modules/project-workspace';

export type PluginProjectActionResult = { ok: true } | { ok: false; error: string };

const normalize = (value: string) => value.replace(/[\\/]+$/, '');

/**
 * What plugin UIs get as `archiveProject(path)` / `deleteProject(path)` on their host API: the same requests the
 * sidebar's archive and delete make, under the signed-in user, followed by a sidebar refresh. Plugins name projects by
 * path because that is what they know (a working directory); the host resolves it to its project id. Archive hides the
 * project and keeps every session (restorable from the archive view); delete also removes its sessions and transcripts.
 * Only projects the host knows to be git worktrees can be targeted, so a plugin can never remove a repository's own
 * project.
 * Returns null outside the project workspace, where the host has no project list.
 */
export function usePluginProjectActions():
  | ((projectPath: string, action: 'archive' | 'delete') => Promise<PluginProjectActionResult>)
  | null {
  const workspace = useOptionalProjectActions();
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const run = useCallback(async (projectPath: string, action: 'archive' | 'delete'): Promise<PluginProjectActionResult> => {
    const current = workspaceRef.current;
    if (!current) return { ok: false, error: 'Project actions are only available inside a project workspace' };
    if (typeof projectPath !== 'string' || !projectPath) return { ok: false, error: 'projectPath is required' };
    const target = normalize(projectPath);
    const project = current.projects.find((candidate) => normalize(candidate.fullPath || candidate.path || '') === target);
    if (!project) return { ok: false, error: `No project at ${projectPath}` };
    // Plugins may only clean up the worktrees they created, never a repository's own project and its sessions.
    // `worktreeOf` is set by the host for linked git worktrees (live, or removed in the <repo>-worktrees layout).
    if (typeof project.worktreeOf !== 'string' || !project.worktreeOf) {
      return { ok: false, error: `${projectPath} is not a git worktree project; plugins can only archive or delete worktree projects` };
    }
    const response = await api.deleteProject(project.projectId, action === 'delete');
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return { ok: false, error: readApiErrorMessage(body) ?? `Request failed (${response.status})` };
    }
    // Same local cleanup as the sidebar: drop it (leaving it first if it is selected), then resync.
    current.removeProject?.(project.projectId);
    await current.refresh();
    return { ok: true };
  }, []);

  return workspace ? run : null;
}

/**
 * What plugin UIs get as `archiveSession(sessionId)` / `deleteSession(sessionId)`: the sidebar's per-session archive
 * (hidden, restorable) and delete (row and transcript), under the signed-in user, followed by a sidebar refresh. For
 * sessions that share a project with others (e.g. a read-only agent working in another session's directory), where
 * archiving the whole project would hide unrelated sessions. Null outside the project workspace.
 */
export function usePluginSessionActions():
  | ((sessionId: string, action: 'archive' | 'delete') => Promise<PluginProjectActionResult>)
  | null {
  const workspace = useOptionalProjectActions();
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const run = useCallback(async (sessionId: string, action: 'archive' | 'delete'): Promise<PluginProjectActionResult> => {
    const current = workspaceRef.current;
    if (!current) return { ok: false, error: 'Session actions are only available inside a project workspace' };
    if (typeof sessionId !== 'string' || !sessionId) return { ok: false, error: 'sessionId is required' };
    const response = await api.deleteSession(sessionId, action === 'delete');
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return { ok: false, error: readApiErrorMessage(body) ?? `Request failed (${response.status})` };
    }
    // Remove it locally before refreshing: the refresh merges loaded session pages and would otherwise put an
    // archived or deleted session back. This also leaves it if it was the selected session.
    current.removeSession?.(sessionId);
    await current.refresh();
    return { ok: true };
  }, []);

  return workspace ? run : null;
}
