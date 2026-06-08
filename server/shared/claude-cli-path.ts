import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_CLAUDE_COMMAND = 'claude';
const CLAUDE_SCRIPT_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const CLAUDE_WRAPPER_SEGMENTS = ['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'] as const;

/**
 * Package name prefix used by claude-agent-sdk optional platform packages.
 * The SDK ships a bundled, version-matched claude binary inside these packages.
 * Using this binary is the most reliable choice because it is guaranteed to be
 * protocol-compatible with the installed SDK version — no CLAUDE_CLI_PATH
 * configuration is needed.
 */
const SDK_PKG_PREFIX = '@anthropic-ai/claude-agent-sdk';

export type ResolveClaudeCodeExecutablePathDependencies = {
  execFileSync?: typeof execFileSync;
  existsSync?: typeof fs.existsSync;
  platform?: NodeJS.Platform;
  arch?: string;
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

/**
 * Attempts to find the claude binary that is bundled inside the installed
 * @anthropic-ai/claude-agent-sdk platform packages.
 *
 * The SDK distributes a claude binary alongside itself in optional packages
 * named `@anthropic-ai/claude-agent-sdk-<platform>-<arch>` (e.g.
 * `@anthropic-ai/claude-agent-sdk-linux-x64`). Using this binary instead of
 * a system-installed one guarantees protocol compatibility with the SDK
 * version that is actually installed.
 *
 * This removes the need to set `CLAUDE_CLI_PATH` in the vast majority of
 * deployments, including Docker containers that use a base image with a
 * different (possibly incompatible) claude version pre-installed.
 */
function resolveSDKBundledBinary(
  existsSync: typeof fs.existsSync,
  platform: NodeJS.Platform,
  arch: string,
): string | null {
  const suffix = platform === 'win32' ? '.exe' : '';

  // Ordered list of platform package names to try
  let pkgNames: string[];
  if (platform === 'linux') {
    pkgNames = [
      `${SDK_PKG_PREFIX}-linux-${arch}`,
      `${SDK_PKG_PREFIX}-linux-${arch}-musl`,
    ];
  } else if (platform === 'darwin') {
    pkgNames = [`${SDK_PKG_PREFIX}-darwin-${arch}`];
  } else if (platform === 'win32') {
    pkgNames = [`${SDK_PKG_PREFIX}-win32-${arch}`];
  } else {
    return null;
  }

  // Use createRequire so that resolution starts from *this* file's location,
  // which ensures we find the SDK packages bundled alongside claudecodeui.
  const requireFromHere = createRequire(import.meta.url);

  for (const pkg of pkgNames) {
    try {
      // Resolve the package root via its package.json, then append binary name
      const pkgJsonPath = requireFromHere.resolve(`${pkg}/package.json`);
      const candidate = path.join(path.dirname(pkgJsonPath), `claude${suffix}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // package not installed or not resolvable — try next
    }

    try {
      // Some packages expose the binary via an exports map or main field
      const candidate = requireFromHere.resolve(`${pkg}/claude${suffix}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }

  return null;
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
 *
 * Note: the SDK-bundled binary is tried BEFORE these paths in
 * resolveUnixClaudeExecutablePath() because it is guaranteed to be
 * version-compatible with the installed SDK.
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
 *
 * Resolution order (highest to lowest priority):
 *  0. SDK-bundled binary  — found inside `@anthropic-ai/claude-agent-sdk-<platform>`
 *                           node_modules. This is tried FIRST because it is
 *                           guaranteed to be protocol-compatible with the
 *                           installed SDK, regardless of what is on PATH.
 *                           Eliminates the need for CLAUDE_CLI_PATH in Docker
 *                           containers and CI environments.
 *  1. Explicit CLAUDE_CLI_PATH / configuredPath (if it looks like an absolute path)
 *  2. Well-known install locations (native installer, nvm, npm global…)
 *  3. PATH lookup via `which` / `command -v`
 *  4. Bare 'claude' — last resort, lets the OS PATH decide at spawn time
 *
 * For users who swap the Claude Code harness to use a third-party AI backend
 * (e.g. MiniMax, Together, OpenRouter) via ANTHROPIC_BASE_URL +
 * ANTHROPIC_AUTH_TOKEN, the binary itself is still the official claude binary;
 * only the API endpoint and credentials change. Automatic detection means
 * these users need no extra configuration beyond their provider env vars.
 */
function resolveUnixClaudeExecutablePath(
  configuredPath: string,
  deps: Required<ResolveClaudeCodeExecutablePathDependencies>,
): string {
  // Priority 0: SDK-bundled binary (version-matched, no config required).
  // Only auto-use when no explicit path is configured.
  if (!isPathLike(configuredPath) && !path.isAbsolute(configuredPath)) {
    const sdkBundled = resolveSDKBundledBinary(deps.existsSync, deps.platform, deps.arch);
    if (sdkBundled) {
      return sdkBundled;
    }
  }

  // Priority 1: Explicit absolute/relative path → honour it directly.
  if (isPathLike(configuredPath) || path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  // Priority 2: Well-known install locations.
  for (const candidate of getUnixCandidatePaths()) {
    if (deps.existsSync(candidate)) {
      return candidate;
    }
  }

  // Priority 3: Shell PATH lookup (which / command -v).
  for (const whichCmd of ['which', 'command']) {
    try {
      const stdout = deps.execFileSync(
        whichCmd === 'command' ? '/bin/sh' : whichCmd,
        whichCmd === 'command' ? ['-c', `command -v ${configuredPath}`] : [configuredPath],
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

  // Priority 4: Last resort — return the bare command and let the OS decide.
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

  // Auto-detect SDK-bundled binary on Windows too
  const sdkBundled = resolveSDKBundledBinary(deps.existsSync, deps.platform, deps.arch);
  if (sdkBundled) {
    return sdkBundled;
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
    arch: dependencies.arch ?? process.arch,
    readFileSync: dependencies.readFileSync ?? fs.readFileSync,
  };

  const normalizedPath = stripWrappingQuotes(configuredPath || DEFAULT_CLAUDE_COMMAND);

  if (deps.platform === 'win32') {
    return resolveWindowsClaudeExecutablePath(normalizedPath, deps);
  }

  return resolveUnixClaudeExecutablePath(normalizedPath, deps);
}
