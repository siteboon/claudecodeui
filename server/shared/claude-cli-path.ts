import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_CLAUDE_COMMAND = 'claude';
const CLAUDE_SCRIPT_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const CLAUDE_WRAPPER_SEGMENTS = ['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'] as const;
const NATIVE_EXECUTABLE_EXTENSION = '.exe';

/**
 * Extensions Windows appends to a bare command name while walking PATH. Used
 * only when the host does not export PATHEXT; the value mirrors the cmd.exe
 * default so a lookup stays equivalent to what `where.exe` would report.
 */
const DEFAULT_PATH_EXTENSIONS = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC';

export type ResolveClaudeCodeExecutablePathDependencies = {
  existsSync?: typeof fs.existsSync;
  pathEnvironment?: string;
  pathExtensions?: string;
  platform?: NodeJS.Platform;
  readFileSync?: typeof fs.readFileSync;
};

function getPathApi(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path;
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isPathLike(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

/**
 * Splits PATH into absolute, quote-stripped directories, preserving order and
 * dropping duplicates so a repeated entry cannot shadow a later install.
 */
function readPathEntries(pathEnvironment: string, pathApi: path.PlatformPath): string[] {
  const seen = new Set<string>();
  const entries: string[] = [];

  for (const rawEntry of pathEnvironment.split(pathApi.delimiter)) {
    const entry = stripWrappingQuotes(rawEntry);
    if (!entry) {
      continue;
    }

    const normalized = pathApi.resolve(entry);
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    entries.push(normalized);
  }

  return entries;
}

/**
 * Builds the extension list to try for a bare command. The empty extension is
 * included because npm installs a POSIX-style `claude` shim without one, and
 * `where.exe` reports it alongside `claude.cmd`.
 */
function readPathExtensions(pathExtensions: string | undefined): string[] {
  const configured = (pathExtensions ?? '')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  const extensions = configured.length > 0
    ? configured
    : DEFAULT_PATH_EXTENSIONS.split(';').map((extension) => extension.toLowerCase());

  return ['', ...extensions];
}

/**
 * Walks PATH exactly like Windows does: directory order first, extension order
 * within a directory, every hit verified against the filesystem.
 *
 * This replaces shelling out to `where.exe`, whose output is written in the
 * console code page. Reading those bytes as UTF-8 mangled any non-ASCII path
 * (for example `C:\Users\星辰\...` decoded into unmappable replacement
 * characters), and the unresolvable mojibake handed to the SDK failed with
 * "Claude Code native binary not found at <mangled path>".
 */
function findClaudeCandidates(
  configuredPath: string,
  deps: Required<ResolveClaudeCodeExecutablePathDependencies>,
): string[] {
  const pathApi = getPathApi(deps.platform);
  const extensions = readPathExtensions(deps.pathExtensions);
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const directory of readPathEntries(deps.pathEnvironment, pathApi)) {
    for (const extension of extensions) {
      const candidate = pathApi.join(directory, `${configuredPath}${extension}`);
      const key = candidate.toLowerCase();
      if (seen.has(key) || !deps.existsSync(candidate)) {
        continue;
      }

      seen.add(key);
      candidates.push(candidate);
    }
  }

  return candidates;
}

function resolveClaudeWrapperBinary(
  wrapperPath: string,
  deps: Required<ResolveClaudeCodeExecutablePathDependencies>,
): string | null {
  const pathApi = getPathApi(deps.platform);
  const directCandidate = pathApi.resolve(pathApi.dirname(wrapperPath), ...CLAUDE_WRAPPER_SEGMENTS);

  if (deps.existsSync(directCandidate)) {
    return directCandidate;
  }

  let content: string;
  try {
    content = deps.readFileSync(wrapperPath, 'utf8');
  } catch {
    return null;
  }

  const matches = content.matchAll(/["']([^"'\\\r\n]*claude\.exe)["']/gi);
  for (const match of matches) {
    const rawTarget = match[1]
      .replace(/^\$basedir[\\/]/i, '')
      .replace(/^%dp0%[\\/]/i, '')
      .replace(/^%~dp0[\\/]/i, '');
    const normalizedTarget = rawTarget.replace(/[\\/]/g, pathApi.sep);
    const candidate = pathApi.isAbsolute(normalizedTarget)
      ? normalizedTarget
      : pathApi.resolve(pathApi.dirname(wrapperPath), normalizedTarget);

    if (deps.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Windows has no PATH lookup to fall back on: the SDK spawns the path we hand
 * it with a raw `child_process.spawn`, which never consults PATH or PATHEXT.
 * A bare `claude` therefore fails with "native binary not found at claude"
 * even on a machine where the CLI is installed and on PATH, so an unresolved
 * default returns undefined and lets the SDK use its own bundled binary.
 */
function resolveWindowsClaudeExecutablePath(
  configuredPath: string,
  configuredExplicitly: boolean,
  deps: Required<ResolveClaudeCodeExecutablePathDependencies>,
): string | undefined {
  const pathApi = getPathApi(deps.platform);
  const extension = pathApi.extname(configuredPath).toLowerCase();
  const explicitPath = isPathLike(configuredPath) || pathApi.isAbsolute(configuredPath);
  // An explicit CLAUDE_CLI_PATH is the operator's call even when we cannot
  // verify it; only our own `claude` default defers to the SDK.
  const unresolved = configuredExplicitly ? configuredPath : undefined;

  if (CLAUDE_SCRIPT_EXTENSIONS.has(extension)) {
    return configuredPath;
  }

  if (explicitPath && extension === NATIVE_EXECUTABLE_EXTENSION) {
    return configuredPath;
  }

  if (explicitPath) {
    return resolveClaudeWrapperBinary(configuredPath, deps) ?? unresolved;
  }

  const candidates = findClaudeCandidates(configuredPath, deps);

  // A native binary is spawnable as-is, so it wins over the npm shims that
  // need their wrapped target resolved first.
  for (const candidate of candidates) {
    if (pathApi.extname(candidate).toLowerCase() === NATIVE_EXECUTABLE_EXTENSION) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    const resolved = resolveClaudeWrapperBinary(candidate, deps);
    if (resolved) {
      return resolved;
    }
  }

  return unresolved;
}

/**
 * Resolves the Claude Code executable to hand the SDK.
 *
 * Returns undefined when no real executable could be found and the caller did
 * not configure one, which means "let the SDK pick its own bundled binary".
 */
export function resolveClaudeCodeExecutablePath(
  configuredPath: string | undefined = process.env.CLAUDE_CLI_PATH,
  dependencies: ResolveClaudeCodeExecutablePathDependencies = {},
): string | undefined {
  const deps: Required<ResolveClaudeCodeExecutablePathDependencies> = {
    existsSync: dependencies.existsSync ?? fs.existsSync,
    pathEnvironment: dependencies.pathEnvironment ?? process.env.PATH ?? '',
    pathExtensions: dependencies.pathExtensions ?? process.env.PATHEXT ?? DEFAULT_PATH_EXTENSIONS,
    platform: dependencies.platform ?? process.platform,
    readFileSync: dependencies.readFileSync ?? fs.readFileSync,
  };

  const configuredExplicitly = Boolean(stripWrappingQuotes(configuredPath || ''));
  const normalizedPath = stripWrappingQuotes(configuredPath || DEFAULT_CLAUDE_COMMAND);
  if (deps.platform !== 'win32') {
    return normalizedPath;
  }

  return resolveWindowsClaudeExecutablePath(normalizedPath, configuredExplicitly, deps);
}
