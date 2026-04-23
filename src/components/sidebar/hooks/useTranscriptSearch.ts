import { useEffect, useRef, useState } from 'react';

import { api } from '../../../utils/api';

import {
  flattenProjectResults,
  type ConversationProjectResult,
  type TranscriptSessionResult,
} from './transcriptSearchData';

export type {
  TranscriptMatchHighlight,
  TranscriptMatch,
  TranscriptSessionResult,
} from './transcriptSearchData';

/**
 * Hook: drive the /api/search/conversations SSE endpoint from the Ctrl+K
 * command palette. Mirrors the debounce + seq-abort + manual es.close()
 * pattern established in useSidebarController — stays at one live
 * EventSource at any time.
 *
 * MVP scope: flatten projectResult → sessions[] into a single row per
 * session keeping only matches[0]. Per-match drilldown and highlight
 * rendering are deliberately out of scope (see plan §8).
 */

export type UseTranscriptSearchOptions = {
  query: string;
  enabled: boolean;
  minChars?: number;
  limit?: number;
};

export type UseTranscriptSearchResult = {
  results: TranscriptSessionResult[];
  isSearching: boolean;
};

const DEFAULT_MIN_CHARS = 3;
const DEFAULT_LIMIT = 20;
const DEBOUNCE_MS = 400;

export function useTranscriptSearch({
  query,
  enabled,
  minChars = DEFAULT_MIN_CHARS,
  limit = DEFAULT_LIMIT,
}: UseTranscriptSearchOptions): UseTranscriptSearchResult {
  const [results, setResults] = useState<TranscriptSessionResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Every re-run: drop any in-flight debounce or SSE from the previous query.
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const trimmed = query.trim();
    if (!enabled || trimmed.length < minChars) {
      searchSeqRef.current += 1;
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const seq = ++searchSeqRef.current;

    searchTimeoutRef.current = setTimeout(() => {
      if (seq !== searchSeqRef.current) return;

      const url = api.searchConversationsUrl(trimmed, limit);
      const es = new EventSource(url);
      eventSourceRef.current = es;

      const accumulated: ConversationProjectResult[] = [];

      es.addEventListener('result', (evt) => {
        if (seq !== searchSeqRef.current) { es.close(); return; }
        try {
          const data = JSON.parse((evt as MessageEvent).data) as {
            projectResult: ConversationProjectResult;
          };
          accumulated.push(data.projectResult);
          setResults(flattenProjectResults(accumulated));
        } catch {
          // Ignore malformed SSE payloads — keep streaming.
        }
      });

      es.addEventListener('done', () => {
        if (seq !== searchSeqRef.current) { es.close(); return; }
        es.close();
        eventSourceRef.current = null;
        setIsSearching(false);
      });

      es.addEventListener('error', () => {
        if (seq !== searchSeqRef.current) { es.close(); return; }
        es.close();
        eventSourceRef.current = null;
        setIsSearching(false);
      });
    }, DEBOUNCE_MS);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [query, enabled, minChars, limit]);

  return { results, isSearching };
}
