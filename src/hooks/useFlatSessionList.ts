import { useMemo } from 'react';
import type { Project, SessionStatus, LLMProvider } from '../types/app';
import type { SessionWithProvider, AdditionalSessionsByProject } from '../components/sidebar/types/types';
import { getAllSessions, getSessionDate } from '../components/sidebar/utils/utils';

export type FlatSession = SessionWithProvider & {
  __projectName: string;
  __projectDisplayName: string;
  __status: SessionStatus;
  __sortRank: number;
};

function deriveStatus(
  sessionId: string,
  statusMap: Map<string, SessionStatus>,
  sessionDate: Date,
): SessionStatus {
  const explicit = statusMap.get(sessionId);
  if (explicit) return explicit;

  // Sessions active within the last hour are "idle", older ones are "done"
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  return sessionDate.getTime() > oneHourAgo ? 'idle' : 'done';
}

function sortRank(status: SessionStatus): number {
  switch (status) {
    case 'waiting':
    case 'error':
      return 0;
    case 'running':
      return 1;
    case 'idle':
    case 'done':
    default:
      return 2;
  }
}

type UseFlatSessionListArgs = {
  projects: Project[];
  activeProjectFilter: string | null; // project name, or null for all
  searchFilter: string;
  statusMap: Map<string, SessionStatus>;
  additionalSessions: AdditionalSessionsByProject;
};

export function useFlatSessionList({
  projects,
  activeProjectFilter,
  searchFilter,
  statusMap,
  additionalSessions,
}: UseFlatSessionListArgs): FlatSession[] {
  return useMemo(() => {
    const flat: FlatSession[] = [];
    const normalizedSearch = searchFilter.trim().toLowerCase();

    const filteredProjects = activeProjectFilter
      ? projects.filter((p) => p.name === activeProjectFilter)
      : projects;

    for (const project of filteredProjects) {
      const sessions = getAllSessions(project, additionalSessions);

      for (const session of sessions) {
        const sessionDate = getSessionDate(session);
        const status = deriveStatus(session.id, statusMap, sessionDate);
        const rank = sortRank(status);

        const sessionName = (
          session.summary || session.name || session.title || ''
        ).toLowerCase();
        const projectName = project.name.toLowerCase();
        const projectDisplay = (project.displayName || project.name).toLowerCase();

        if (
          normalizedSearch &&
          !sessionName.includes(normalizedSearch) &&
          !projectName.includes(normalizedSearch) &&
          !projectDisplay.includes(normalizedSearch)
        ) {
          continue;
        }

        flat.push({
          ...session,
          __projectName: project.name,
          __projectDisplayName: project.displayName || project.name,
          __status: status,
          __sortRank: rank,
        });
      }
    }

    // Sort: attention first (rank 0), then running (1), then idle/done (2).
    // Within each rank, sort by date descending (most recent first).
    flat.sort((a, b) => {
      if (a.__sortRank !== b.__sortRank) {
        return a.__sortRank - b.__sortRank;
      }
      return getSessionDate(b).getTime() - getSessionDate(a).getTime();
    });

    return flat;
  }, [projects, activeProjectFilter, searchFilter, statusMap, additionalSessions]);
}
