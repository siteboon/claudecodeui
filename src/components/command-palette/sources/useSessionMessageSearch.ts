import { useEffect, useRef, useState } from 'react';

import { api } from '../../../utils/api';
import type { LLMProvider } from '../../../types/app';

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

export function useSessionMessageSearch(
  projectId: string | undefined,
  query: string,
  enabled: boolean,
) {
  const [items, setItems] = useState<SessionMessageMatch[]>([]);
  const seqRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || !projectId || trimmed.length < MIN_QUERY) {
      setItems([]);
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    esRef.current?.close();
    esRef.current = null;
    seqRef.current++;

    const handle = setTimeout(() => {
      const seq = ++seqRef.current;
      const url = api.searchConversationsUrl(trimmed);
      const es = new EventSource(url);
      esRef.current = es;
      const accumulated: SessionMessageMatch[] = [];

      es.addEventListener('result', (evt) => {
        if (seq !== seqRef.current) {
          es.close();
          return;
        }
        try {
          const data = JSON.parse((evt as MessageEvent).data) as { projectResult: ProjectResult };
          const pr = data.projectResult;
          if (pr.projectId !== projectId) return;
          for (const s of pr.sessions) {
            accumulated.push({
              sessionId: s.sessionId,
              label: s.sessionSummary || s.sessionId,
              snippet: s.matches[0]?.snippet ?? '',
              provider: s.provider,
            });
          }
          setItems([...accumulated]);
        } catch {
          // ignore malformed
        }
      });

      const finish = () => {
        if (seq !== seqRef.current) return;
        es.close();
        esRef.current = null;
      };
      es.addEventListener('done', finish);
      es.addEventListener('error', finish);
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(handle);
    };
  }, [projectId, query, enabled]);

  useEffect(() => {
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);

  return items;
}
