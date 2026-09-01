import { useEffect, useRef, useState } from 'react';

const GUARD_STATE_KEY = '__sessionListBackGuard';
const BASE_STATE_KEY = '__sessionListBackBase';
const ACTIVATION_EVENTS = ['pointerdown', 'touchend', 'click', 'keydown'] as const;

type GuardMarker = {
  instanceId: string;
  guardId: number;
  href: string;
};

type BaseMarker = Pick<GuardMarker, 'instanceId' | 'guardId'>;

let nextGuardId = 1;
let traversedSinceLoad = false;

const readRecord = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
);

const readGuardMarker = (state: unknown): GuardMarker | null => {
  const marker = readRecord(readRecord(state)?.[GUARD_STATE_KEY]);

  if (
    typeof marker?.instanceId !== 'string'
    || typeof marker.guardId !== 'number'
    || typeof marker.href !== 'string'
  ) {
    return null;
  }

  return {
    instanceId: marker.instanceId,
    guardId: marker.guardId,
    href: marker.href,
  };
};

const readBaseMarker = (state: unknown): BaseMarker | null => {
  const marker = readRecord(readRecord(state)?.[BASE_STATE_KEY]);

  if (typeof marker?.instanceId !== 'string' || typeof marker.guardId !== 'number') {
    return null;
  }

  return {
    instanceId: marker.instanceId,
    guardId: marker.guardId,
  };
};

const isAdjacentGuardPop = (
  guard: GuardMarker,
  state: unknown,
): boolean => {
  const base = readBaseMarker(state);

  return base?.instanceId === guard.instanceId
    && base.guardId === guard.guardId
    && window.location.href === guard.href;
};

type UseBackOpensSessionListArgs = {
  enabled: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  locationKey: string;
};

/**
 * Keeps one same-document history entry above a closed mobile session list.
 * Popping that entry opens the list. Once the list is open, browser navigation
 * remains in charge.
 */
export function useBackOpensSessionList({
  enabled,
  sidebarOpen,
  setSidebarOpen,
  locationKey,
}: UseBackOpensSessionListArgs) {
  const instanceIdRef = useRef('');
  if (instanceIdRef.current === '') {
    instanceIdRef.current = crypto.randomUUID();
  }

  const enabledRef = useRef(enabled);
  const sidebarOpenRef = useRef(sidebarOpen);
  const setSidebarOpenRef = useRef(setSidebarOpen);
  const standingOnGuardRef = useRef(readGuardMarker(window.history.state));
  const removingGuardRef = useRef(false);
  const activationRef = useRef(false);
  const [activationVersion, setActivationVersion] = useState(0);

  enabledRef.current = enabled;
  sidebarOpenRef.current = sidebarOpen;
  setSidebarOpenRef.current = setSidebarOpen;

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const leftGuard = standingOnGuardRef.current;

      standingOnGuardRef.current = readGuardMarker(event.state);
      activationRef.current = false;
      traversedSinceLoad = true;

      if (removingGuardRef.current) {
        removingGuardRef.current = false;
        return;
      }

      if (!leftGuard || !isAdjacentGuardPop(leftGuard, event.state)) {
        return;
      }

      if (leftGuard.instanceId !== instanceIdRef.current) {
        // A reload inherited another mount's duplicate entry. Skip that entry
        // without turning it into permission to intercept Back after loading.
        window.history.back();
        return;
      }

      if (!enabledRef.current || sidebarOpenRef.current) {
        // The guard was still present during a setting or render transition.
        // Finish the browser navigation represented by the same Back press.
        window.history.back();
        return;
      }

      setSidebarOpenRef.current(true);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const userActivation = navigator.userActivation;
    activationRef.current = userActivation
      ? !traversedSinceLoad && userActivation.hasBeenActive
      : true;

    const noteActivation = () => {
      if (activationRef.current || navigator.userActivation?.isActive === false) {
        return;
      }

      activationRef.current = true;
      setActivationVersion((version) => version + 1);
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

  useEffect(() => {
    // React Router processes popstate first. Reconcile in the next task so this
    // cannot turn the entry reached by a real navigation into a consumed press.
    const timer = window.setTimeout(() => {
      const topGuard = readGuardMarker(window.history.state);
      standingOnGuardRef.current = topGuard;

      if (topGuard) {
        if (
          topGuard.instanceId === instanceIdRef.current
          && (!enabled || sidebarOpen)
        ) {
          removingGuardRef.current = true;
          window.history.back();
        }
        return;
      }

      if (!enabled || sidebarOpen || !activationRef.current || removingGuardRef.current) {
        return;
      }

      const marker: GuardMarker = {
        instanceId: instanceIdRef.current,
        guardId: nextGuardId++,
        href: window.location.href,
      };
      const baseMarker: BaseMarker = {
        instanceId: marker.instanceId,
        guardId: marker.guardId,
      };
      const baseState = {
        ...(window.history.state as object | null),
        [BASE_STATE_KEY]: baseMarker,
      };

      try {
        window.history.replaceState(baseState, '');
        window.history.pushState(
          { ...baseState, [GUARD_STATE_KEY]: marker },
          '',
        );
        standingOnGuardRef.current = marker;
      } catch {
        // Safari can throttle pushState. Back stays native until a later arm.
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activationVersion, enabled, locationKey, sidebarOpen]);
}
