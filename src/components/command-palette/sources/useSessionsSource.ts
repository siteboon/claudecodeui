import { authenticatedFetch } from '../../../utils/api';
import type { LLMProvider, ProjectSession } from '../../../types/app';

import { useApiSource } from './useApiSource';

export type SessionResult = {
  id: string;
  label: string;
  provider?: LLMProvider;
};

interface SessionsResponse {
  sessions?: ProjectSession[];
  cursorSessions?: ProjectSession[];
  codexSessions?: ProjectSession[];
  geminiSessions?: ProjectSession[];
}

export function useSessionsSource(projectId: string | undefined, enabled: boolean) {
  return useApiSource<SessionResult, SessionsResponse>({
    enabled: enabled && !!projectId,
    deps: [projectId],
    fetcher: (signal) => {
      const params = new URLSearchParams({ limit: '50', offset: '0' });
      return authenticatedFetch(
        `/api/projects/${encodeURIComponent(projectId!)}/sessions?${params.toString()}`,
        { signal },
      );
    },
    parse: (data) => {
      const all: ProjectSession[] = [
        ...(data.sessions ?? []),
        ...(data.cursorSessions ?? []),
        ...(data.codexSessions ?? []),
        ...(data.geminiSessions ?? []),
      ];
      return all.map<SessionResult>((s) => ({
        id: s.id,
        label: (s.title || s.summary || s.name || s.id) as string,
        provider: s.__provider,
      }));
    },
  });
}
