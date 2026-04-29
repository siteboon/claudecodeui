import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Detects app foreground/background transitions via the Page Visibility API.
 * Critical for mobile browsers where backgrounding kills WebSocket connections.
 */
export function useAppLifecycle() {
  const [isVisible, setIsVisible] = useState(() =>
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true
  );
  const backgroundTimestampRef = useRef<number | null>(null);
  const foregroundCallbacksRef = useRef<Set<(durationMs: number) => void>>(new Set());
  const backgroundCallbacksRef = useRef<Set<() => void>>(new Set());

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setIsVisible(visible);

      if (!visible) {
        backgroundTimestampRef.current = Date.now();
        backgroundCallbacksRef.current.forEach((cb) => {
          try { cb(); } catch (e) { console.error('[AppLifecycle] background callback error:', e); }
        });
      } else {
        const duration = backgroundTimestampRef.current
          ? Date.now() - backgroundTimestampRef.current
          : 0;
        backgroundTimestampRef.current = null;
        foregroundCallbacksRef.current.forEach((cb) => {
          try { cb(duration); } catch (e) { console.error('[AppLifecycle] foreground callback error:', e); }
        });
      }
    };

    // Handle bfcache restores (Safari/iOS)
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        const duration = backgroundTimestampRef.current
          ? Date.now() - backgroundTimestampRef.current
          : 0;
        backgroundTimestampRef.current = null;
        setIsVisible(true);
        foregroundCallbacksRef.current.forEach((cb) => {
          try { cb(duration); } catch (e) { console.error('[AppLifecycle] pageshow callback error:', e); }
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  const onForeground = useCallback((callback: (backgroundDurationMs: number) => void) => {
    foregroundCallbacksRef.current.add(callback);
    return () => { foregroundCallbacksRef.current.delete(callback); };
  }, []);

  const onBackground = useCallback((callback: () => void) => {
    backgroundCallbacksRef.current.add(callback);
    return () => { backgroundCallbacksRef.current.delete(callback); };
  }, []);

  return { isVisible, onForeground, onBackground };
}
