export const DEFAULT_SIDEBAR_WIDTH = 288;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 520;
export const COLLAPSED_SIDEBAR_WIDTH = 48;
export const DESKTOP_MAIN_MIN_WIDTH = 360;
export const SIDEBAR_WIDTH_STORAGE_KEY = 'cloudcli.sidebarWidth';

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }

  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

export function readStoredSidebarWidth(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_SIDEBAR_WIDTH;
  }

  return clampSidebarWidth(Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)));
}

export function getDesktopSidebarWidth(width: number, sidebarVisible: boolean): number {
  return sidebarVisible ? clampSidebarWidth(width) : COLLAPSED_SIDEBAR_WIDTH;
}
