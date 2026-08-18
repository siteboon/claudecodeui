import { useEffect, useRef, useState } from 'react';

const GUARD_STATE_KEY = '__sessionListBackGuard';
// Generous upper bound for a same-document history traversal to report back.
const SKIP_TIMEOUT_MS = 500;
// Events worth re-checking activation on. The list only has to be a superset of
// the ones Chrome grants an activation for, because each is verified against
// `navigator.userActivation` before it counts; `touchend` and `click` are listed
// so a tap still counts if Chrome withholds the activation on `pointerdown`.
const ACTIVATION_EVENTS = ['pointerdown', 'touchend', 'click', 'keydown'] as const;

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

// Whether the event being handled left the document holding an activation. Asked
// of the browser rather than inferred from the event, because the answer is not
// guessable: measured in Chrome 141, `Escape`, `CapsLock` and a bare `Shift`
// grant nothing while `Tab` and a right-button press both do. Where the API is
// missing the browser has no such intervention, so any of the events counts.
const grantedActivation = (): boolean => navigator.userActivation?.isActive !== false;

// Whether this document has traversed history yet. Module scope on purpose: the
// fact it records belongs to the document, like the intervention's own
// bookkeeping, so it must not be reset by a remount of the hook.
let traversedSinceLoad = false;

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
 * The sentinel is only ever pushed while the document holds a user activation,
 * because Chrome's history manipulation intervention marks *every* same-document
 * entry skippable when a document adds a history entry without one — and once
 * every entry is skippable, `CanGoBack()` is false and the Android back button
 * closes the tab instead of popping the sentinel. That is why a freshly loaded
 * page cannot arm at mount: back would hide the app rather than open the list.
 * Activation is latched from input events, each confirmed with
 * `navigator.userActivation.isActive` while the event is being handled, and
 * cleared on every pop — because the intervention keys on *sticky* activation
 * yet stops honouring it after a same-document back/forward
 * (crbug.com/1248529). Neither reading alone is enough at push time:
 * `hasBeenActive` never reflects that reset, and `isActive`'s transient window
 * expires long before an arming pass triggered by a later render. The one place
 * `hasBeenActive` is trusted is the seed at mount, before the first traversal,
 * for the activation a hook that was not mounted cannot have seen — signing in
 * swaps ProtectedRoute's children without reloading, so that click is this
 * document's. See docs/history_manipulation_intervention.md in chromium/src.
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
  // Watchdog for a `history.back()` that cannot traverse (first entry in this
  // tab's session): the call is a silent no-op and no popstate follows, which
  // would leave `skippingRef` true and disarm the hook for good.
  const skipWatchdogRef = useRef(0);
  // Bumped when a skip finishes, so the arming effect re-runs even though the
  // landing entry may carry the router key we started from.
  const [skipCompleted, setSkipCompleted] = useState(0);
  // Whether the document has been interacted with since load or the last history
  // traversal — i.e. whether a `pushState` now would be honoured by Chrome's
  // history manipulation intervention rather than making every same-document
  // entry skippable. Without it there is nothing for back to pop.
  const activationRef = useRef(false);
  // Bumped on the first activation after load or a pop, so arming retries then.
  const [activationTick, setActivationTick] = useState(0);

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

      if (!activationRef.current) {
        // No activation to spend: pushing now would mark this entry and the one
        // below it skippable, so back would leave the app instead of popping the
        // sentinel. Wait for the user's first interaction, which re-runs this.
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
  }, [activationTick, enabled, locationKey, sidebarOpen, skipCompleted]);

  useEffect(() => {
    const endSkip = () => {
      window.clearTimeout(skipWatchdogRef.current);
      skippingRef.current = false;
      setSkipCompleted((previous) => previous + 1);
    };

    const skipBack = () => {
      armedRef.current = false;
      skippingRef.current = true;
      window.clearTimeout(skipWatchdogRef.current);
      skipWatchdogRef.current = window.setTimeout(() => {
        if (skippingRef.current) {
          endSkip();
        }
      }, SKIP_TIMEOUT_MS);
      window.history.back();
    };

    const handlePopState = () => {
      // A same-document traversal stops the intervention honouring any earlier
      // activation, so the next sentinel needs a fresh one — and `hasBeenActive`
      // stops being evidence of one for the rest of the document's life.
      activationRef.current = false;
      traversedSinceLoad = true;

      // Each router push strands the sentinel it was pushed over. Such a buried
      // sentinel duplicates the entry below it (same URL, same router key), so
      // landing on one changes nothing on screen — skip it instead of burning
      // the user's press.
      const landedOnStrandedSentinel = isSentinelState(window.history.state);

      if (skippingRef.current) {
        if (landedOnStrandedSentinel) {
          // More than one sentinel stacked up here; keep skipping.
          skipBack();
          return;
        }

        // The navigation the user asked for is complete. Re-arming is left to
        // the effect so it happens after React has caught up.
        endSkip();
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

  // Mount-scoped: the arming effect resubscribes constantly, and these listeners
  // must not miss the interaction that happens between two of its runs.
  useEffect(() => {
    if (!traversedSinceLoad && navigator.userActivation?.hasBeenActive) {
      // The document can hold an activation this hook never saw: signing in
      // swaps ProtectedRoute's children instead of reloading, so the click that
      // submitted the login form belongs to this very document, and the hook
      // mounts after it. Sticky activation is what the intervention honours, so
      // seed the flag from it — but only before the first traversal, after which
      // `hasBeenActive` still reports an activation the intervention has stopped
      // honouring. Arming is deferred by a task, so this lands before the first
      // attempt to push.
      activationRef.current = true;
    }

    const noteActivation = () => {
      if (activationRef.current) {
        return;
      }

      if (!grantedActivation()) {
        // An event the browser does not treat as an interaction. Counting it
        // would push a sentinel that makes every entry skippable — the bug this
        // gate exists for — so wait for one the browser does honour.
        return;
      }

      activationRef.current = true;
      setActivationTick((previous) => previous + 1);
    };

    for (const type of ACTIVATION_EVENTS) {
      window.addEventListener(type, noteActivation, { capture: true, passive: true });
    }

    return () => {
      for (const type of ACTIVATION_EVENTS) {
        window.removeEventListener(type, noteActivation, { capture: true });
      }
    };
  }, []);

  // Mount-scoped, so the skip watchdog survives this hook's other effects
  // re-subscribing. Tearing it down alongside the popstate listener would
  // cancel it exactly when the setting is toggled or the breakpoint is
  // crossed — the cases it exists to recover from.
  useEffect(() => () => window.clearTimeout(skipWatchdogRef.current), []);
}
