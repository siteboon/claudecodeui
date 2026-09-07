import { useSyncExternalStore } from 'react';

/** Tailwind's `md` breakpoint — the width the sidebar swaps layouts at. */
const COMPACT_QUERY = '(max-width: 767px)';

let query: MediaQueryList | null = null;
const readQuery = (): MediaQueryList => (query ??= window.matchMedia(COMPACT_QUERY));

function subscribe(onChange: () => void): () => void {
  const media = readQuery();
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

const getSnapshot = (): boolean => readQuery().matches;

/**
 * True while the sidebar is in its touch layout.
 *
 * Every sidebar row has two designs — a tappable card and a dense desktop
 * button — and both used to be rendered with the wrong one hidden by CSS. On a
 * workspace with a few projects expanded that made roughly two in five sidebar
 * DOM nodes invisible markup that React still had to build, diff and hold. The
 * rows read this instead and render only the design that is on screen.
 *
 * One `MediaQueryList` is shared by every caller, so the number of rows does
 * not change the number of listeners, and `useSyncExternalStore` re-renders
 * them only when the breakpoint is actually crossed.
 */
export function useCompactSidebar(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
