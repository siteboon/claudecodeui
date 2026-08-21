import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';

import {
  readInitialUiPreferences,
  uiPreferencesReducer,
  UI_PREFERENCES_STORAGE_KEY,
} from '@/shared/uiPreferences';
import type { UiPreferenceKey, UiPreferences } from '@/shared/uiPreferences';

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
 * writes and four DOM events. With a single owner the same-tab event channel is
 * unnecessary; the `storage` listener remains, because it is the only thing that
 * carries a change to another tab.
 */
export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, dispatch] = useReducer(
    uiPreferencesReducer,
    undefined,
    readInitialUiPreferences,
  );

  useEffect(() => {
    localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== UI_PREFERENCES_STORAGE_KEY || event.newValue === null) {
        return;
      }

      try {
        dispatch({ type: 'set_many', value: JSON.parse(event.newValue) });
      } catch {
        // Ignore malformed storage updates from another tab.
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

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
