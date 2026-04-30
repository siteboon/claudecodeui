import { useEffect, useState } from 'react';

import { api } from '../../../utils/api';
import type { LLMProvider, ProjectSession } from '../../../types/app';

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
  const [items, setItems] = useState<SessionResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !projectId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    api
      .projectSessions(projectId, { limit: 50 })
      .then((r) => r.json() as Promise<SessionsResponse>)
      .then((data) => {
        if (cancelled) return;
        const all: ProjectSession[] = [
          ...(data.sessions ?? []),
          ...(data.cursorSessions ?? []),
          ...(data.codexSessions ?? []),
          ...(data.geminiSessions ?? []),
        ];
        setItems(
          all.map<SessionResult>((s) => ({
            id: s.id,
            label: (s.title || s.summary || s.name || s.id) as string,
            provider: s.__provider,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled]);

  return { items, isLoading };
}
