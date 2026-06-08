import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_CLAUDE_COMMAND = 'claude';
const CLAUDE_SCRIPT_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const CLAUDE_WRAPPER_SEGMENTS = ['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'] as const;

export type ResolveClaudeCodeExecutablePathDependencies = {
  execFileSync?: typeof execFileSync;
  existsSync?: typeof fs.existsSync;
  platform?: NodeJS.Platform;
  readFileSync?: typeof fs.readFileSync;
};

function getPathApi(platform: NodeJS.Platform) {
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
      .replace(/^\$basedir[\\\/]/i, '')
      .replace(/^%dp0%[\\\/]/i, '')
      .replace(/^%~dp0[\\\/]/i, '');
    const normalizedTarget = rawTarget.replace(/[\\\/]/g, pathApi.sep);
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
 * Returns candidate paths to check for the claude binary on Linux/macOS,
 * in priority order. These cover the native installer, nvm, and common npm
 * global prefix locations so users don't need to set CLAUDE_CLI_PATH manually.
 */
function getUnixCandidatePaths(): string[] {
  const home = os.homedir();
  const candidates: string[] = [
    // Native Anthropic installer (Linux/macOS)
    path.join(home, '.local', 'bin', 'claude'),
    // macOS native installer
    path.join(home, 'Library', 'Application Support', 'Claude', 'claude'),
    // Common npm global prefixes
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    // npm global on common Linux distros
    '/usr/local/share/npm-global/bin/claude',
    // nvm active version
    path.join(home, '.nvm', 'current', 'bin', 'claude'),
    // Homebrew (macOS/Linux)
    '/opt/homebrew/bin/claude',
    '/home/linuxbrew/.linuxbrew/bin/claude',
  ];

  // Also probe nvm versioned installs (picks whatever exists)
  try {
    const nvmDir = path.join(home, '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmDir)) {
      const versions = fs.readdirSync(nvmDir);
      for (const v of versions.sort().reverse()) {
        candidates.push(path.join(nvmDir, v, 'bin', 'claude'));
      }
    }
  } catch {
    // ignore
  }

  return candidates;
}

/**
 * Tries to resolve the claude binary on Unix-like systems.
 * Resolution order:
 *  1. Explicit CLAUDE_CLI_PATH / configuredPath (if it looks like an absolute path)
 *  2. Well-known install locations (native installer, nvm, npm global…)
 *  3. PATH lookup via `which` / `command -v`
 *  4. Fall back to bare 'claude' (lets the OS PATH decide at spawn time)
 */
function resolveUnixClaudeExecutablePath(
  configuredPath: string,
  deps: Required<ResolveClaudeCodeExecutablePathDependencies>,
): string {
  // If the caller supplied an explicit absolute/relative path, honour it directly.
  if (isPathLike(configuredPath) || path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  // configuredPath is 'claude' (the default) – try well-known locations first.
  for (const candidate of getUnixCandidatePaths()) {
    if (deps.existsSync(candidate)) {
      return candidate;
    }
  }

  // Try resolving via the shell (which / command -v)
  for (const whichCmd of ['which', 'command']) {
    try {
      const args = whichCmd === 'command' ? ['-v', configuredPath] : [configuredPath];
      const stdout = deps.execFileSync(whichCmd === 'command' ? '/bin/sh' : whichCmd,
        whichCmd === 'command' ? ['-c', `command -v ${configuredPath}`] : args,
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 3000,
        },
      );
      const resolved = stdout.trim().split('\n')[0]?.trim();
      if (resolved && deps.existsSync(resolved)) {
        return resolved;
      }
    } catch {
      // not available
    }
  }

  // Last resort: return the bare command and let the OS resolve it at spawn time.
  return configuredPath;
}

function resolveWindowsClaudeExecutablePath(
  configuredPath: string,
  deps: Required<ResolveClaudeCodeExecutablePathDependencies>,
): string {
  const pathApi = getPathApi(deps.platform);
  const extension = pathApi.extname(configuredPath).toLowerCase();
  const explicitPath = isPathLike(configuredPath) || pathApi.isAbsolute(configuredPath);

  if (CLAUDE_SCRIPT_EXTENSIONS.has(extension)) {
    return configuredPath;
  }

  if (explicitPath && extension === '.exe') {
    return configuredPath;
  }

  if (explicitPath) {
    return resolveClaudeWrapperBinary(configuredPath, deps) ?? configuredPath;
  }

  try {
    const stdout = deps.execFileSync('where.exe', [configuredPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const candidates = stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    for (const candidate of candidates) {
      if (pathApi.extname(candidate).toLowerCase() === '.exe') {
        return candidate;
      }
    }

    for (const candidate of candidates) {
      const resolved = resolveClaudeWrapperBinary(candidate, deps);
      if (resolved) {
        return resolved;
      }
    }
  } catch {
    return configuredPath;
  }

  return configuredPath;
}

export function resolveClaudeCodeExecutablePath(
  configuredPath: string | undefined = process.env.CLAUDE_CLI_PATH,
  dependencies: ResolveClaudeCodeExecutablePathDependencies = {},
): string {
  const deps: Required<ResolveClaudeCodeExecutablePathDependencies> = {
    execFileSync: dependencies.execFileSync ?? execFileSync,
    existsSync: dependencies.existsSync ?? fs.existsSync,
    platform: dependencies.platform ?? process.platform,
    readFileSync: dependencies.readFileSync ?? fs.readFileSync,
  };

  const normalizedPath = stripWrappingQuotes(configuredPath || DEFAULT_CLAUDE_COMMAND);

  if (deps.platform === 'win32') {
    return resolveWindowsClaudeExecutablePath(normalizedPath, deps);
  }

  return resolveUnixClaudeExecutablePath(normalizedPath, deps);
}
