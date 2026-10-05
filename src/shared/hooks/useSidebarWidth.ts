import { useCallback, useEffect, useState } from 'react';

export const SIDEBAR_WIDTH_STORAGE_KEY = 'sidebar-width';
export const SIDEBAR_WIDTH_DEFAULT = 288; // the previous fixed md:w-72
export const SIDEBAR_WIDTH_MIN = 220;
export const SIDEBAR_WIDTH_MAX = 640;
export const SIDEBAR_WIDTH_KEYBOARD_STEP = 16;

export const clampSidebarWidth = (value: number): number =>
  Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)));

/** A stored width that is missing, unparseable or out of range falls back to the default. */
export const parseSidebarWidth = (raw: unknown): number => {
  // Number(), not parseInt(): the latter takes a numeric prefix, so '320px' would pass.
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  return Number.isFinite(value) ? clampSidebarWidth(value) : SIDEBAR_WIDTH_DEFAULT;
};

const readStoredWidth = (): number => {
  try {
    return parseSidebarWidth(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
  } catch {
    return SIDEBAR_WIDTH_DEFAULT;
  }
};

/**
 * Desktop sidebar width, persisted across reloads.
 *
 * Kept out of `useUiPreferences` on purpose: that store is boolean-only
 * (`parseBoolean`, `VALID_KEYS`) and widening it to numbers would touch every
 * preference for the sake of one.
 */
export function useSidebarWidth(): {
  width: number;
  /** `persist: false` while dragging — the width is written once, on release. */
  setWidth: (value: number, persist?: boolean) => void;
  resetWidth: () => void;
} {
  const [width, setWidthState] = useState<number>(SIDEBAR_WIDTH_DEFAULT);

  // Read after mount so server-side rendering and hydration see the same value.
  useEffect(() => {
    setWidthState(readStoredWidth());
  }, []);

  const setWidth = useCallback((value: number, persist = true) => {
    const next = clampSidebarWidth(value);
    setWidthState(next);
    if (!persist) return;
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(next));
    } catch {
      // Storage unavailable (private mode, quota) — the width just stops persisting.
    }
  }, []);

  const resetWidth = useCallback(() => setWidth(SIDEBAR_WIDTH_DEFAULT), [setWidth]);

  return { width, setWidth, resetWidth };
}
