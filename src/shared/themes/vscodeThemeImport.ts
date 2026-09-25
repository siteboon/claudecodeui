import type { ColorTheme, ThemeAppearance, ThemeTokens } from '@/shared/types';

/**
 * Turns a VS Code colour theme into one of this app's palettes.
 *
 * A VS Code theme names ~200 workbench surfaces; this app names 19 semantic
 * roles. The mapping is therefore a chain of fallbacks per role — themes are
 * free to omit any key, and the ones they omit are the ones VS Code itself
 * derives — with anything still missing computed from the two keys no theme
 * can leave out, `editor.background` and `editor.foreground`.
 *
 * Only the `colors` block is read. `tokenColors` drives syntax highlighting,
 * which this app renders with Prism and CodeMirror rather than TextMate scopes.
 */

/**
 * The shape this reads out of a theme file; every field is optional because the
 * file is untrusted.
 *
 * Exported for the .vsix importer, which parses theme files out of the archive
 * itself so it can resolve their `include` chains before building a palette.
 */
export type VsCodeThemeFile = {
  name?: unknown;
  type?: unknown;
  colors?: unknown;
  include?: unknown;
  tokenColors?: unknown;
};

type Rgb = { r: number; g: number; b: number };

/**
 * Big enough for the largest themes on the marketplace (a few hundred KB with
 * their token colours), small enough that a wrong file is rejected before it is
 * parsed and stored in the user's synced preferences.
 */
const MAX_THEME_SOURCE_BYTES = 2_000_000;

/** The id prefix imported themes get, so they can never collide with a built-in one. */
const IMPORTED_THEME_ID_PREFIX = 'imported-';

/** Thrown for every rejected file so the settings UI can show one message. */
export class VsCodeThemeImportError extends Error {}

/**
 * Parses a `*-color-theme.json` file into a ready-to-register theme.
 *
 * `fallbackName` is used when the file carries no `name` — VS Code themes
 * shipped inside an extension declare their name in `package.json` instead, so
 * the caller passes the file name.
 */
export function parseVsCodeTheme(source: string, fallbackName = 'Imported theme'): ColorTheme {
  if (source.length > MAX_THEME_SOURCE_BYTES) {
    throw new VsCodeThemeImportError('That file is too large to be a colour theme.');
  }

  return createThemeFromFile(parseJsonc(source), fallbackName);
}

/**
 * Builds a palette from an already-parsed theme file.
 *
 * Used by the .vsix importer: an extension's theme files reach it through the
 * archive rather than as one string, and their `include` chains are merged
 * before this sees them.
 *
 * `uiThemeHint` is the `uiTheme` an extension's package.json declares for the
 * contribution, which stands in when the theme file itself omits `type`.
 */
export function createThemeFromFile(
  file: VsCodeThemeFile,
  fallbackName: string,
  uiThemeHint?: string,
): ColorTheme {
  const colors = readColorMap(file);

  const background = requireColor(
    colors,
    ['editor.background', 'editorGroup.background', 'sideBar.background'],
    'This file has no "editor.background", so it is not a VS Code colour theme. Themes that only "include" another file cannot be imported on their own.',
  );
  const foreground = requireColor(
    colors,
    ['editor.foreground', 'foreground', 'editorCursor.foreground'],
    'This file has no "editor.foreground", so it is not a VS Code colour theme.',
  );

  const appearance = readAppearance(file.type ?? uiThemeHint, background);
  // Every colour below is flattened against the background, because VS Code
  // themes routinely give surfaces an alpha channel (`#ffffff0a` for a hover
  // row) that CSS custom properties cannot reproduce once the value is baked
  // into an `hsl()` triplet.
  const resolve = (keys: string[], fallback: Rgb) => pick(colors, keys, background) ?? fallback;

  const card = resolve(
    ['editorWidget.background', 'sideBar.background', 'panel.background', 'activityBar.background'],
    shift(background, foreground, 0.04),
  );
  const popover = resolve(
    ['menu.background', 'dropdown.background', 'editorWidget.background', 'quickInput.background'],
    card,
  );
  // The accent, not the button chrome: One Dark Pro's `button.background` is a
  // flat grey and Solarized Light's is olive, while both name their real accent
  // on the activity-bar badge. `--primary` tints tabs, links, focus rings and
  // the active nav here, so a chrome grey would drain the whole UI.
  const primary = resolve(
    [
      'activityBarBadge.background',
      'textLink.foreground',
      'button.background',
      'progressBar.background',
      'focusBorder',
    ],
    shift(background, foreground, 0.6),
  );
  const muted = resolve(
    ['list.hoverBackground', 'input.background', 'editor.lineHighlightBackground', 'toolbar.hoverBackground'],
    shift(background, foreground, 0.1),
  );
  const mutedForeground = resolve(
    ['descriptionForeground', 'editorLineNumber.foreground', 'editorHint.foreground'],
    shift(foreground, background, 0.35),
  );
  const destructive = resolve(
    ['editorError.foreground', 'errorForeground', 'notificationsErrorIcon.foreground', 'inputValidation.errorBorder'],
    { r: 220, g: 60, b: 70 },
  );
  const border = resolve(
    ['panel.border', 'editorGroup.border', 'widget.border', 'contrastBorder', 'menu.border'],
    shift(background, foreground, 0.14),
  );
  const input = resolve(['input.border', 'dropdown.border', 'checkbox.border'], border);

  const tokens: ThemeTokens = {
    background: hsl(background),
    foreground: hsl(foreground),
    card: hsl(card),
    'card-foreground': hsl(foreground),
    popover: hsl(popover),
    'popover-foreground': hsl(foreground),
    primary: hsl(primary),
    // Computed rather than read from `button.foreground`, which pairs with the
    // button background this no longer takes the accent from.
    'primary-foreground': hsl(readableOn(primary, background, foreground)),
    secondary: hsl(muted),
    'secondary-foreground': hsl(foreground),
    muted: hsl(muted),
    'muted-foreground': hsl(mutedForeground),
    accent: hsl(muted),
    'accent-foreground': hsl(foreground),
    destructive: hsl(destructive),
    'destructive-foreground': hsl(readableOn(destructive, background, foreground)),
    border: hsl(border),
    input: hsl(input),
    // Both shipped themes set the ring to their primary; an imported one has no
    // reason to differ, and a theme's own `focusBorder` is often a dark grey
    // that would leave keyboard focus almost invisible.
    ring: hsl(primary),

    // Derived exactly the way the built-in themes derive them, so an imported
    // palette gets the same floating-nav treatment as a shipped one.
    'nav-glass-bg': hsl(card, appearance === 'light' ? 0.7 : 0.55),
    'nav-glass-blur': appearance === 'light' ? '20px' : '24px',
    'nav-glass-saturate': appearance === 'light' ? '1.8' : '1.6',
    'nav-tab-glow': hsl(primary, appearance === 'light' ? 0.18 : 0.25),
    'nav-tab-ring': hsl(primary, appearance === 'light' ? 0.1 : 0.15),
    'nav-float-shadow': `0 0% 0% / ${appearance === 'light' ? 0.06 : 0.35}`,
    'nav-float-ring': hsl(border, appearance === 'light' ? 0.5 : 0.3),
    'nav-divider-color': hsl(border, 0.5),
    'nav-input-bg': hsl(muted, 0.5),
    'nav-input-focus-ring': hsl(primary, appearance === 'light' ? 0.22 : 0.25),
  };

  const name = typeof file.name === 'string' && file.name.trim() ? file.name.trim() : fallbackName;

  return {
    id: `${IMPORTED_THEME_ID_PREFIX}${slugify(name)}-${randomSuffix()}`,
    name,
    appearance,
    previewColors: [toHex(background), toHex(card), toHex(primary)],
    tokens,
  };
}

/**
 * Parses the JSON-with-comments VS Code accepts.
 *
 * Published themes are full of `//` notes and trailing commas, so `JSON.parse`
 * alone rejects a large share of real files. The string-aware scan is what
 * keeps a `//` inside a colour name or a description from being cut out.
 */
export function parseJsonc(source: string): VsCodeThemeFile {
  // A leading byte-order mark is common in hand-edited theme files and makes
  // JSON.parse reject the whole document.
  if (source.charCodeAt(0) === 0xfeff) {
    source = source.slice(1);
  }

  let out = '';
  let index = 0;
  let inString = false;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        index += 2;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }

    out += char;
    index += 1;
  }

  // Trailing commas are legal in JSONC and common in hand-edited themes.
  out = stripTrailingCommas(out);

  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new VsCodeThemeImportError('That file is not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new VsCodeThemeImportError('That file is not a VS Code colour theme.');
  }

  return parsed as VsCodeThemeFile;
}

/**
 * Drops the commas that sit before a closing brace or bracket.
 *
 * String-aware, because a theme is free to contain `"name": "Night,}"` — a
 * blanket regex turns that into `"Night}"` and imports the theme under a name
 * it never had.
 */
function stripTrailingCommas(source: string): string {
  let out = '';
  let inString = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      out += char;
      if (char === '\\') {
        index += 1;
        out += source[index] ?? '';
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === ',') {
      // Comments are already gone by this point, so the next non-space
      // character is the one that decides whether this comma is structural.
      let next = index + 1;
      while (next < source.length && /\s/.test(source[next])) {
        next += 1;
      }
      if (source[next] === '}' || source[next] === ']') {
        continue;
      }
    }

    out += char;
  }

  return out;
}

function readColorMap(file: VsCodeThemeFile): Record<string, string> {
  const { colors } = file;
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) {
    throw new VsCodeThemeImportError('That file has no "colors" block, so there is nothing to import.');
  }

  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors as Record<string, unknown>)) {
    if (typeof value === 'string') {
      map[key] = value;
    }
  }
  return map;
}

/**
 * Decides light or dark.
 *
 * `type` is the theme's own declaration and is trusted first; the high-contrast
 * variants (`hcDark`, `hc-black`) are dark themes under another name. A theme
 * that omits `type` is classified by how bright its editor background is.
 */
function readAppearance(type: unknown, background: Rgb): ThemeAppearance {
  if (typeof type === 'string') {
    const normalized = type.toLowerCase();
    if (normalized === 'light' || normalized === 'vs' || normalized === 'hclight' || normalized === 'hc-light') {
      return 'light';
    }
    if (normalized === 'dark' || normalized === 'vs-dark' || normalized === 'hcdark' || normalized === 'hc-black') {
      return 'dark';
    }
  }

  return luminance(background) > 0.5 ? 'light' : 'dark';
}

function requireColor(colors: Record<string, string>, keys: string[], message: string): Rgb {
  const found = pick(colors, keys, null);
  if (!found) {
    throw new VsCodeThemeImportError(message);
  }
  return found;
}

/** First key that holds a parseable colour, flattened against `base` when translucent. */
function pick(colors: Record<string, string>, keys: string[], base: Rgb | null): Rgb | null {
  for (const key of keys) {
    const parsed = parseHexColor(colors[key]);
    if (!parsed) {
      continue;
    }
    if (parsed.a >= 1 || !base) {
      return { r: parsed.r, g: parsed.g, b: parsed.b };
    }
    return flatten(parsed, base);
  }
  return null;
}

/** VS Code themes are hex-only: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. */
function parseHexColor(value: string | undefined): (Rgb & { a: number }) | null {
  if (typeof value !== 'string') {
    return null;
  }

  const hex = value.trim().replace(/^#/, '');
  const expand = (part: string) => parseInt(part.length === 1 ? part + part : part, 16);

  if (hex.length === 3 || hex.length === 4) {
    const [r, g, b, a] = hex.split('');
    if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
    return { r: expand(r), g: expand(g), b: expand(b), a: a === undefined ? 1 : expand(a) / 255 };
  }

  if (hex.length === 6 || hex.length === 8) {
    if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
    return {
      r: expand(hex.slice(0, 2)),
      g: expand(hex.slice(2, 4)),
      b: expand(hex.slice(4, 6)),
      a: hex.length === 8 ? expand(hex.slice(6, 8)) / 255 : 1,
    };
  }

  return null;
}

/** Composites a translucent colour over an opaque one. */
function flatten(color: Rgb & { a: number }, base: Rgb): Rgb {
  return {
    r: color.r * color.a + base.r * (1 - color.a),
    g: color.g * color.a + base.g * (1 - color.a),
    b: color.b * color.a + base.b * (1 - color.a),
  };
}

/** Moves `from` the given fraction of the way towards `towards`; the fallback for any role a theme omits. */
function shift(from: Rgb, towards: Rgb, amount: number): Rgb {
  return {
    r: from.r + (towards.r - from.r) * amount,
    g: from.g + (towards.g - from.g) * amount,
    b: from.b + (towards.b - from.b) * amount,
  };
}

/**
 * Picks the most legible text colour for `surface`.
 *
 * The theme's own two extremes come first so a button keeps the palette's
 * character, but black and white are candidates too: Solarized Light's
 * foreground is a mid grey that all but disappears on its own yellow accent.
 * Whichever candidate has the highest contrast ratio wins.
 */
function readableOn(surface: Rgb, background: Rgb, foreground: Rgb): Rgb {
  const candidates: Rgb[] = [
    background,
    foreground,
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 255, b: 255 },
  ];

  let best = candidates[0];
  let bestContrast = -1;
  for (const candidate of candidates) {
    const contrast = contrastRatio(surface, candidate);
    if (contrast > bestContrast) {
      best = candidate;
      bestContrast = contrast;
    }
  }
  return best;
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = relativeLuminance(a) > relativeLuminance(b)
    ? [relativeLuminance(a), relativeLuminance(b)]
    : [relativeLuminance(b), relativeLuminance(a)];
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG relative luminance, on the linearized sRGB channels the formula requires. */
function relativeLuminance({ r, g, b }: Rgb): number {
  const linear = (channel: number) => {
    const value = clampChannel(channel) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Perceived brightness on 0..1, used only to tell a light theme from a dark one. */
function luminance({ r, g, b }: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Serialises to the `h s% l%` triplet Tailwind's `hsl(var(--token))` expects. */
function hsl(color: Rgb, alpha?: number): string {
  const r = clampChannel(color.r) / 255;
  const g = clampChannel(color.g) / 255;
  const b = clampChannel(color.b) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;

  let hue = 0;
  let saturation = 0;

  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === r) {
      hue = ((g - b) / delta) % 6;
    } else if (max === g) {
      hue = (b - r) / delta + 2;
    } else {
      hue = (r - g) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  const triplet = `${round(hue)} ${round(saturation * 100)}% ${round(lightness * 100)}%`;
  return alpha === undefined ? triplet : `${triplet} / ${alpha}`;
}

function toHex(color: Rgb): string {
  const part = (value: number) => clampChannel(value).toString(16).padStart(2, '0');
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'theme';
}

/** Keeps two imports of the same theme file from sharing an id. */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}
