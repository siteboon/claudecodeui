import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
  BUILT_IN_THEMES,
  DEFAULT_COLOR_THEME_ID,
  SLOT_PREFERENCE_KEYS,
  applyColorThemeToDocument,
  isThemeAllowedInSlot,
  mergeImportedThemes,
  readImportedThemes,
  readStoredSlotThemeId,
  readStoredThemeMode,
  resolveIsDarkMode,
  resolveSlotTheme,
} from '@/shared/themes';
import type { ColorTheme, ThemeMode, ThemeSlot, ThemeSource } from '@/shared/types';
import {
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';

type ThemeContextValue = {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  /** The slot the dark-mode setting currently puts in force. */
  activeSlot: ThemeSlot;
  /** The theme id in each slot, resolved: a missing or unfitting id reads as the default. */
  slotThemes: Record<ThemeSlot, string>;
  setSlotTheme: (slot: ThemeSlot, themeId: string) => void;
  availableThemes: ColorTheme[];
  /**
   * Stores imported themes and returns the ids they were stored under, in the
   * order given. Themes from an extension (`source`) replace that extension's
   * earlier ones.
   */
  installImportedThemes: (themes: ColorTheme[], source?: ThemeSource) => string[];
  /** Removes imported themes; a slot that held one goes back to the default. */
  removeImportedThemes: (themeIds: string[]) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

const readStoredSlotThemeIds = (): Record<ThemeSlot, string> => ({
  light: readStoredSlotThemeId('light'),
  dark: readStoredSlotThemeId('dark'),
});

/** Mounted once by App so every module can read and switch the colour theme through useTheme. */
export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  // The mode the user chose, not the colour it currently resolves to: only the
  // mode is persisted, and `system` has to keep tracking the OS afterwards.
  // Read synchronously from the preference mirror so the very first paint is
  // already the right colour.
  const [themeMode, setThemeModeState] = useState<ThemeMode>(readStoredThemeMode);
  // The resolved colour. It is not derivable from `themeMode` alone, because
  // under `system` it changes when the OS does, with no state change here.
  const [isDarkMode, setIsDarkMode] = useState(() => resolveIsDarkMode(readStoredThemeMode()));

  // The palette picked for each mode, as stored; `isDarkMode` picks which one shows.
  const [storedSlotThemes, setStoredSlotThemes] = useState(readStoredSlotThemeIds);

  // Themes converted from VS Code files. They carry their own variables because
  // they arrive at runtime and so have no stylesheet in the bundle.
  const [importedThemes, setImportedThemes] = useState<ColorTheme[]>(readImportedThemes);
  // The latest list, for installImportedThemes: it returns the ids it assigned
  // synchronously, and a state updater runs too late for that.
  const importedThemesRef = useRef(importedThemes);

  // The theme now lives in auth.db, so a change made on another device (or in
  // another tab) arrives through the preference store rather than a re-render.
  useEffect(() => subscribeToUserPreferences(() => {
    const storedMode = readStoredThemeMode();
    setThemeModeState(storedMode);
    setIsDarkMode(resolveIsDarkMode(storedMode));
    setStoredSlotThemes(readStoredSlotThemeIds());
    const storedThemes = readImportedThemes();
    importedThemesRef.current = storedThemes;
    setImportedThemes(storedThemes);
  }), []);

  const availableThemes = useMemo(
    () => [...BUILT_IN_THEMES, ...importedThemes],
    [importedThemes],
  );

  const lightTheme = useMemo(
    () => resolveSlotTheme(storedSlotThemes.light, 'light', importedThemes),
    [storedSlotThemes.light, importedThemes],
  );
  const darkTheme = useMemo(
    () => resolveSlotTheme(storedSlotThemes.dark, 'dark', importedThemes),
    [storedSlotThemes.dark, importedThemes],
  );
  const activeSlot: ThemeSlot = isDarkMode ? 'dark' : 'light';
  const activeTheme = isDarkMode ? darkTheme : lightTheme;

  // Applying the theme to the document and persisting it are deliberately
  // separate. Persisting from here would also fire on mount — before the stored
  // theme had been fetched — writing this device's system default over the
  // theme the user actually chose on another one.
  useEffect(() => {
    applyColorThemeToDocument(activeTheme, importedThemes, isDarkMode);

    // Update iOS status bar style for the active mode
    const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (statusBarMeta) {
      statusBarMeta.setAttribute('content', isDarkMode ? 'black-translucent' : 'default');
    }

    // Read the colour back off the document rather than hardcoding one per mode,
    // so every theme — including an imported one nobody could have hardcoded —
    // gets a status bar that matches its own background.
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    const background = hslTripletToHex(
      getComputedStyle(document.documentElement).getPropertyValue('--background'),
    );
    if (themeColorMeta && background) {
      themeColorMeta.setAttribute('content', background);
    }
  }, [activeTheme, importedThemes, isDarkMode]);

  // Listen for system theme changes
  useEffect(() => {
    if (!window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      // Re-read rather than close over `themeMode`: a change that arrived from
      // another device lands in the store first, and only `system` follows the OS.
      if (readStoredThemeMode() === 'system') {
        setIsDarkMode(e.matches);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // The only writer: a theme is stored because the user picked it, never
  // because this device happened to start on one.
  const setThemeMode = useCallback((mode: ThemeMode) => {
    writeUserPreference('theme', mode);
    setThemeModeState(mode);
    setIsDarkMode(resolveIsDarkMode(mode));
  }, []);

  // Kept for the callers that only offer a light/dark switch: choosing either
  // one is an explicit choice, so it leaves `system` behind exactly as before.
  const toggleDarkMode = useCallback(() => {
    setIsDarkMode((previous) => {
      const next = !previous;
      writeUserPreference('theme', next ? 'dark' : 'light');
      setThemeModeState(next ? 'dark' : 'light');
      return next;
    });
  }, []);

  const setSlotTheme = useCallback((slot: ThemeSlot, themeId: string) => {
    setStoredSlotThemes((current) => ({ ...current, [slot]: themeId }));
    writeUserPreference(SLOT_PREFERENCE_KEYS[slot], themeId);
  }, []);

  const storeImportedThemes = useCallback((next: ColorTheme[]) => {
    importedThemesRef.current = next;
    setImportedThemes(next);
    writeUserPreference('importedThemes', next);
  }, []);

  const installImportedThemes = useCallback((themes: ColorTheme[], source?: ThemeSource) => {
    const previous = importedThemesRef.current;
    const { themes: next, ids } = mergeImportedThemes(previous, themes, source);
    storeImportedThemes(next);
    // An update can drop a variant a slot held; move that slot to a variant the
    // update kept for the same mode, or back to the default.
    setStoredSlotThemes((current) => {
      const updated = { ...current };
      for (const slot of ['light', 'dark'] as const) {
        if (next.some((theme) => theme.id === current[slot]) || !previous.some((theme) => theme.id === current[slot])) {
          continue;
        }
        const replacement = next.find((theme) => ids.includes(theme.id) && isThemeAllowedInSlot(theme, slot));
        updated[slot] = replacement?.id ?? DEFAULT_COLOR_THEME_ID;
        writeUserPreference(SLOT_PREFERENCE_KEYS[slot], updated[slot]);
      }
      return updated;
    });
    return ids;
  }, [storeImportedThemes]);

  const removeImportedThemes = useCallback((themeIds: string[]) => {
    const removed = new Set(themeIds);
    storeImportedThemes(importedThemesRef.current.filter((theme) => !removed.has(theme.id)));
    // Written back so a slot never points at a theme the user just deleted.
    setStoredSlotThemes((current) => {
      const updated = { ...current };
      for (const slot of ['light', 'dark'] as const) {
        if (removed.has(current[slot])) {
          updated[slot] = DEFAULT_COLOR_THEME_ID;
          writeUserPreference(SLOT_PREFERENCE_KEYS[slot], DEFAULT_COLOR_THEME_ID);
        }
      }
      return updated;
    });
  }, [storeImportedThemes]);

  // A fresh object here would re-render every consumer in the app on any
  // render of this provider, theme change or not.
  const value = useMemo<ThemeContextValue>(
    () => ({
      isDarkMode,
      toggleDarkMode,
      themeMode,
      setThemeMode,
      activeSlot,
      slotThemes: { light: lightTheme.id, dark: darkTheme.id },
      setSlotTheme,
      availableThemes,
      installImportedThemes,
      removeImportedThemes,
    }),
    [
      isDarkMode,
      toggleDarkMode,
      themeMode,
      setThemeMode,
      activeSlot,
      lightTheme,
      darkTheme,
      setSlotTheme,
      availableThemes,
      installImportedThemes,
      removeImportedThemes,
    ],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

/**
 * Converts the `h s% l%` triplet a theme stores into the hex colour the
 * `theme-color` meta tag needs; empty when the variable is not resolvable yet,
 * which leaves the tag on its previous value rather than blanking it.
 */
function hslTripletToHex(triplet: string): string {
  const match = triplet.trim().match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  if (!match) {
    return '';
  }

  const hue = Number(match[1]);
  const saturation = Number(match[2]) / 100;
  const lightness = Number(match[3]) / 100;

  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;

  const [red, green, blue] = (() => {
    if (hue < 60) return [chroma, secondary, 0];
    if (hue < 120) return [secondary, chroma, 0];
    if (hue < 180) return [0, chroma, secondary];
    if (hue < 240) return [0, secondary, chroma];
    if (hue < 300) return [secondary, 0, chroma];
    return [chroma, 0, secondary];
  })();

  const toChannel = (value: number) => Math.round((value + offset) * 255)
    .toString(16)
    .padStart(2, '0');

  return `#${toChannel(red)}${toChannel(green)}${toChannel(blue)}`;
}
