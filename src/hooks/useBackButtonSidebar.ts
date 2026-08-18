import { useEffect, useRef, useState } from 'react';

const GUARD_STATE_KEY = '__sessionListBackGuard';
// One guard for the press that opens the list, one for the press that closes it
// again. Both are pushed together, while the same activation is live.
const GUARD_DEPTH = 2;
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

// Every guard entry carries its own id, so a guard this hook still counts on can
// be told from one a router push buried. Both look alike in `history.state`, and
// they mean opposite things: the live one is a press to interpret, the buried
// one an entry to skip.
let nextGuardId = 1;

const readGuardId = (state: unknown): number | null => {
  if (typeof state !== 'object' || state === null || !(GUARD_STATE_KEY in state)) {
    return null;
  }

  const id = state[GUARD_STATE_KEY];

  return typeof id === 'number' ? id : null;
};

// Whether this document has traversed history yet. Module scope on purpose: the
// fact it records belongs to the document, like the intervention's own
// bookkeeping, so it must not be reset by a remount of the hook.
let traversedSinceLoad = false;

/**
 * Turns the device back gesture into "show the session list", so sessions can
 * be switched with one thumb instead of reaching for the menu button.
 *
 * The browser gives no way to observe a back press without consuming a history
 * entry, so we keep guard entries on top of the stack: a back press pops one
 * instead of navigating, and we translate that pop into opening or closing the
 * sidebar.
 *
 * Two guards are pushed at a time, not one, and that number is the whole reason
 * the sequence works without the user touching the screen in between: the first
 * press opens the list, the second closes it, the third leaves the app. A single
 * guard cannot manage that, because re-arming after the first press needs a user
 * activation the back button does not grant (see below) — the press that should
 * have closed the list would navigate away instead. The intervention explicitly
 * allows this: with one activation a document may add many unskippable entries,
 * until a cross-document navigation or a back/forward occurs.
 *
 * Which guards are still live is read off `history.state` rather than tracked by
 * URL: react-router builds a fresh state object on every push and replace and
 * never copies our marker, so the marker's absence is an exact "the router
 * pushed over the guards, arm a new pair" signal. A URL comparison would miss
 * it, because several navigations here target the URL we are already on
 * (`navigate('/')` in useProjectsState on project select, new session, and
 * deletes). Popping our own guard also mints a fresh `location.key`, because
 * pushing behind react-router's back makes its `idx` bookkeeping drift — which
 * is why arming is keyed on the guard ids in `history.state` and not on that.
 *
 * Guards are only ever pushed while the document holds a user activation,
 * because Chrome's history manipulation intervention marks *every* same-document
 * entry skippable when a document adds a history entry without one — and once
 * every entry is skippable, `CanGoBack()` is false and the Android back button
 * closes the tab instead of popping a guard. That is why a freshly loaded page
 * cannot arm at mount: back would hide the app rather than open the list.
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
 * Two limitations are inherent to the guard approach and accepted:
 * `pushState` drops forward history, so the forward gesture stops working
 * while the option is on; and because a guard is always the top entry,
 * `navigate(..., { replace: true })` replaces a guard instead of the entry
 * the caller meant to drop (e.g. the alias URL in useProjectsState).
 */
export function useBackButtonSidebar({
  enabled,
  sidebarOpen,
  setSidebarOpen,
  locationKey,
}: UseBackButtonSidebarArgs) {
  // Ids of the guards this hook believes are stacked above the current entry,
  // bottom first. Emptied as they are popped, so its length is how many presses
  // the hook can still interpret.
  const guardIdsRef = useRef<number[]>([]);
  const armedHrefRef = useRef('');
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
    const pushGuard = (): boolean => {
      const id = nextGuardId;

      // Clone the current state so react-router's own bookkeeping (`key`, `idx`)
      // survives onto the guard entry and popping it stays a no-op navigation.
      try {
        window.history.pushState(
          { ...(window.history.state as object | null), [GUARD_STATE_KEY]: id },
          '',
        );
      } catch {
        // Safari throttles pushState (~100 calls / 30s) and throws when it
        // trips. Arming shallower, or not at all, just means back navigates
        // normally until the next attempt.
        return false;
      }

      nextGuardId += 1;
      guardIdsRef.current = [...guardIdsRef.current, id];

      return true;
    };

    // Arming is deferred by a task rather than done inline. React-router
    // handles `popstate` before this hook's listener and re-renders
    // synchronously, which flushes this effect in the middle of that same
    // dispatch — arming inline would push a fresh guard that the listener
    // then misreads as "the user popped my guard", opening the list on what
    // was a genuine back navigation.
    const armSentinel = () => {
      if (skippingRef.current) {
        // Mid-skip the stack is still moving; arming now would push a guard
        // onto an entry we are about to leave.
        return;
      }

      if (!enabled) {
        return;
      }

      const topGuardId = readGuardId(window.history.state);
      const liveDepth = topGuardId === null
        ? 0
        : guardIdsRef.current.indexOf(topGuardId) + 1;

      if (liveDepth === GUARD_DEPTH) {
        armedHrefRef.current = window.location.href;
        return;
      }

      if (!activationRef.current) {
        // No activation to spend: pushing now would mark this entry and every
        // other same-document one skippable, so back would leave the app
        // instead of popping a guard. Wait for an interaction, which re-runs
        // this. Topping a partial pair up waits too — the press that closes the
        // list is worth less than the app staying reachable by back.
        return;
      }

      // Anything above the entry we can still account for is gone: either
      // popped, or buried by a router push that now owns the top of the stack.
      guardIdsRef.current = guardIdsRef.current.slice(0, liveDepth);

      while (guardIdsRef.current.length < GUARD_DEPTH && pushGuard()) {
        // Each push is checked by the loop condition; a throttled one stops it.
      }

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
      guardIdsRef.current = [];
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
      // activation, so the next guard needs a fresh one — and `hasBeenActive`
      // stops being evidence of one for the rest of the document's life.
      activationRef.current = false;
      traversedSinceLoad = true;

      const guardIds = guardIdsRef.current;
      const landedGuardId = readGuardId(window.history.state);
      const landedIndex = landedGuardId === null ? -1 : guardIds.indexOf(landedGuardId);
      // A guard entry we no longer count on, because a router push buried it.
      // It duplicates the entry below it (same URL, same router key), so landing
      // on one changes nothing on screen — skip it instead of burning the press.
      const landedOnStrandedGuard = landedGuardId !== null && landedIndex < 0;

      if (skippingRef.current) {
        if (landedGuardId !== null) {
          // Still standing on a guard; keep skipping.
          skipBack();
          return;
        }

        // The navigation the user asked for is complete. Re-arming is left to
        // the effect so it happens after React has caught up.
        endSkip();
        return;
      }

      if (guardIds.length === 0) {
        if (landedOnStrandedGuard) {
          skipBack();
        }
        return;
      }

      if (landedOnStrandedGuard || window.location.href !== armedHrefRef.current) {
        // Either the stack moved further than one of our guards — a multi-entry
        // jump from the back-button long-press menu or history.go() — or we came
        // to rest on an entry that is not ours to interpret.
        guardIdsRef.current = [];

        if (landedOnStrandedGuard) {
          skipBack();
        }

        return;
      }

      const remaining = landedIndex + 1;
      guardIdsRef.current = guardIds.slice(0, remaining);

      if (guardIds.length - remaining > 1) {
        // A back press pops exactly one entry, and our guards are never
        // skippable, so more than one disappearing at once means a jump — the
        // back-button long-press menu, or history.go(). The user picked the entry
        // they are on, so leave them there rather than reading it as a press.
        return;
      }

      if (!enabled) {
        // Guards left over from before the option was switched off, or from
        // before a resize crossed the mobile breakpoint.
        if (remaining > 0) {
          // Standing on one of our own guards, an invisible duplicate of the
          // entry below it, so the press moved nothing: complete it. Landing
          // anywhere else means the press already moved the user, and skipping
          // would eat an entry they asked to see.
          skipBack();
        }

        return;
      }

      if (sidebarOpen) {
        setSidebarOpen(false);
        return;
      }

      if (remaining === 0) {
        // The last guard is spent and the list is already closed, so this press
        // moved nothing on screen. Complete it rather than swallow it.
        skipBack();
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

      // Whether the document now holds an activation is asked of the browser
      // rather than inferred from the event, because the answer is not guessable:
      // measured in Chrome 141, `Escape`, `CapsLock` and a bare `Shift` grant
      // nothing while `Tab` and a right-button press both do. Counting one the
      // browser withheld would push a guard that makes every entry skippable —
      // the bug this gate exists for. Where the API is missing there is no such
      // intervention, so any of the events counts.
      if (navigator.userActivation?.isActive === false) {
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
