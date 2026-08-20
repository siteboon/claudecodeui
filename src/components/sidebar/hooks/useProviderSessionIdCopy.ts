import { useCallback, useRef, useState } from 'react';
import { Check, Copy, type LucideIcon } from 'lucide-react';

import { api } from '../../../utils/api';
import { copyTextToClipboard } from '../../../utils/clipboard';

type CopyState = 'loading' | 'idle' | 'copying' | 'copied' | 'error';

export type ProviderSessionIdCopy = {
  /** Action label, which doubles as the status line while loading or copying. */
  label: string;
  icon: LucideIcon;
  isPending: boolean;
  hasCopied: boolean;
  hasFailed: boolean;
  /** Copies, or retries the fetch when that is what failed. */
  copy: () => void;
  /** Wire to a menu or sheet's open change: primes the id, and resets on close. */
  setOpen: (open: boolean) => void;
};

/**
 * Loads a session's provider-side id and copies it to the clipboard, keeping the
 * label in step with what is happening. Shared by the session rows in the
 * Projects list and the Conversations list, which offer the same action.
 */
export function useProviderSessionIdCopy(
  sessionId: string,
  providerLabel: string,
): ProviderSessionIdCopy {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [providerSessionId, setProviderSessionId] = useState<string | null>(null);
  const requestRef = useRef(0);

  const loadProviderSessionId = useCallback(async () => {
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

  // Stable across renders: ActionMenu feeds onOpenChange into a useCallback that
  // two document-listener effects depend on, so a fresh identity per render
  // would re-register those listeners for as long as the menu is open.
  const setOpen = useCallback((open: boolean) => {
    if (open) {
      setProviderSessionId(null);
      void loadProviderSessionId();
      return;
    }

    // Drop the in-flight request's result as well as the state it would land in.
    requestRef.current += 1;
    setCopyState('idle');
    setProviderSessionId(null);
  }, [loadProviderSessionId]);

  const copyProviderSessionId = useCallback(async () => {
    if (!providerSessionId) {
      setCopyState('error');
      return;
    }

    setCopyState('copying');
    const didCopy = await copyTextToClipboard(providerSessionId);
    setCopyState(didCopy ? 'copied' : 'error');
  }, [providerSessionId]);

  const copy = useCallback(() => {
    // Distinguish the two failures: nothing to copy means the fetch is what
    // needs retrying, otherwise it was the clipboard that refused.
    if (copyState === 'error' && !providerSessionId) {
      void loadProviderSessionId();
    } else {
      void copyProviderSessionId();
    }
  }, [copyProviderSessionId, copyState, loadProviderSessionId, providerSessionId]);

  const label = copyState === 'loading'
    ? `Loading ${providerLabel} session ID…`
    : copyState === 'copied'
      ? `${providerLabel} session ID copied`
      : copyState === 'error'
        ? providerSessionId
          ? `Couldn't copy ${providerLabel} session ID`
          : `${providerLabel} session ID unavailable`
        : `Copy ${providerLabel} session ID`;

  return {
    label,
    icon: copyState === 'copied' ? Check : Copy,
    isPending: copyState === 'loading' || copyState === 'copying',
    hasCopied: copyState === 'copied',
    hasFailed: copyState === 'error',
    copy,
    setOpen,
  };
}
