import type { ColorTheme } from '@/shared/types';
import { readUserPreference } from '@/shared/userSettings';

/**
 * The colour theme registry.
 *
 * Adding a theme is a CSS file next to this one, its side-effect import below
 * and one entry in BUILT_IN_THEMES — no component ever needs to change, because
 * everything already reads `hsl(var(--background))` and friends.
 *
 * The stylesheets are imported here rather than from `index.css` so that each
 * one is a standalone PostCSS input: `@layer base` in an @imported file has no
 * matching `@tailwind base` directive and Tailwind rejects it.
 */
import '@/shared/themes/default.css';
import '@/shared/themes/catppuccin-latte.css';
import '@/shared/themes/catppuccin-frappe.css';
import '@/shared/themes/catppuccin-macchiato.css';
import '@/shared/themes/catppuccin-mocha.css';

/** The palette a user gets before they ever open the theme picker. */
export const DEFAULT_COLOR_THEME_ID = 'default';

/** The themes that ship with the app, in the order the picker lists them. */
export const BUILT_IN_THEMES: ColorTheme[] = [
  {
    id: DEFAULT_COLOR_THEME_ID,
    name: 'Default',
    // The only theme that ships both variants, so it is the only one that
    // leaves the light/dark choice to the user.
    appearance: 'system',
    previewColors: ['#f7f6f3', '#ffffff', '#2563eb'],
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    appearance: 'light',
    previewColors: ['#e6e9ef', '#eff1f5', '#1e66f5'],
  },
  {
    id: 'catppuccin-frappe',
    name: 'Catppuccin Frappé',
    appearance: 'dark',
    previewColors: ['#292c3c', '#303446', '#8caaee'],
  },
  {
    id: 'catppuccin-macchiato',
    name: 'Catppuccin Macchiato',
    appearance: 'dark',
    previewColors: ['#1e2030', '#24273a', '#8aadf4'],
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    appearance: 'dark',
    previewColors: ['#181825', '#1e1e2e', '#89b4fa'],
  },
];

export { parseVsCodeTheme, VsCodeThemeImportError } from '@/shared/themes/vscodeThemeImport';

/** The style element every imported theme's variables are written into. */
const IMPORTED_THEMES_STYLE_ID = 'imported-color-themes';

/** The imported palettes the preference store holds, or none if it holds something else. */
export function readImportedThemes(): ColorTheme[] {
  const stored = readUserPreference<unknown>('importedThemes', null);
  return Array.isArray(stored) ? (stored as ColorTheme[]) : [];
}

/**
 * The theme an id names, or the default.
 *
 * A stored id can outlive its theme — the user deletes an imported palette on
 * one device while another still has it selected — and that device has to land
 * on a working palette rather than on no variables at all.
 */
export function resolveColorTheme(themeId: string, importedThemes: ColorTheme[]): ColorTheme {
  return [...BUILT_IN_THEMES, ...importedThemes].find((theme) => theme.id === themeId)
    ?? BUILT_IN_THEMES[0];
}

/**
 * The light/dark choice to start from: the user's if they have made one, this
 * device's system setting otherwise.
 */
export function readStoredDarkMode(): boolean {
  const savedTheme = readUserPreference<string | null>('theme', null);
  if (savedTheme) {
    return savedTheme === 'dark';
  }

  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  return false;
}

/** Whether the `dark` class belongs on the document for this theme and choice. */
export function isDarkModeActiveFor(theme: ColorTheme, prefersDarkMode: boolean): boolean {
  return theme.appearance === 'system' ? prefersDarkMode : theme.appearance === 'dark';
}

/**
 * Puts a palette on the document: the variables of any imported theme, the
 * `data-theme` the stylesheets key off, and the `dark` class the utility
 * classes read.
 */
export function applyColorThemeToDocument(
  theme: ColorTheme,
  importedThemes: ColorTheme[],
  isDarkMode: boolean,
): void {
  const css = buildImportedThemesCss(importedThemes);
  let styleElement = document.getElementById(IMPORTED_THEMES_STYLE_ID);

  if (!css) {
    styleElement?.remove();
  } else {
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = IMPORTED_THEMES_STYLE_ID;
      document.head.appendChild(styleElement);
    }
    styleElement.textContent = css;
  }

  document.documentElement.dataset.theme = theme.id;
  document.documentElement.classList.toggle('dark', isDarkMode);
}

/**
 * Applies the stored palette before React mounts.
 *
 * ThemeProvider does the same thing from an effect, which React flushes after
 * the first paint — long enough to show a frame of the default cream palette to
 * someone whose theme is Mocha. Called from main.tsx, this makes that frame
 * already correct; the provider then converges on the same values.
 */
export function applyStoredColorTheme(): void {
  const importedThemes = readImportedThemes();
  const theme = resolveColorTheme(
    readUserPreference<string>('colorTheme', DEFAULT_COLOR_THEME_ID),
    importedThemes,
  );
  applyColorThemeToDocument(theme, importedThemes, isDarkModeActiveFor(theme, readStoredDarkMode()));
}

/**
 * Renders imported themes as CSS.
 *
 * `:root[data-theme=...]` matches the specificity built-in theme files use, so
 * an imported theme overrides the defaults on the same terms — and, being
 * injected into a single style element, replaces its predecessor wholesale.
 */
export function buildImportedThemesCss(themes: ColorTheme[]): string {
  return themes
    .filter((theme) => theme.tokens)
    .map((theme) => {
      const declarations = Object.entries(theme.tokens ?? {})
        .map(([name, value]) => `  --${name}: ${value};`)
        .join('\n');
      return `:root[data-theme="${cssEscapeThemeId(theme.id)}"] {\n${declarations}\n}`;
    })
    .join('\n\n');
}

/**
 * Strips anything that could break out of the attribute selector above.
 *
 * Imported theme ids are generated, not user-supplied, so this is belt and
 * braces against a hand-edited preferences payload rather than a live hazard.
 */
function cssEscapeThemeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}
