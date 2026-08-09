import { useEffect, useRef, useState } from 'react';

const GUARD_STATE_KEY = '__sessionListBackGuard';

type UseBackButtonSidebarArgs = {
  enabled: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  /** react-router location key — changes on every push/replace navigation. */
  locationKey: string;
};

const isSentinelState = (state: unknown): boolean => (
  typeof state === 'object'
  && state !== null
  && (state as Record<string, unknown>)[GUARD_STATE_KEY] === true
);

/**
 * Turns the device back gesture into "show the session list", so sessions can
 * be switched with one thumb instead of reaching for the menu button.
 *
 * The browser gives no way to observe a back press without consuming a history
 * entry, so we keep a sentinel entry on top of the stack: the first back press
 * pops the sentinel instead of navigating, and we translate that pop into
 * opening the sidebar, then re-arm.
 *
 * Whether the sentinel is still on top is read off `history.state` rather than
 * tracked by URL: react-router builds a fresh state object on every push and
 * replace and never copies our marker, so the marker's absence is an exact
 * "the router pushed over the sentinel (or replaced it), re-arm" signal. A URL
 * comparison would miss it, because several navigations here target the URL we
 * are already on (`navigate('/')` in useProjectsState on project select, new
 * session, and deletes).
 *
 * Back pressed while the sidebar is open closes it and deliberately does NOT
 * re-arm — that keeps a genuine back press one tap away so the user can still
 * leave the app. That latch is released by a change of URL, not of
 * `location.key`: pushing sentinels behind react-router's back makes its `idx`
 * bookkeeping drift, so it mints a fresh key when our own sentinel is popped,
 * which would release the latch immediately and trap the user in the app.
 *
 * Two limitations are inherent to the sentinel approach and accepted:
 * `pushState` drops forward history, so the forward gesture stops working
 * while the option is on; and because the sentinel is always the top entry,
 * `navigate(..., { replace: true })` replaces the sentinel instead of the entry
 * the caller meant to drop (e.g. the alias URL in useProjectsState).
 */
export function useBackButtonSidebar({
  enabled,
  sidebarOpen,
  setSidebarOpen,
  locationKey,
}: UseBackButtonSidebarArgs) {
  const armedRef = useRef(false);
  const armedHrefRef = useRef('');
  const closedByBackRef = useRef(false);
  const closedByBackHrefRef = useRef('');
  // True while a `history.back()` we issued ourselves is in flight. Its popstate
  // is indistinguishable from a user press otherwise, and mistaking it for one
  // makes a single press both navigate and open the list.
  const skippingRef = useRef(false);
  // Bumped when a skip finishes, so the arming effect re-runs even though the
  // landing entry may carry the router key we started from.
  const [skipCompleted, setSkipCompleted] = useState(0);


  useEffect(() => {
    // Arming is deferred by a task rather than done inline. React-router
    // handles `popstate` before this hook's listener and re-renders
    // synchronously, which flushes this effect in the middle of that same
    // dispatch — arming inline would push a fresh sentinel that the listener
    // then misreads as "the user popped my sentinel", opening the list on what
    // was a genuine back navigation.
    const armSentinel = () => {
      if (closedByBackRef.current && window.location.href !== closedByBackHrefRef.current) {
        // Left the screen the escape hatch was granted on, so it no longer
        // applies. Without this the hook stays disarmed for the rest of the
        // session and back drops the user out of whatever they open next.
        closedByBackRef.current = false;
      }

      if (skippingRef.current) {
        // Mid-skip the stack is still moving; arming now would push a sentinel
        // onto an entry we are about to leave.
        return;
      }

      if (!enabled) {
        return;
      }

      if (sidebarOpen) {
        closedByBackRef.current = false;
      }

      if (closedByBackRef.current) {
        return;
      }

      if (isSentinelState(window.history.state)) {
        armedRef.current = true;
        armedHrefRef.current = window.location.href;
        return;
      }

      // Clone the current state so react-router's own bookkeeping (`key`, `idx`)
      // survives onto the sentinel entry and popping it stays a no-op navigation.
      try {
        window.history.pushState(
          { ...(window.history.state as object | null), [GUARD_STATE_KEY]: true },
          '',
        );
      } catch {
        // Safari throttles pushState (~100 calls / 30s) and throws when it
        // trips. Staying unarmed just means back navigates normally until the
        // next attempt.
        return;
      }

      armedRef.current = true;
      armedHrefRef.current = window.location.href;
    };

    const timer = window.setTimeout(armSentinel, 0);

    return () => window.clearTimeout(timer);
  }, [enabled, locationKey, sidebarOpen, skipCompleted]);

  useEffect(() => {
    const skipBack = () => {
      armedRef.current = false;
      skippingRef.current = true;
      window.history.back();
    };

    const handlePopState = () => {
      // Each router push strands the sentinel it was pushed over. Such a buried
      // sentinel duplicates the entry below it (same URL, same router key), so
      // landing on one changes nothing on screen — skip it instead of burning
      // the user's press.
      const landedOnStrandedSentinel = isSentinelState(window.history.state);

      if (skippingRef.current) {
        if (landedOnStrandedSentinel) {
          // More than one sentinel stacked up here; keep skipping.
          window.history.back();
          return;
        }

        // The navigation the user asked for is complete. Re-arming is left to
        // the effect so it happens after React has caught up.
        skippingRef.current = false;
        setSkipCompleted((previous) => previous + 1);
        return;
      }

      if (!armedRef.current) {
        if (landedOnStrandedSentinel) {
          skipBack();
        }
        return;
      }

      armedRef.current = false;

      if (window.location.href !== armedHrefRef.current) {
        // The URL moved, so this was a real navigation past our sentinel — a
        // multi-entry jump from the back-button long-press menu or history.go().
        if (landedOnStrandedSentinel) {
          skipBack();
        }
        return;
      }

      if (!enabled) {
        // Sentinel left over from before the option was switched off, or from
        // before a resize crossed the mobile breakpoint. The pop consumed the
        // press without moving, so complete the navigation the user asked for.
        skipBack();
        return;
      }

      if (sidebarOpen) {
        closedByBackRef.current = true;
        closedByBackHrefRef.current = window.location.href;
        setSidebarOpen(false);
        return;
      }

      setSidebarOpen(true);
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [enabled, sidebarOpen, setSidebarOpen]);
}
