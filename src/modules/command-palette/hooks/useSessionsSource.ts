import { api } from '@/shared/api';
import type { LLMProvider, ProjectSession } from '@/shared/types';
import { useApiSource } from '@/modules/command-palette/hooks/useApiSource';

export type SessionResult = {
  id: string;
  label: string;
  provider?: LLMProvider;
};

const SESSION_RESULT_LIMIT = 50;

type SessionsResponse = {
  sessions?: ProjectSession[];
};

export function useSessionsSource(projectId: string | undefined, enabled: boolean) {
  return useApiSource<SessionResult, SessionsResponse>({
    enabled: enabled && !!projectId,
    deps: [projectId],
    fetcher: (signal) =>
      api.projectSessions(projectId!, { limit: SESSION_RESULT_LIMIT, offset: 0 }, { signal }),
    parse: (data) => {
      return (data.sessions ?? []).map<SessionResult>((s) => ({
        id: s.id,
        label: (s.title || s.summary || s.name || s.id) as string,
        provider: (s.__provider || s.provider) as LLMProvider | undefined,
      }));
    },
  });
}
