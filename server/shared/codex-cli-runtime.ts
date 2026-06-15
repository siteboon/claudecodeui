import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_CODEX_COMMAND = 'codex';
const CODEX_CLI_PATH_ENV_KEYS = ['CODEX_CLI_PATH', 'CLOUDCLI_CODEX_CLI_PATH'] as const;

/**
 * Codex runtime precedence:
 * 1. Explicit CODEX_CLI_PATH or CLOUDCLI_CODEX_CLI_PATH.
 * 2. User/global installs such as NPM_CONFIG_PREFIX/bin, ~/.npm-global/bin, or ~/.local/bin.
 * 3. Non-local PATH entries.
 * 4. App-local node_modules/.bin as the final fallback.
 */
type EnvRecord = Record<string, string | undefined>;

export type ResolveCodexExecutablePathDependencies = {
  env?: EnvRecord;
  existsSync?: typeof fs.existsSync;
  homedir?: typeof os.homedir;
  platform?: NodeJS.Platform;
};

/**
 * Returns the path implementation that matches the target runtime platform.
 */
function getPathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

/**
 * Returns the PATH delimiter used by the target runtime platform.
 */
function getPathDelimiter(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : ':';
}

/**
 * Removes one matching pair of surrounding quotes from a configured path value.
 */
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

/**
 * Checks whether a command value looks like a filesystem path instead of a bare command name.
 */
function isPathLike(value: string, platform: NodeJS.Platform): boolean {
  return value.includes('/') || value.includes('\\') || getPathApi(platform).isAbsolute(value);
}

/**
 * Finds the environment key that represents PATH, preserving Windows case variants.
 */
function getPathEnvKey(env: EnvRecord, platform: NodeJS.Platform): string {
  if (platform !== 'win32') {
    return 'PATH';
  }

  return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
}

/**
 * Returns the Codex executable filenames to probe for the target platform.
 */
function getExecutableNames(platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') {
    return [DEFAULT_CODEX_COMMAND];
  }

  return ['codex.exe', 'codex.cmd', 'codex.bat', 'codex.ps1', DEFAULT_CODEX_COMMAND];
}

/**
 * Deduplicates non-empty string values while preserving their original order.
 */
function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

/**
 * Detects app-local npm bin directories so they can be treated as a fallback.
 */
function isNodeModulesBinPath(directoryPath: string, platform: NodeJS.Platform): boolean {
  const pathApi = getPathApi(platform);
  const normalized = directoryPath.replace(/[\\/]+$/, '');
  return (
    pathApi.basename(normalized).toLowerCase() === '.bin' &&
    pathApi.basename(pathApi.dirname(normalized)).toLowerCase() === 'node_modules'
  );
}

/**
 * Resolves the first Codex executable that exists inside one directory.
 */
function resolveExecutableInDirectory(
  directoryPath: string,
  deps: Required<ResolveCodexExecutablePathDependencies>
): string | null {
  const pathApi = getPathApi(deps.platform);
  for (const executableName of getExecutableNames(deps.platform)) {
    const candidate = pathApi.join(directoryPath, executableName);
    if (deps.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Reads an explicit Codex executable override from supported environment variables.
 */
function getConfiguredCodexPath(env: EnvRecord): string | null {
  for (const key of CODEX_CLI_PATH_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) {
      return stripWrappingQuotes(value);
    }
  }

  return null;
}

/**
 * Builds user/global Codex install candidates that rank ahead of PATH and app-local installs:
 * NPM_CONFIG_PREFIX/bin, ~/.npm-global/bin, ~/.local/bin, or the Windows npm user folders.
 */
function getPreferredUserInstallCandidates(
  deps: Required<ResolveCodexExecutablePathDependencies>
): string[] {
  const pathApi = getPathApi(deps.platform);
  const homeDir = deps.homedir();
  const candidates: string[] = [];
  const npmPrefix = deps.env.NPM_CONFIG_PREFIX?.trim();

  if (npmPrefix) {
    candidates.push(pathApi.join(npmPrefix, deps.platform === 'win32' ? '' : 'bin'));
  }

  if (deps.platform === 'win32') {
    const appData = deps.env.APPDATA?.trim();
    if (appData) {
      candidates.push(appData, pathApi.join(appData, 'npm'));
    }
    candidates.push(pathApi.join(homeDir, 'AppData', 'Roaming', 'npm'));
  } else {
    candidates.push(
      pathApi.join(homeDir, '.npm-global', 'bin'),
      pathApi.join(homeDir, '.local', 'bin'),
    );
  }

  return unique(candidates);
}

/**
 * Searches PATH for Codex after user/global candidates, keeping node_modules/.bin as the last fallback.
 */
function resolveFromPath(
  deps: Required<ResolveCodexExecutablePathDependencies>
): string | null {
  const pathKey = getPathEnvKey(deps.env, deps.platform);
  const pathValue = deps.env[pathKey] ?? '';
  const directories = unique(pathValue.split(getPathDelimiter(deps.platform)).filter(Boolean));
  let nodeModulesFallback: string | null = null;

  for (const directory of directories) {
    const candidate = resolveExecutableInDirectory(directory, deps);
    if (!candidate) {
      continue;
    }

    if (isNodeModulesBinPath(directory, deps.platform)) {
      nodeModulesFallback ??= candidate;
      continue;
    }

    return candidate;
  }

  return nodeModulesFallback;
}

/**
 * Converts a process-style environment object into a string-only environment for child processes.
 */
function toStringEnv(env: EnvRecord): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

/**
 * Resolves the Codex executable path for all backend entry points in this order:
 * explicit CODEX_CLI_PATH/CLOUDCLI_CODEX_CLI_PATH, user/global installs, non-local PATH, app-local PATH.
 */
export function resolveCodexExecutablePath(
  configuredPath: string | undefined = undefined,
  dependencies: ResolveCodexExecutablePathDependencies = {}
): string {
  const deps: Required<ResolveCodexExecutablePathDependencies> = {
    env: dependencies.env ?? process.env,
    existsSync: dependencies.existsSync ?? fs.existsSync,
    homedir: dependencies.homedir ?? os.homedir,
    platform: dependencies.platform ?? process.platform,
  };

  const normalizedConfiguredPath = stripWrappingQuotes(
    configuredPath?.trim() || getConfiguredCodexPath(deps.env) || ''
  );
  if (normalizedConfiguredPath) {
    if (!isPathLike(normalizedConfiguredPath, deps.platform)) {
      return resolveFromPath(deps) ?? normalizedConfiguredPath;
    }
    return normalizedConfiguredPath;
  }

  for (const candidateDirectory of getPreferredUserInstallCandidates(deps)) {
    const candidate = resolveExecutableInDirectory(candidateDirectory, deps);
    if (candidate) {
      return candidate;
    }
  }

  return resolveFromPath(deps) ?? DEFAULT_CODEX_COMMAND;
}

/**
 * Creates a Codex child-process environment with the selected runtime directory first on PATH,
 * preserving the same source precedence as resolveCodexExecutablePath.
 */
export function createCodexRuntimeEnv(
  env: EnvRecord = process.env,
  dependencies: ResolveCodexExecutablePathDependencies = {}
): Record<string, string> {
  const platform = dependencies.platform ?? process.platform;
  const pathApi = getPathApi(platform);
  const resolvedCodexPath = resolveCodexExecutablePath(undefined, {
    ...dependencies,
    env,
    platform,
  });
  const pathKey = getPathEnvKey(env, platform);
  const currentPath = env[pathKey] ?? '';
  const resolvedDirectory = isPathLike(resolvedCodexPath, platform)
    ? pathApi.dirname(resolvedCodexPath)
    : '';
  const nextEnv: EnvRecord = { ...env };

  if (resolvedDirectory) {
    const delimiter = getPathDelimiter(platform);
    const pathEntries = currentPath.split(delimiter).filter(Boolean);
    if (!pathEntries.includes(resolvedDirectory)) {
      nextEnv[pathKey] = currentPath
        ? `${resolvedDirectory}${delimiter}${currentPath}`
        : resolvedDirectory;
    }
  }

  return toStringEnv(nextEnv);
}

/**
 * Returns the shell-safe Codex command used by interactive PTY launches.
 */
export function getCodexShellCommand(
  dependencies: ResolveCodexExecutablePathDependencies = {}
): string {
  const platform = dependencies.platform ?? process.platform;
  const resolvedCodexPath = resolveCodexExecutablePath(undefined, dependencies);
  if (!isPathLike(resolvedCodexPath, platform)) {
    return resolvedCodexPath;
  }

  if (platform === 'win32') {
    return `& '${resolvedCodexPath.replace(/'/g, "''")}'`;
  }

  return `'${resolvedCodexPath.replace(/'/g, "'\\''")}'`;
}
