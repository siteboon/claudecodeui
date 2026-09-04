import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { safeLocalStorage } from '@/modules/chat/utils/chatStorage';
import { api } from '@/shared/api';

import { getIsPWA } from '@/shared/hooks/useDeviceSettings';

export const LAST_SESSION_STORAGE_KEY = 'last-session-id';

export type RestoreCheck = { kind: 'none' } | { kind: 'verify'; sessionId: string };

export function resolveRestoreCheck(input: {
  isPWA: boolean;
  urlSessionId?: string;
  storedSessionId?: string;
}): RestoreCheck {
  // The URL already points at a session (deep link, notification window) —
  // nothing to restore.
  if (input.urlSessionId) {
    return { kind: 'none' };
  }
  // Regular browser tabs keep their URL across reloads; restoring on launch
  // is a PWA-only concern (the OS relaunches standalone apps at start_url).
  if (!input.isPWA || !input.storedSessionId) {
    return { kind: 'none' };
  }
  return { kind: 'verify', sessionId: input.storedSessionId };
}

export type VerifiedRestoreAction = 'navigate' | 'forget' | 'keep';

export function resolveVerifiedRestore(lookupOk: boolean | null): VerifiedRestoreAction {
  if (lookupOk === null) {
    // Network/server error — keep the memory so the next cold start retries.
    return 'keep';
  }
  return lookupOk ? 'navigate' : 'forget';
}

// Module-level so the one-shot restore survives React 18 StrictMode double
// mounts and is not re-attempted after the user later returns home manually.
let restoreAttempted = false;
let restoreLookupInFlight = false;

export function useLastSessionRestore({ sessionId }: { sessionId?: string }) {
  const navigate = useNavigate();
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // This effect must stay declared BEFORE the remember effect below: on a PWA
  // cold start the app mounts at `/`, and the remember effect would otherwise
  // forget the stored id before the restore gets to read it.
  useEffect(() => {
    if (restoreAttempted) {
      return;
    }
    restoreAttempted = true;

    const check = resolveRestoreCheck({
      isPWA: getIsPWA(),
      urlSessionId: sessionId,
      storedSessionId: safeLocalStorage.getItem(LAST_SESSION_STORAGE_KEY) ?? undefined,
    });
    if (check.kind === 'none') {
      return;
    }

    restoreLookupInFlight = true;
    void (async () => {
      let lookupOk: boolean | null = null;
      try {
        lookupOk = (await api.sessionDetails(check.sessionId)).ok;
      } catch {
        lookupOk = null;
      } finally {
        restoreLookupInFlight = false;
      }

      // The user opened a session manually while the lookup was in flight —
      // never yank them away from it.
      if (sessionIdRef.current) {
        return;
      }

      switch (resolveVerifiedRestore(lookupOk)) {
        case 'navigate':
          navigate(`/session/${check.sessionId}`, { replace: true });
          break;
        case 'forget':
          safeLocalStorage.removeItem(LAST_SESSION_STORAGE_KEY);
          break;
        default:
          break;
      }
    })();
  }, [navigate, sessionId]);

  // Persist the viewed session so the next PWA cold start can come back to
  // it. Leaving the session route (New Session, project switch) forgets it,
  // so an explicit return home is not overridden on the next launch. While
  // the restore lookup is in flight the app sits at `/` without user intent —
  // skip the removal so a temporarily unreachable server can retry later.
  useEffect(() => {
    if (sessionId) {
      safeLocalStorage.setItem(LAST_SESSION_STORAGE_KEY, sessionId);
      return;
    }
    if (restoreLookupInFlight) {
      return;
    }
    safeLocalStorage.removeItem(LAST_SESSION_STORAGE_KEY);
  }, [sessionId]);
}
