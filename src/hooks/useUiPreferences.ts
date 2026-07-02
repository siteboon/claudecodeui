import { useEffect, useReducer, useRef } from 'react';

type UiPreferences = {
  showRawParameters: boolean;
  showThinking: boolean;
  sendByCtrlEnter: boolean;
  sidebarVisible: boolean;
  sidebarWidth: number;
};

type UiPreferenceKey = keyof UiPreferences;

type SetPreferenceAction = {
  type: 'set';
  key: UiPreferenceKey;
  value: unknown;
};

type SetManyPreferencesAction = {
  type: 'set_many';
  value?: Partial<Record<UiPreferenceKey, unknown>>;
};

type ResetPreferencesAction = {
  type: 'reset';
  value?: Partial<UiPreferences>;
};

type UiPreferencesAction =
  | SetPreferenceAction
  | SetManyPreferencesAction
  | ResetPreferencesAction;

const DEFAULTS: UiPreferences = {
  showRawParameters: false,
  showThinking: true,
  sendByCtrlEnter: false,
  sidebarVisible: true,
  sidebarWidth: 288,
};

const PREFERENCE_KEYS = Object.keys(DEFAULTS) as UiPreferenceKey[];
const VALID_KEYS = new Set<UiPreferenceKey>(PREFERENCE_KEYS); // prevents unknown keys from being written
const SYNC_EVENT = 'ui-preferences:sync';

type SyncEventDetail = {
  storageKey: string;
  sourceId: string;
  value: Partial<Record<UiPreferenceKey, unknown>>;
};

const parseBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }

  return fallback;
};

const parseNumber = (value: unknown, fallback: number): number => {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN;

  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const parsePreference = <K extends UiPreferenceKey>(key: K, value: unknown, fallback: UiPreferences[K]): UiPreferences[K] => {
  if (typeof fallback === 'boolean') {
    return parseBoolean(value, fallback) as UiPreferences[K];
  }

  if (typeof fallback === 'number') {
    return parseNumber(value, fallback) as UiPreferences[K];
  }

  return fallback;
};

const readLegacyPreference = <K extends UiPreferenceKey>(key: K, fallback: UiPreferences[K]): UiPreferences[K] => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;

    // Supports values written by both JSON.stringify and plain strings.
    const parsed = JSON.parse(raw);
    return parsePreference(key, parsed, fallback);
  } catch {
    return fallback;
  }
};

const parsePreferencesRecord = (
  record: Partial<Record<UiPreferenceKey, unknown>>,
  fallback: UiPreferences,
): UiPreferences => ({
  showRawParameters: parseBoolean(record.showRawParameters, fallback.showRawParameters),
  showThinking: parseBoolean(record.showThinking, fallback.showThinking),
  sendByCtrlEnter: parseBoolean(record.sendByCtrlEnter, fallback.sendByCtrlEnter),
  sidebarVisible: parseBoolean(record.sidebarVisible, fallback.sidebarVisible),
  sidebarWidth: parseNumber(record.sidebarWidth, fallback.sidebarWidth),
});

const readLegacyPreferences = (): UiPreferences => ({
  showRawParameters: readLegacyPreference('showRawParameters', DEFAULTS.showRawParameters),
  showThinking: readLegacyPreference('showThinking', DEFAULTS.showThinking),
  sendByCtrlEnter: readLegacyPreference('sendByCtrlEnter', DEFAULTS.sendByCtrlEnter),
  sidebarVisible: readLegacyPreference('sidebarVisible', DEFAULTS.sidebarVisible),
  sidebarWidth: readLegacyPreference('sidebarWidth', DEFAULTS.sidebarWidth),
});

const readInitialPreferences = (storageKey: string): UiPreferences => {
  if (typeof window === 'undefined') {
    return DEFAULTS;
  }

  try {
    const raw = localStorage.getItem(storageKey);

    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const parsedRecord = parsed as Record<string, unknown>;
        return parsePreferencesRecord(parsedRecord, DEFAULTS);
      }
    }
  } catch {
    // Fall back to legacy keys when unified key is missing or invalid.
  }

  return readLegacyPreferences();
};

function reducer(state: UiPreferences, action: UiPreferencesAction): UiPreferences {
  switch (action.type) {
    case 'set': {
      const { key, value } = action;
      if (!VALID_KEYS.has(key)) {
        return state;
      }

      const nextValue = parsePreference(key, value, state[key]);
      if (state[key] === nextValue) {
        return state;
      }

      return { ...state, [key]: nextValue };
    }
    case 'set_many': {
      const updates = action.value || {};
      const nextState = parsePreferencesRecord(updates, state);
      const changed = PREFERENCE_KEYS.some((key) => nextState[key] !== state[key]);

      return changed ? nextState : state;
    }
    case 'reset':
      return { ...DEFAULTS, ...(action.value || {}) };
    default:
      return state;
  }
}

export function useUiPreferences(storageKey = 'uiPreferences') {
  const instanceIdRef = useRef(`ui-preferences-${Math.random().toString(36).slice(2)}`);
  const [state, dispatch] = useReducer(
    reducer,
    storageKey,
    readInitialPreferences
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    localStorage.setItem(storageKey, JSON.stringify(state));

    window.dispatchEvent(
      new CustomEvent<SyncEventDetail>(SYNC_EVENT, {
        detail: {
          storageKey,
          sourceId: instanceIdRef.current,
          value: state,
        },
      })
    );
  }, [state, storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const applyExternalUpdate = (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return;
      }
      dispatch({ type: 'set_many', value: value as Partial<Record<UiPreferenceKey, unknown>> });
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== storageKey || event.newValue === null) {
        return;
      }

      try {
        const parsed = JSON.parse(event.newValue);
        applyExternalUpdate(parsed);
      } catch {
        // Ignore malformed storage updates.
      }
    };

    const handleSyncEvent = (event: Event) => {
      const syncEvent = event as CustomEvent<SyncEventDetail>;
      const detail = syncEvent.detail;
      if (!detail || detail.storageKey !== storageKey || detail.sourceId === instanceIdRef.current) {
        return;
      }

      applyExternalUpdate(detail.value);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener(SYNC_EVENT, handleSyncEvent as EventListener);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(SYNC_EVENT, handleSyncEvent as EventListener);
    };
  }, [storageKey]);

  const setPreference = (key: UiPreferenceKey, value: unknown) => {
    dispatch({ type: 'set', key, value });
  };

  const setPreferences = (value: Partial<Record<UiPreferenceKey, unknown>>) => {
    dispatch({ type: 'set_many', value });
  };

  const resetPreferences = (value?: Partial<UiPreferences>) => {
    dispatch({ type: 'reset', value });
  };

  return {
    preferences: state,
    setPreference,
    setPreferences,
    resetPreferences,
    dispatch,
  };
}
