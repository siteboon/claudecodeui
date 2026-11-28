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
 * These are exactly as destructive as the sidebar's actions: plugins run with full trust in the page and are expected
 * to confirm with the user before deleting.
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
    let response: Response;
    try {
      response = await api.deleteProject(project.projectId, action === 'delete');
    } catch (error) {
      // A transport failure (offline, connection reset) is still a result, never a rejection; no automatic retry.
      return { ok: false, error: error instanceof Error ? error.message : 'Request failed' };
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return { ok: false, error: readApiErrorMessage(body) ?? `Request failed (${response.status})` };
    }
    // Same local cleanup as the sidebar: drop it (leaving it first if it is selected), then resync.
    // Read the workspace again: the selection may have changed while the request was pending, and the sidebar's
    // cleanup callback compares against the selection it was created with.
    const latest = workspaceRef.current ?? current;
    latest.removeProject?.(project.projectId);
    await latest.refresh();
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
    let response: Response;
    try {
      response = await api.deleteSession(sessionId, action === 'delete');
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Request failed' };
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return { ok: false, error: readApiErrorMessage(body) ?? `Request failed (${response.status})` };
    }
    // Remove it locally before refreshing: the refresh merges loaded session pages and would otherwise put an
    // archived or deleted session back. This also leaves it if it was the selected session.
    const latest = workspaceRef.current ?? current;
    latest.removeSession?.(sessionId);
    await latest.refresh();
    return { ok: true };
  }, []);

  return workspace ? run : null;
}
