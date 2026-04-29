import { useEffect, useRef } from 'react';

/**
 * Requests a screen Wake Lock to keep WebSocket connections alive during brief
 * app switches on mobile (notification shade, task switcher preview, etc.).
 *
 * Only activates when `shouldLock` is true (e.g., an agent session is processing).
 * Automatically re-acquires the lock on foreground resume since the browser
 * releases it when the page becomes hidden.
 */
export function useWakeLock(shouldLock: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!shouldLock || !('wakeLock' in navigator)) return;

    let released = false;

    const requestLock = async () => {
      try {
        if (released) return;
        const sentinel = await navigator.wakeLock.request('screen');
        // If cleanup ran while awaiting, release immediately
        if (released) {
          await sentinel.release().catch(() => {});
          return;
        }
        wakeLockRef.current = sentinel;
        sentinel.addEventListener('release', () => {
          // Only clear ref if it still holds this sentinel (not a newer one)
          if (wakeLockRef.current === sentinel) {
            wakeLockRef.current = null;
          }
        });
      } catch (_) {
        // Wake Lock request can fail (low battery, permission denied, etc.)
      }
    };

    // Re-acquire on foreground resume (browser releases lock on background)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !released) {
        requestLock();
      }
    };

    requestLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [shouldLock]);
}
