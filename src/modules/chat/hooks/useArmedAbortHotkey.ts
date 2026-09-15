import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How long a first Escape stays armed before the turn is safe again.
 *
 * Long enough to be a deliberate double-tap, short enough that an Escape
 * pressed minutes ago cannot combine with an unrelated one later.
 */
export const ABORT_ARM_WINDOW_MS = 2500;

type ArmedAbortHotkeyOptions = {
  /** Only listen while there is a running turn that can actually be stopped. */
  enabled: boolean;
  onAbort: () => void;
  armWindowMs?: number;
};

/**
 * Escape-to-abort, as a deliberate double-tap: the first press arms the abort,
 * the second one within `armWindowMs` performs it.
 *
 * Two separate things made a single Escape dangerous. The listener used to run
 * in the capture phase on `document`, which made it the first keydown handler
 * in the whole app — pressing Escape to dismiss the `@file` or `/command`
 * popup killed the turn before the popup itself ever saw the key. Listening in
 * the bubble phase fixes that on its own, because those popups call
 * preventDefault() and the `defaultPrevented` guard honours it. Arming covers
 * what is left: an Escape pressed out of reflex with nothing open, which used
 * to discard minutes of work silently.
 *
 * Used by chat's ChatInterface, which passes the armed flag down to the Stop
 * button so the pending second press is visible rather than a surprise.
 */
export function useArmedAbortHotkey({ enabled, onAbort, armWindowMs = ABORT_ARM_WINDOW_MS }: ArmedAbortHotkeyOptions) {
  const [isAbortArmed, setIsAbortArmed] = useState(false);
  // The listener must not be re-registered every time arming flips, so the
  // handler reads the flag from a ref and the state exists only to render it.
  const isAbortArmedRef = useRef(false);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarm = useCallback(() => {
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    isAbortArmedRef.current = false;
    setIsAbortArmed(false);
  }, []);

  useEffect(() => {
    // No disarm needed on the way in: flipping `enabled` off re-runs this
    // effect, and the previous run's cleanup has already disarmed by then.
    if (!enabled) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();

      if (isAbortArmedRef.current) {
        disarm();
        onAbort();
        return;
      }

      isAbortArmedRef.current = true;
      setIsAbortArmed(true);
      armTimerRef.current = setTimeout(disarm, armWindowMs);
    };

    document.addEventListener('keydown', handleGlobalEscape);
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape);
      disarm();
    };
  }, [armWindowMs, disarm, enabled, onAbort]);

  return isAbortArmed;
}
