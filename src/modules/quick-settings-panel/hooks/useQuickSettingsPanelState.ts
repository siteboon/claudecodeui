import { useCallback, useEffect, useMemo, useReducer } from 'react';

import type { QuickSettingsTab } from '@/shared/types';

const PANEL_STATE_STORAGE_KEY = 'quickSettingsPanel';

const QUICK_SETTINGS_TABS: QuickSettingsTab[] = ['settings', 'commands'];

/** The part of the panel state that survives a reload. */
type StoredQuickSettingsPanelState = {
  pinned: boolean;
  tab: QuickSettingsTab;
};

/** Full panel state: the persisted pin/tab choice plus whether it is currently showing. */
export type QuickSettingsPanelState = StoredQuickSettingsPanelState & {
  isOpen: boolean;
};

/**
 * `canPin` is false on mobile, where docking makes no sense. It travels with
 * every action whose outcome depends on whether the panel is docked, so a pin
 * stored on desktop is ignored (not erased) while the viewport is narrow.
 */
type QuickSettingsPanelAction =
  | { type: 'close'; canPin: boolean }
  | { type: 'toggle' }
  | { type: 'selectTab'; tab: QuickSettingsTab }
  | { type: 'togglePin'; canPin: boolean }
  | { type: 'leaveDesktop' };

const DEFAULT_STORED_STATE: StoredQuickSettingsPanelState = {
  pinned: false,
  tab: 'settings',
};

const isQuickSettingsTab = (value: unknown): value is QuickSettingsTab => (
  QUICK_SETTINGS_TABS.includes(value as QuickSettingsTab)
);

// Docked = pinned somewhere pinning is possible. A docked panel is part of the
// layout: the backdrop and Escape (`close`) cannot dismiss it; only the edge
// handle (`toggle`) collapses it, and the pin survives that so the next toggle
// docks it again.
const isDocked = (state: QuickSettingsPanelState, canPin: boolean): boolean => (
  state.pinned && canPin
);

/**
 * Reads the persisted pin/tab choice. Anything unreadable — missing key,
 * corrupt JSON, a tab name this build does not know — falls back field by
 * field to the defaults so a stale entry can never leave the panel unusable.
 */
export function readStoredQuickSettingsPanelState(): StoredQuickSettingsPanelState {
  if (typeof window === 'undefined') {
    return DEFAULT_STORED_STATE;
  }

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PANEL_STATE_STORAGE_KEY);
  } catch {
    return DEFAULT_STORED_STATE;
  }
  if (!raw) {
    return DEFAULT_STORED_STATE;
  }

  try {
    const parsed = JSON.parse(raw) as { pinned?: unknown; tab?: unknown } | null;
    if (!parsed || typeof parsed !== 'object') {
      return DEFAULT_STORED_STATE;
    }
    return {
      pinned: parsed.pinned === true,
      tab: isQuickSettingsTab(parsed.tab) ? parsed.tab : DEFAULT_STORED_STATE.tab,
    };
  } catch {
    return DEFAULT_STORED_STATE;
  }
}

const writeStoredQuickSettingsPanelState = (state: StoredQuickSettingsPanelState) => {
  try {
    window.localStorage.setItem(PANEL_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be full or disabled; the panel still works for this session.
  }
};

/** Pure transition function, exported so the tests can drive it without React. */
export function quickSettingsPanelReducer(
  state: QuickSettingsPanelState,
  action: QuickSettingsPanelAction,
): QuickSettingsPanelState {
  switch (action.type) {
    case 'close':
      if (isDocked(state, action.canPin) || !state.isOpen) {
        return state;
      }
      return { ...state, isOpen: false };
    case 'toggle':
      return { ...state, isOpen: !state.isOpen };
    case 'selectTab':
      return state.tab === action.tab ? state : { ...state, tab: action.tab };
    case 'togglePin':
      if (!action.canPin) {
        return state;
      }
      // Pinning always shows the panel (docked); unpinning leaves it open as
      // an overlay so the content does not jump away under the cursor.
      return { ...state, pinned: !state.pinned, isOpen: true };
    case 'leaveDesktop':
      // The docked column cannot exist on a narrow viewport, and turning it
      // into a full-screen overlay uninvited would cover the app; hide it and
      // let the handle bring it back. The pin is kept for the next desktop visit.
      if (!state.pinned || !state.isOpen) {
        return state;
      }
      return { ...state, isOpen: false };
    default:
      return state;
  }
}

/**
 * Builds the initial state from storage: a pinned panel starts open (docked)
 * so a reload restores the layout the user left, an unpinned one starts closed.
 */
const initializeQuickSettingsPanelState = (canPin: boolean): QuickSettingsPanelState => {
  const stored = readStoredQuickSettingsPanelState();
  return { ...stored, isOpen: stored.pinned && canPin };
};

type UseQuickSettingsPanelStateOptions = {
  // False on mobile: pinning is ignored there and a stored pin is not applied.
  canPin: boolean;
};

/** Used by QuickSettingsPanelView to own the open/pinned/tab state of the drawer and persist the pin and tab choice. */
export function useQuickSettingsPanelState({ canPin }: UseQuickSettingsPanelStateOptions) {
  // Whether the panel is showing, whether it is docked and which tab it shows,
  // kept together because the transitions depend on each other (a docked panel
  // ignores close; pinning opens it). `pinned` and `tab` are persisted;
  // `isOpen` is transient and derived from `pinned` on load.
  const [state, dispatch] = useReducer(
    quickSettingsPanelReducer,
    canPin,
    initializeQuickSettingsPanelState,
  );

  // Persist only the pin/tab choice; open/closed is intentionally not stored.
  useEffect(() => {
    writeStoredQuickSettingsPanelState({ pinned: state.pinned, tab: state.tab });
  }, [state.pinned, state.tab]);

  // Crossing into the mobile breakpoint while docked: collapse rather than
  // pop up as an overlay. On mount this is a no-op (a pin never starts open there).
  useEffect(() => {
    if (!canPin) {
      dispatch({ type: 'leaveDesktop' });
    }
  }, [canPin]);

  const close = useCallback(() => dispatch({ type: 'close', canPin }), [canPin]);
  const toggle = useCallback(() => dispatch({ type: 'toggle' }), []);
  const selectTab = useCallback((tab: QuickSettingsTab) => dispatch({ type: 'selectTab', tab }), []);
  const togglePin = useCallback(() => dispatch({ type: 'togglePin', canPin }), [canPin]);

  return useMemo(() => ({
    isOpen: state.isOpen,
    // A stored pin is only honoured where docking is possible; on mobile the
    // panel behaves as an unpinned overlay regardless of what is stored.
    isPinned: state.pinned && canPin,
    activeTab: state.tab,
    close,
    toggle,
    selectTab,
    togglePin,
  }), [canPin, close, selectTab, state.isOpen, state.pinned, state.tab, toggle, togglePin]);
}
