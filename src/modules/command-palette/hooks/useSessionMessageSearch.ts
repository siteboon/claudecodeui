import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { LLMProvider } from '@/shared/types';

export type SessionMessageMatch = {
  sessionId: string;
  label: string;
  snippet: string;
  provider: LLMProvider;
};

type ProjectResult = {
  projectId: string | null;
  projectName: string;
  sessions: Array<{
    sessionId: string;
    provider: LLMProvider;
    sessionSummary: string;
    matches: Array<{ snippet: string }>;
  }>;
};

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

function subscribeToSessionMessageSearch(
  url: string,
  onProjectResult: (result: ProjectResult) => void,
) {
  const source = new EventSource(url);

  const handleResult = (event: Event) => {
    try {
      const data = JSON.parse((event as MessageEvent<string>).data) as {
        projectResult: ProjectResult;
      };
      onProjectResult(data.projectResult);
    } catch {
      // Ignore malformed stream events.
    }
  };
  const close = () => source.close();

  source.addEventListener('result', handleResult);
  source.addEventListener('done', close);
  source.addEventListener('error', close);

  return () => {
    source.removeEventListener('result', handleResult);
    source.removeEventListener('done', close);
    source.removeEventListener('error', close);
    source.close();
  };
}

export function useSessionMessageSearch(
  projectId: string | undefined,
  query: string,
  enabled: boolean,
) {
  const [items, setItems] = useState<SessionMessageMatch[]>([]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || !projectId || trimmed.length < MIN_QUERY) {
      setItems([]);
      return;
    }

    let cancelled = false;
    let stopSearch: (() => void) | null = null;

    const handle = setTimeout(() => {
      const url = api.searchConversationsUrl(trimmed);
      const accumulated: SessionMessageMatch[] = [];

      stopSearch = subscribeToSessionMessageSearch(url, (projectResult) => {
        if (cancelled || projectResult.projectId !== projectId) {
          return;
        }
        for (const session of projectResult.sessions) {
          accumulated.push({
            sessionId: session.sessionId,
            label: session.sessionSummary || session.sessionId,
            snippet: session.matches[0]?.snippet ?? '',
            provider: session.provider,
          });
        }
        setItems([...accumulated]);
      });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(handle);
      if (stopSearch) {
        stopSearch();
      }
    };
  }, [projectId, query, enabled]);

  return items;
}
