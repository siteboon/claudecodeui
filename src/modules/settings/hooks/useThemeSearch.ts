import { useEffect, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type { ThemeSearchResult, ThemeSearchSort } from '@/shared/types';

/** Long enough to skip the requests a fast typist would make per keystroke. */
const SEARCH_DEBOUNCE_MS = 300;

type SettledSearch = { key: string; results: ThemeSearchResult[]; hasFailed: boolean };

type ThemeSearchState = {
  /** The latest settled results, kept while a newer search runs; null before the first. */
  results: ThemeSearchResult[] | null;
  isSearching: boolean;
  /** True when the current search, not an earlier one, could not be answered. */
  hasFailed: boolean;
};

/**
 * Searches Open VSX for colour themes as the add-theme dialog's query changes;
 * an empty query browses the whole category in `sort` order. Nothing is asked
 * while `isEnabled` is false. A search that changes again before its answer
 * arrives aborts that request, so a slow early answer never overwrites a later one.
 */
export function useThemeSearch(query: string, sort: ThemeSearchSort, isEnabled: boolean): ThemeSearchState {
  // The last answer and the search it answered; whether a search is running is
  // derived by comparing that search with the current one.
  const [settled, setSettled] = useState<SettledSearch | null>(null);

  const searchText = query.trim();
  const key = `${sort}\n${searchText}`;

  useEffect(() => {
    if (!isEnabled) {
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const { data } = await readApiJson<{ data: { extensions: ThemeSearchResult[] } }>(
          await api.themes.search(searchText, sort, controller.signal),
        );
        if (!controller.signal.aborted) {
          setSettled({ key, results: data.extensions, hasFailed: false });
        }
      } catch {
        if (!controller.signal.aborted) {
          setSettled({ key, results: [], hasFailed: true });
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isEnabled, key, searchText, sort]);

  if (!isEnabled) {
    return { results: null, isSearching: false, hasFailed: false };
  }
  const isCurrent = settled?.key === key;
  return {
    results: settled?.results ?? null,
    isSearching: !isCurrent,
    hasFailed: isCurrent && settled.hasFailed,
  };
}
