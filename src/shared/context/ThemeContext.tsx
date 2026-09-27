import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  BUILT_IN_THEMES,
  DEFAULT_COLOR_THEME_ID,
  applyColorThemeToDocument,
  isDarkModeActiveFor,
  readImportedThemes,
  readStoredDarkMode,
  resolveColorTheme,
} from '@/shared/themes';
import type { ColorTheme } from '@/shared/types';
import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';

type ThemeContextValue = {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  /**
   * False while a theme that fixes its own appearance is active. Toggling dark
   * mode under such a theme would flip the `dark:` utility classes away from the
   * palette, so the settings UI disables the switch rather than lying about it.
   */
  canToggleDarkMode: boolean;
  colorTheme: string;
  setColorTheme: (themeId: string) => void;
  availableThemes: ColorTheme[];
  addImportedTheme: (theme: ColorTheme) => void;
  removeImportedTheme: (themeId: string) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

/** Mounted once by App so every module can read and switch the colour theme through useTheme. */
export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  // Check for saved theme preference or default to system preference. The
  // stored theme is read synchronously from the preference mirror so the very
  // first paint is already the right colour.
  const [isDarkMode, setIsDarkMode] = useState(readStoredDarkMode);

  // The palette is a second, independent axis: which set of colour variables is
  // in force, as opposed to whether the app is in light or dark mode.
  const [colorTheme, setColorThemeState] = useState(
    () => readUserPreference<string>('colorTheme', DEFAULT_COLOR_THEME_ID),
  );

  // Themes converted from VS Code files. They carry their own variables because
  // they arrive at runtime and so have no stylesheet in the bundle.
  const [importedThemes, setImportedThemes] = useState<ColorTheme[]>(readImportedThemes);

  // The theme now lives in auth.db, so a change made on another device (or in
  // another tab) arrives through the preference store rather than a re-render.
  useEffect(() => subscribeToUserPreferences(() => {
    const savedTheme = readUserPreference<string | null>('theme', null);
    if (savedTheme) {
      setIsDarkMode(savedTheme === 'dark');
    }
    setColorThemeState(readUserPreference<string>('colorTheme', DEFAULT_COLOR_THEME_ID));
    setImportedThemes(readImportedThemes());
  }), []);

  const availableThemes = useMemo(
    () => [...BUILT_IN_THEMES, ...importedThemes],
    [importedThemes],
  );

  const activeTheme = useMemo(
    () => resolveColorTheme(colorTheme, importedThemes),
    [colorTheme, importedThemes],
  );

  // Only the default theme ships both variants; every other palette states which
  // one it is, and the `dark` class has to follow it or the `dark:` utility
  // classes sprinkled through the app would contradict the variables.
  const isDarkModeActive = isDarkModeActiveFor(activeTheme, isDarkMode);

  // Applying the theme to the document and persisting it are deliberately
  // separate. Persisting from here would also fire on mount — before the stored
  // theme had been fetched — writing this device's system default over the
  // theme the user actually chose on another one.
  useEffect(() => {
    applyColorThemeToDocument(activeTheme, importedThemes, isDarkModeActive);

    // Update iOS status bar style for the active mode
    const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (statusBarMeta) {
      statusBarMeta.setAttribute('content', isDarkModeActive ? 'black-translucent' : 'default');
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
  }, [activeTheme, importedThemes, isDarkModeActive]);

  // Listen for system theme changes
  useEffect(() => {
    if (!window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      // Only update if user hasn't manually set a preference
      const savedTheme = readUserPreference<string | null>('theme', null);
      if (!savedTheme) {
        setIsDarkMode(e.matches);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // The only writer: a theme is stored because the user picked it, never
  // because this device happened to start on one.
  const toggleDarkMode = useCallback(() => {
    setIsDarkMode((previous) => {
      const next = !previous;
      writeUserPreference('theme', next ? 'dark' : 'light');
      return next;
    });
  }, []);

  const setColorTheme = useCallback((themeId: string) => {
    setColorThemeState(themeId);
    writeUserPreference('colorTheme', themeId);
  }, []);

  const addImportedTheme = useCallback((theme: ColorTheme) => {
    setImportedThemes((previous) => {
      const next = [...previous.filter((existing) => existing.id !== theme.id), theme];
      writeUserPreference('importedThemes', next);
      return next;
    });
  }, []);

  const removeImportedTheme = useCallback((themeId: string) => {
    setImportedThemes((previous) => {
      const next = previous.filter((theme) => theme.id !== themeId);
      writeUserPreference('importedThemes', next);
      return next;
    });
    // Deleting the palette that is currently on would otherwise leave the app
    // showing a theme the user just removed until the next reload.
    setColorThemeState((current) => {
      if (current !== themeId) {
        return current;
      }
      writeUserPreference('colorTheme', DEFAULT_COLOR_THEME_ID);
      return DEFAULT_COLOR_THEME_ID;
    });
  }, []);

  // A fresh object here would re-render every consumer in the app on any
  // render of this provider, theme change or not.
  const value = useMemo<ThemeContextValue>(
    () => ({
      isDarkMode: isDarkModeActive,
      toggleDarkMode,
      canToggleDarkMode: activeTheme.appearance === 'system',
      colorTheme: activeTheme.id,
      setColorTheme,
      availableThemes,
      addImportedTheme,
      removeImportedTheme,
    }),
    [
      isDarkModeActive,
      toggleDarkMode,
      activeTheme,
      setColorTheme,
      availableThemes,
      addImportedTheme,
      removeImportedTheme,
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
