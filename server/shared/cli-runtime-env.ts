import os from 'node:os';
import path from 'node:path';

export type EnvRecord = Record<string, string | undefined>;

export type CliRuntimeEnvDependencies = {
  env?: EnvRecord;
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
 * Finds the environment key that represents PATH, preserving Windows case variants.
 */
function getPathEnvKey(env: EnvRecord, platform: NodeJS.Platform): string {
  if (platform !== 'win32') {
    return 'PATH';
  }

  return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
}

/**
 * Deduplicates non-empty string values while preserving their original order.
 */
function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

/**
 * Converts a process-style environment object into a string-only environment for child processes.
 */
export function toStringEnv(env: EnvRecord): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

/**
 * Builds user/global CLI bin directories that should rank ahead of app-local npm bins.
 */
export function getPreferredUserCliBinDirectories(
  dependencies: Required<CliRuntimeEnvDependencies>
): string[] {
  const pathApi = getPathApi(dependencies.platform);
  const homeDir = dependencies.homedir();
  const candidates: string[] = [];
  const npmPrefix = dependencies.env.NPM_CONFIG_PREFIX?.trim();

  if (npmPrefix) {
    candidates.push(pathApi.join(npmPrefix, dependencies.platform === 'win32' ? '' : 'bin'));
  }

  if (dependencies.platform === 'win32') {
    const appData = dependencies.env.APPDATA?.trim();
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
 * Creates a provider-neutral shell environment that prefers user/global CLI bins over app-local bins.
 */
export function createUserShellRuntimeEnv(
  env: EnvRecord = process.env,
  dependencies: CliRuntimeEnvDependencies = {}
): Record<string, string> {
  const deps: Required<CliRuntimeEnvDependencies> = {
    env,
    homedir: dependencies.homedir ?? os.homedir,
    platform: dependencies.platform ?? process.platform,
  };
  const pathKey = getPathEnvKey(env, deps.platform);
  const delimiter = getPathDelimiter(deps.platform);
  const currentPathEntries = (env[pathKey] ?? '').split(delimiter).filter(Boolean);
  const preferredEntries = getPreferredUserCliBinDirectories(deps).filter(
    (entry) => !currentPathEntries.includes(entry)
  );
  const nextEnv: EnvRecord = { ...env };

  if (preferredEntries.length > 0) {
    nextEnv[pathKey] = [...preferredEntries, ...currentPathEntries].join(delimiter);
  }

  return toStringEnv(nextEnv);
}
