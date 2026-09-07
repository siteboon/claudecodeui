import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';

import {
  readStoredUiPreferences,
  uiPreferencesReducer,
} from '@/shared/uiPreferences';
import type { UiPreferenceKey, UiPreferences } from '@/shared/uiPreferences';
import { subscribeToUserPreferences, writeUserPreference } from '@/shared/userSettings';

type UiPreferenceActions = {
  setPreference: (key: UiPreferenceKey, value: boolean) => void;
};

const UiPreferencesStateContext = createContext<UiPreferences | null>(null);
const UiPreferencesActionsContext = createContext<UiPreferenceActions | null>(null);

/**
 * Mounted once by App; owns the boolean UI preferences that the sidebar, quick
 * settings, the workspace and the voice controls all read.
 *
 * This used to be a plain hook, which meant every call site held its own reducer
 * and they reconciled after the fact through a `ui-preferences:sync` CustomEvent
 * tagged with a per-instance id — so one toggle produced four localStorage
 * writes and four DOM events. With a single owner that channel is unnecessary,
 * and the preferences themselves now live in `auth.db`, which is what carries a
 * change to another tab or another device.
 */
export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  // The single copy of the preferences. Every consumer used to hold its own
  // reducer and reconcile through an event, so one toggle wrote localStorage
  // once per consumer and re-rendered all of them.
  const [preferences, dispatch] = useReducer(
    uiPreferencesReducer,
    undefined,
    readStoredUiPreferences,
  );

  // Persisting from an effect keyed on the state would also fire on mount —
  // pushing the defaults to the server before the user's real preferences had
  // even been fetched — and again for every value that *arrived* from the
  // store, echoing each hydrate straight back. Comparing by content, not by
  // reference, keeps the write one-directional: the reducer returns a fresh
  // object for an incoming change, so an identity check would not catch it.
  const lastPersistedRef = useRef<string>(JSON.stringify(preferences));

  useEffect(() => {
    const serialized = JSON.stringify(preferences);
    if (lastPersistedRef.current === serialized) {
      return;
    }
    lastPersistedRef.current = serialized;
    writeUserPreference('uiPreferences', preferences);
  }, [preferences]);

  useEffect(() => subscribeToUserPreferences(() => {
    const stored = readStoredUiPreferences();
    lastPersistedRef.current = JSON.stringify(stored);
    dispatch({ type: 'set_many', value: stored });
  }), []);

  const actions = useMemo<UiPreferenceActions>(() => ({
    setPreference: (key, value) => dispatch({ type: 'set', key, value }),
  }), []);

  return (
    <UiPreferencesActionsContext.Provider value={actions}>
      <UiPreferencesStateContext.Provider value={preferences}>
        {children}
      </UiPreferencesStateContext.Provider>
    </UiPreferencesActionsContext.Provider>
  );
}

/**
 * Reads the UI preferences. Components that only write should use
 * useSetUiPreference instead, so a toggle does not re-render them.
 */
export function useUiPreferences(): UiPreferences {
  const preferences = useContext(UiPreferencesStateContext);
  if (!preferences) {
    throw new Error('useUiPreferences must be used within a UiPreferencesProvider');
  }
  return preferences;
}

/** Stable setter, so writers never re-render on a preference change. */
export function useSetUiPreference(): UiPreferenceActions['setPreference'] {
  const actions = useContext(UiPreferencesActionsContext);
  if (!actions) {
    throw new Error('useSetUiPreference must be used within a UiPreferencesProvider');
  }
  return actions.setPreference;
}
