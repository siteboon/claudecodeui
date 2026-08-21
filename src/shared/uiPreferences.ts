/**
 * The boolean UI preferences and their reducer, kept separate from the provider
 * so the state transitions and the legacy-key migration are unit-testable
 * without rendering anything.
 */

/** Toggles the user controls from Quick Settings and the Settings dialog. */
export type UiPreferences = {
  showRawParameters: boolean;
  showThinking: boolean;
  sendByCtrlEnter: boolean;
  sidebarVisible: boolean;
  voiceEnabled: boolean;
};

export type UiPreferenceKey = keyof UiPreferences;

export type UiPreferencesAction =
  | { type: 'set'; key: UiPreferenceKey; value: unknown }
  | { type: 'set_many'; value?: Partial<Record<UiPreferenceKey, unknown>> };

/** The single blob every preference is stored under. */
export const UI_PREFERENCES_STORAGE_KEY = 'uiPreferences';

const DEFAULTS: UiPreferences = {
  showRawParameters: false,
  showThinking: true,
  sendByCtrlEnter: false,
  sidebarVisible: true,
  voiceEnabled: false,
};

const PREFERENCE_KEYS = Object.keys(DEFAULTS) as UiPreferenceKey[];
/** Prevents an unknown key from being written into the blob. */
const VALID_KEYS = new Set<UiPreferenceKey>(PREFERENCE_KEYS);

/** Values were historically stored as both real booleans and the strings. */
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

/** Each preference used to live under its own key, before the unified blob. */
const readLegacyPreference = (key: UiPreferenceKey, fallback: boolean): boolean => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return parseBoolean(JSON.parse(raw), fallback);
  } catch {
    return fallback;
  }
};

export const readInitialUiPreferences = (): UiPreferences => {
  try {
    const raw = localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);

    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const parsedRecord = parsed as Record<string, unknown>;

        return PREFERENCE_KEYS.reduce((acc, key) => {
          acc[key] = parseBoolean(parsedRecord[key], DEFAULTS[key]);
          return acc;
        }, { ...DEFAULTS });
      }
    }
  } catch {
    // Fall through to the legacy keys when the blob is missing or invalid.
  }

  return PREFERENCE_KEYS.reduce((acc, key) => {
    acc[key] = readLegacyPreference(key, DEFAULTS[key]);
    return acc;
  }, { ...DEFAULTS });
};

export function uiPreferencesReducer(
  state: UiPreferences,
  action: UiPreferencesAction,
): UiPreferences {
  switch (action.type) {
    case 'set': {
      const { key, value } = action;
      if (!VALID_KEYS.has(key)) {
        return state;
      }

      const nextValue = parseBoolean(value, state[key]);
      // Returning the same object keeps consumers from re-rendering on a no-op.
      return state[key] === nextValue ? state : { ...state, [key]: nextValue };
    }
    case 'set_many': {
      const updates = action.value || {};
      let changed = false;
      const nextState = { ...state };

      for (const key of PREFERENCE_KEYS) {
        if (!(key in updates)) continue;

        const nextValue = parseBoolean(updates[key], state[key]);
        if (nextState[key] !== nextValue) {
          nextState[key] = nextValue;
          changed = true;
        }
      }

      return changed ? nextState : state;
    }
    default:
      return state;
  }
}
