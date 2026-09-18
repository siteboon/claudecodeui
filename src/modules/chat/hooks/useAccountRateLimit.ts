import { useSyncExternalStore } from 'react';

import type { RateLimitInfo } from '@/shared/types';

/**
 * The account's subscription quota, held outside React.
 *
 * Deliberately not part of the per-session chat state next to `tokenBudget`:
 * that number describes one session's context window and is reset on every
 * session switch, while this one describes the account and is the same in every
 * session. Keeping it here means switching chats does not blank it, and a
 * quota update that arrives while another session is streaming still counts.
 *
 * The SDK emits `rate_limit_event` only when something changes — the first one
 * lands before the run's `system init` — so the last value received is the
 * current one; there is nothing to recompute per turn and nothing to expect per
 * turn either. A freshly loaded page shows nothing until the first run reports.
 */
let current: RateLimitInfo | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function getAccountRateLimit(): RateLimitInfo | null {
  return current;
}

export function setAccountRateLimit(next: RateLimitInfo | null): void {
  current = next;
  for (const listener of listeners) {
    listener();
  }
}

/** Reads the account quota and re-renders when it moves. */
export function useAccountRateLimit(): RateLimitInfo | null {
  return useSyncExternalStore(subscribe, getAccountRateLimit, () => null);
}
