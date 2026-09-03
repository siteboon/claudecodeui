import type { ColorTheme } from '@/shared/types';
import { parseVsCodeTheme } from '@/shared/themes/vscodeThemeImport';
import { parseVsixThemes } from '@/shared/themes/vsixThemeImport';
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
];

export { parseVsCodeTheme, VsCodeThemeImportError } from '@/shared/themes/vscodeThemeImport';
export { parseVsixThemes } from '@/shared/themes/vsixThemeImport';

/**
 * Reads every palette a picked file holds.
 *
 * The two accepted shapes are a bare `*-color-theme.json` and a whole `.vsix`
 * extension, told apart by the zip signature rather than by the extension in
 * the name — a theme downloaded from the marketplace is often saved without
 * one, or with the wrong one.
 */
export async function importThemesFromFile(file: File): Promise<ColorTheme[]> {
  const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const isArchive = signature[0] === 0x50 && signature[1] === 0x4b;

  // An extension names its themes in its manifest and a theme file names itself,
  // so the file name is only the last resort for both.
  const fallbackName = file.name.replace(/(-color-theme)?\.(json|vsix)$/i, '');

  if (isArchive) {
    return parseVsixThemes(await file.arrayBuffer(), fallbackName);
  }
  return [parseVsCodeTheme(await file.text(), fallbackName)];
}

/** The style element every imported theme's variables are written into. */
const IMPORTED_THEMES_STYLE_ID = 'imported-color-themes';

/**
 * The imported palettes the preference store holds.
 *
 * Every entry is validated rather than trusted: the value round-trips through
 * the server as opaque JSON, and a single `null` in the array would otherwise
 * be read for its `id` during the first render — crashing the app before the
 * user could reach Settings to remove it.
 */
export function readImportedThemes(): ColorTheme[] {
  const stored = readUserPreference<unknown>('importedThemes', null);
  return Array.isArray(stored) ? stored.filter(isColorTheme) : [];
}

function isColorTheme(value: unknown): value is ColorTheme {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const theme = value as Partial<ColorTheme>;
  return typeof theme.id === 'string'
    && Boolean(theme.id)
    && typeof theme.name === 'string'
    && (theme.appearance === 'light' || theme.appearance === 'dark' || theme.appearance === 'system')
    && Array.isArray(theme.previewColors)
    && theme.previewColors.every((color) => typeof color === 'string')
    && (theme.tokens === undefined || isTokenRecord(theme.tokens));
}

function isTokenRecord(value: unknown): boolean {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((token) => typeof token === 'string');
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
