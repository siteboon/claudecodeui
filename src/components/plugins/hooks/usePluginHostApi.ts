import { useMemo } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { Project } from '../../../types/app';
import {
  buildPluginHostRequestInit,
  normalizePluginHostPath,
  type PluginHostApi,
} from '../utils/pluginHostRequest';

type PluginHostApiOptions = {
  /** Opens a new chat for the project — the host's own "new session" action. */
  onStartNewSession: (project: Project) => void;
  /** Navigates to an existing session. */
  onOpenSession: (sessionId: string) => void;
};

/**
 * The sanctioned way for a plugin to reach the host.
 *
 * Without it, a plugin that needs host data has to read the JWT out of
 * `localStorage['auth-token']` — which the plugin documentation simultaneously
 * demonstrates and forbids. Here the host performs the request itself, so the
 * plugin never sees a credential.
 */
export function usePluginHostApi({ onStartNewSession, onOpenSession }: PluginHostApiOptions): PluginHostApi {
  return useMemo<PluginHostApi>(() => ({
    async fetch(path, init) {
      const safePath = normalizePluginHostPath(path);
      if (!safePath) {
        throw new Error(`Blocked plugin host request: only GET requests under /api/ are allowed (got "${String(path)}")`);
      }
      return authenticatedFetch(safePath, buildPluginHostRequestInit(init));
    },

    startNewSession(projectId) {
      // Plugins address projects by id; the host's action needs the project record.
      void (async () => {
        try {
          const response = await authenticatedFetch('/api/projects?skipSync=1');
          if (!response.ok) return;
          const payload: unknown = await response.json();
          const projects = (Array.isArray(payload) ? payload : []) as Project[];
          const project = projects.find((candidate) => candidate.projectId === projectId);
          if (project) onStartNewSession(project);
        } catch {
          // Navigation is best-effort: a failed lookup leaves the UI untouched.
        }
      })();
    },

    openSession(_projectId, sessionId) {
      if (typeof sessionId === 'string' && sessionId) onOpenSession(sessionId);
    },
  }), [onOpenSession, onStartNewSession]);
}
