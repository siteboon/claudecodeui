import type { LLMProvider, Project, ProjectSession } from '../types/app';

export interface SessionLookupResult {
  project: Project;
  session: ProjectSession;
  provider: LLMProvider;
}

const PROVIDER_KEYS = [
  ['sessions', 'claude'],
  ['cursorSessions', 'cursor'],
  ['codexSessions', 'codex'],
  ['geminiSessions', 'gemini'],
] as const;

/**
 * Pure lookup: find which project owns a given session id and under which
 * provider bucket it lives. Returns null when the session is not yet known
 * (e.g., a JSONL write just landed but projects haven't refetched).
 *
 * This used to live as an inline four-provider walk in `useProjectsState`'s
 * sync-from-URL effect. Pulling it out so multi-pane code can resolve any
 * pane's session without reaching into the projects-state hook.
 */
export function lookupSessionInProjects(
  projects: readonly Project[],
  sessionId: string | null | undefined,
): SessionLookupResult | null {
  if (!sessionId || projects.length === 0) return null;

  for (const project of projects) {
    for (const [key, provider] of PROVIDER_KEYS) {
      const list = (project as unknown as Record<string, ProjectSession[] | undefined>)[key];
      if (!list) continue;
      const match = list.find((session) => session.id === sessionId);
      if (match) {
        return { project, session: match, provider };
      }
    }
  }

  return null;
}

/**
 * Same lookup with the `__provider` field stamped onto the returned session,
 * matching the shape `selectedSession` has held historically. Used by code
 * paths that push the result into `useProjectsState.selectedSession`.
 */
export function lookupSessionWithProviderStamp(
  projects: readonly Project[],
  sessionId: string | null | undefined,
): { project: Project; session: ProjectSession } | null {
  const result = lookupSessionInProjects(projects, sessionId);
  if (!result) return null;
  return {
    project: result.project,
    session: { ...result.session, __provider: result.provider },
  };
}
