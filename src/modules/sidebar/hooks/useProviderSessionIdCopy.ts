import { useCallback, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { api } from '@/shared/api';
import { copyTextToClipboard } from '@/shared/utils';

type CopyState = 'loading' | 'idle' | 'copying' | 'copied' | 'error';

/**
 * The provider session id behind a session row's "copy id" action.
 *
 * The id is not on the session object — it costs a request — so it is fetched
 * when the menu opens rather than for every row in the list, and dropped when
 * the menu closes so a stale id is never copied. Requests carry a sequence so a
 * reply that arrives after the menu moved on is discarded.
 *
 * `setOptionsOpen` and `reset` are stable for a given session: ActionMenu takes
 * the former as `onOpenChange` and depends on it in two document-listener
 * effects, which would otherwise be torn down and rebuilt on every keystroke.
 */
export function useProviderSessionIdCopy(sessionId: string, providerLabel: string) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [providerSessionId, setProviderSessionId] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setCopyState('loading');
    try {
      const response = await api.providerSessionId(sessionId);
      const payload = await response.json();
      const loadedSessionId = payload?.data?.sessionId;
      if (!response.ok || typeof loadedSessionId !== 'string' || !loadedSessionId) {
        throw new Error('Provider session ID is unavailable');
      }

      if (requestId !== requestRef.current) return;
      setProviderSessionId(loadedSessionId);
      setCopyState('idle');
    } catch {
      if (requestId !== requestRef.current) return;
      setProviderSessionId(null);
      setCopyState('error');
    }
  }, [sessionId]);

  const reset = useCallback(() => {
    requestRef.current += 1;
    setCopyState('idle');
    setProviderSessionId(null);
  }, []);

  const setOptionsOpen = useCallback((open: boolean) => {
    if (open) {
      setProviderSessionId(null);
      void load();
    } else {
      reset();
    }
  }, [load, reset]);

  const copy = useCallback(async () => {
    if (!providerSessionId) {
      setCopyState('error');
      return;
    }

    setCopyState('copying');
    const didCopy = await copyTextToClipboard(providerSessionId);
    setCopyState(didCopy ? 'copied' : 'error');
  }, [providerSessionId]);

  // A failed fetch leaves nothing to copy, so the same control retries the
  // fetch instead; a failed clipboard write has an id and retries the write.
  const handleCopyAction = useCallback(() => {
    if (copyState === 'error' && !providerSessionId) {
      void load();
    } else {
      void copy();
    }
  }, [copy, copyState, load, providerSessionId]);

  const copyLabel = copyState === 'loading'
    ? `Loading ${providerLabel} session ID…`
    : copyState === 'copied'
      ? `${providerLabel} session ID copied`
      : copyState === 'error'
        ? providerSessionId
          ? `Couldn't copy ${providerLabel} session ID`
          : `${providerLabel} session ID unavailable`
        : `Copy ${providerLabel} session ID`;

  return {
    copyState,
    copyLabel,
    setOptionsOpen,
    handleCopyAction,
    isCopyPending: copyState === 'loading' || copyState === 'copying',
    CopyStateIcon: copyState === 'copied' ? Check : Copy,
  };
}
