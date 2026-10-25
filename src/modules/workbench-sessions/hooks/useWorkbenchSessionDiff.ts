import { useCallback, useEffect, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type { WorkbenchSessionDiff } from '@/shared/types';
import { getErrorText } from '@/shared/utils';

type DiffState = {
  diff: WorkbenchSessionDiff | null;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
};

/**
 * Loads a session's diff and reloads it whenever `changeKey` changes, so the panel follows the
 * agent's edits (the caller derives the key from the polled dirty-file and commit counts).
 */
export function useWorkbenchSessionDiff(sessionId: string, changeKey: string): DiffState {
  // Last successfully loaded diff; kept while a reload runs so the panel does not flash empty.
  const [diff, setDiff] = useState<WorkbenchSessionDiff | null>(null);
  // True only for the initial load of a session; reloads stay quiet.
  const [isLoading, setIsLoading] = useState(true);
  // Message of the last failed load, cleared by the next success.
  const [error, setError] = useState<string | null>(null);
  // Bumped by `reload()` to force a fetch when nothing in the polled state changed (manual refresh).
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await api.workbench.diff(sessionId);
        const body = await readApiJson<{ data: WorkbenchSessionDiff }>(response);
        if (!cancelled) {
          setDiff(body.data);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) setError(getErrorText(loadError));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, changeKey, reloadTick]);

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), []);
  return { diff, isLoading, error, reload };
}
