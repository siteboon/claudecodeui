import { readUserPreference } from '@/shared/userSettings';

/**
 * The boolean UI preferences and their reducer, kept separate from the provider
 * so the state transitions are unit-testable without rendering anything.
 *
 * The values are stored in `auth.db` through the preference store, so a toggle
 * made on one device is in effect on the next.
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

/**
 * Reads the stored preferences, filling in a default for anything the user has
 * never toggled. Synchronous, because the sidebar's visibility and the composer's
 * send-key are needed on the very first render.
 */
export const readStoredUiPreferences = (): UiPreferences => {
  const stored = readUserPreference<Record<string, unknown>>('uiPreferences', {});

  return PREFERENCE_KEYS.reduce((acc, key) => {
    acc[key] = parseBoolean(stored[key], DEFAULTS[key]);
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
