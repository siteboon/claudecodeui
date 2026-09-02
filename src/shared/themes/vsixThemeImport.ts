import type { ColorTheme } from '@/shared/types';
import type { VsCodeThemeFile } from '@/shared/themes/vscodeThemeImport';
import {
  VsCodeThemeImportError,
  createThemeFromFile,
  parseJsonc,
} from '@/shared/themes/vscodeThemeImport';

/**
 * Reads the colour themes out of a `.vsix` extension.
 *
 * A `.vsix` is a zip: `extension/package.json` lists what the extension
 * contributes, and each theme contribution points at a JSON file elsewhere in
 * the archive. Supporting it saves the user from unpacking the extension by
 * hand, and it is the only way to import the many themes whose files `include`
 * a base theme — that reference resolves inside the archive, and nowhere else.
 *
 * One extension often contributes several themes (a flavour per variant), so
 * this returns all of them rather than picking one.
 */

/** Where every VS Code extension declares itself inside the archive. */
const MANIFEST_PATH = 'extension/package.json';

/** The directory theme paths in the manifest are relative to. */
const EXTENSION_ROOT = 'extension';

/**
 * Large enough for the heaviest themed extensions, which ship screenshots and
 * icons alongside a few kilobytes of colours, and small enough that a wrong
 * file is rejected before it is unzipped in the browser.
 */
const MAX_VSIX_BYTES = 60_000_000;

/** Deep enough for the longest `include` chains published, shallow enough to stop a cycle. */
const MAX_INCLUDE_DEPTH = 8;

/** One entry of `contributes.themes` in an extension's manifest. */
type ThemeContribution = {
  path: string;
  label?: string;
  uiTheme?: string;
};

/** The subset of JSZip this needs, so the dynamic import stays typed. */
type ThemeArchive = {
  file(path: string): { async(type: 'string'): Promise<string> } | null;
};

export async function parseVsixThemes(data: ArrayBuffer, fallbackName: string): Promise<ColorTheme[]> {
  if (data.byteLength > MAX_VSIX_BYTES) {
    throw new VsCodeThemeImportError('That .vsix is too large to import.');
  }

  // Imported on demand: unzipping is only ever needed when someone actually
  // picks a .vsix, so the JSON path does not pull a zip library into its chunk.
  const { default: JSZip } = await import('jszip');

  let archive: ThemeArchive;
  try {
    archive = await JSZip.loadAsync(data);
  } catch {
    throw new VsCodeThemeImportError('That file could not be opened as a .vsix archive.');
  }

  const manifestEntry = archive.file(MANIFEST_PATH);
  if (!manifestEntry) {
    throw new VsCodeThemeImportError(
      'That archive has no extension/package.json, so it is not a VS Code extension.',
    );
  }

  const manifest = parseJsonc(await manifestEntry.async('string')) as VsCodeThemeFile & {
    contributes?: unknown;
  };
  const contributions = readThemeContributions(manifest);
  if (contributions.length === 0) {
    throw new VsCodeThemeImportError('That extension contributes no colour themes.');
  }

  const themes: ColorTheme[] = [];
  let lastFailure: unknown = null;

  for (const contribution of contributions) {
    try {
      const path = resolveArchivePath(EXTENSION_ROOT, contribution.path);
      const file = await readThemeFile(archive, path, 0);
      // The manifest label wins over the theme file's own `name`, the way VS
      // Code's own picker labels them: every One Dark Pro variant calls itself
      // "One Dark Pro" internally, and only the manifest tells Flat from Darker.
      const named = contribution.label ? { ...file, name: contribution.label } : file;
      themes.push(createThemeFromFile(named, fallbackName, contribution.uiTheme));
    } catch (error) {
      // One broken variant must not cost the user the others, so failures are
      // held back and only reported if nothing at all could be imported.
      lastFailure = error;
    }
  }

  if (themes.length === 0) {
    throw lastFailure instanceof VsCodeThemeImportError
      ? lastFailure
      : new VsCodeThemeImportError('None of the themes in that extension could be read.');
  }

  return themes;
}

/**
 * Reads one theme file, merging whatever it `include`s underneath it.
 *
 * VS Code resolves `include` relative to the including file, and the including
 * file wins on every key it sets.
 */
async function readThemeFile(
  archive: ThemeArchive,
  path: string,
  depth: number,
): Promise<VsCodeThemeFile> {
  const entry = archive.file(path);
  if (!entry) {
    throw new VsCodeThemeImportError(`The extension points at "${path}", which is not in the archive.`);
  }

  const file = parseJsonc(await entry.async('string'));
  const include = typeof file.include === 'string' ? file.include : null;
  if (!include || depth >= MAX_INCLUDE_DEPTH) {
    return file;
  }

  const includedPath = resolveArchivePath(directoryOf(path), include);
  const included = await readThemeFile(archive, includedPath, depth + 1);
  return mergeThemeFiles(included, file);
}

function mergeThemeFiles(base: VsCodeThemeFile, override: VsCodeThemeFile): VsCodeThemeFile {
  return {
    name: override.name ?? base.name,
    type: override.type ?? base.type,
    colors: { ...asRecord(base.colors), ...asRecord(override.colors) },
    tokenColors: [...asArray(base.tokenColors), ...asArray(override.tokenColors)],
  };
}

function readThemeContributions(manifest: { contributes?: unknown }): ThemeContribution[] {
  const contributes = isRecord(manifest.contributes) ? manifest.contributes : null;
  const entries = contributes && Array.isArray(contributes.themes) ? contributes.themes : [];

  const contributions: ThemeContribution[] = [];
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.path !== 'string') {
      continue;
    }
    contributions.push({
      path: entry.path,
      label: typeof entry.label === 'string' ? entry.label : undefined,
      uiTheme: typeof entry.uiTheme === 'string' ? entry.uiTheme : undefined,
    });
  }
  return contributions;
}

/**
 * Resolves a manifest-relative path against the archive's flat, forward-slashed
 * key space, where `./` and `../` have to be collapsed by hand.
 */
function resolveArchivePath(fromDirectory: string, relativePath: string): string {
  const resolved: string[] = [];
  for (const segment of `${fromDirectory}/${relativePath}`.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join('/');
}

function directoryOf(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator === -1 ? '' : path.slice(0, separator);
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
