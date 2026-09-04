/**
 * CLI Engine Path Resolver Factory
 *
 * One parameterized resolver for locating a provider's CLI engine binary:
 * environment overrides → PATH lookup (`which`/`where`) → platform install
 * locations, with module-level caching, TTL-bounded negative caching, and an
 * optional asynchronous version probe.
 *
 * @module cli-engine-path
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process';
import path from 'node:path';

import { DEFAULT_NEGATIVE_PROBE_TTL_MS } from '../installation/cli-installation-probe.js';

/**
 * One version probe attempt, built from the resolved engine path.
 *
 * Consumers: CLI engine-path modules when describing how their
 * CLI reports its version (direct `--version` vs `node engine.cjs version`).
 */
export type CliEngineVersionProbeInvocation = (enginePath: string) => {
  command: string;
  args: string[];
};

/**
 * Describes how to read a CLI engine's version.
 *
 * Invocations run in order until one exits 0 with a parseable version; the
 * parser receives combined stdout+stderr.
 */
export type CliEngineVersionProbe = {
  /** Probe attempts in order. */
  invocations: CliEngineVersionProbeInvocation[];
  /** Per-invocation timeout in milliseconds. */
  timeoutMs: number;
  /** Extracts the version string; returns null when the output is unusable. */
  parse: (output: string) => string | null;
};

/**
 * Per-provider resolution data for one CLI engine.
 *
 * Consumers: antigravity-engine-path and future CLI-type providers.
 */
export type CliEnginePathResolverConfig = {
  /** Log tag prefixing diagnostics (e.g. '[Antigravity]'). */
  logTag: string;
  /** Environment variable overrides, tried in order. */
  envVars: string[];
  /** Binary name looked up on PATH via `which` (or `where` on Windows). */
  whichBinary: string;
  /** Default install locations per platform. */
  platformCandidates: Partial<Record<NodeJS.Platform, string[]>>;
  /** Path validity rule: executable-bit check for native binaries, regular-file check for `.cjs` bundles. */
  isValidPath: (filePath: string) => boolean;
  /** Optional version probe. */
  versionProbe?: CliEngineVersionProbe;
  /**
   * Runs the probe asynchronously right after the first successful resolve so
   * request paths never block on version detection. When omitted, the probe
   * runs synchronously inside `getEngineVersion` on first demand.
   */
  eagerVersionProbe?: boolean;
  /** Diagnostic-only expected version; a mismatch logs exactly one warning. */
  expectedVersion?: string;
};

/**
 * The three functions a provider's engine-path module re-exports.
 *
 * `tryResolveEnginePath` never throws ("not installed" is a legal state) and
 * caches a resolved path for the process lifetime, while a negative result is
 * cached only until the shared negative TTL elapses (users install the CLI
 * right after seeing "not installed"; nothing clears this cache in
 * production, so a permanent negative would force a server restart).
 * `getEngineVersion` returns the cached probe result only; the probe itself
 * runs asynchronously off the request path.
 */
export type CliEnginePathResolver = {
  tryResolveEnginePath: () => string | null;
  getEngineVersion: () => string | null;
  clearEnginePathCache: () => void;
};

/**
 * Creates one provider's engine path resolver from its resolution data.
 *
 * Consumers: antigravity-engine-path and future CLI-type providers. Tests may inject
 * `spawnSync` to stub subprocesses and `now` to control the negative TTL;
 * production uses the defaults.
 */
export function createCliEnginePathResolver(
  config: CliEnginePathResolverConfig,
  dependencies: { spawnSync?: typeof nodeSpawnSync; now?: () => number } = {},
): CliEnginePathResolver {
  const spawnSync = dependencies.spawnSync ?? nodeSpawnSync;
  const now = dependencies.now ?? Date.now;

  /** Resolved engine path, cached for the process lifetime once found. */
  let cachedEnginePath: string | null = null;
  /** When the last failed resolution happened; `null` = no negative cache. */
  let negativeResolvedAt: number | null = null;
  let cachedVersion: string | null = null;
  let versionProbeScheduled = false;

  function resolveFromEnv(): string | null {
    for (const envVar of config.envVars) {
      const envPath = process.env[envVar]?.trim();
      if (envPath && config.isValidPath(envPath)) {
        return path.resolve(envPath);
      }
    }
    return null;
  }

  function resolveFromWhich(): string | null {
    const whichCommand = process.platform === 'win32' ? 'where' : 'which';
    try {
      const result = spawnSync(whichCommand, [config.whichBinary], {
        encoding: 'utf8',
        timeout: 5000,
      });
      if (result.status !== 0) {
        return null;
      }
      const firstLine = (result.stdout ?? '').split(/\r?\n/)[0]?.trim();
      if (firstLine && config.isValidPath(firstLine)) {
        return path.resolve(firstLine);
      }
    } catch {
      // PATH lookup unavailable or failed; fall through to platform paths.
    }
    return null;
  }

  function resolveFromPlatformPaths(): string | null {
    for (const candidate of config.platformCandidates[process.platform] ?? []) {
      if (config.isValidPath(candidate)) {
        return path.resolve(candidate);
      }
    }
    return null;
  }

  function runVersionProbe(enginePath: string): void {
    const probe = config.versionProbe;
    if (!probe || cachedVersion) {
      return;
    }

    for (const buildInvocation of probe.invocations) {
      try {
        const { command, args } = buildInvocation(enginePath);
        const result = spawnSync(command, args, { encoding: 'utf8', timeout: probe.timeoutMs });
        if (result.status !== 0) {
          continue;
        }
        const detected = probe.parse(`${result.stdout ?? ''}${result.stderr ?? ''}`);
        if (detected) {
          cachedVersion = detected;
          if (config.expectedVersion && detected !== config.expectedVersion) {
            console.warn(
              `${config.logTag} Version mismatch: expected ${config.expectedVersion}, detected ${detected}. `
              + 'Protocol compatibility issues may occur.',
            );
          }
          return;
        }
      } catch {
        // Probe failed - try the next invocation form.
      }
    }
  }

  /**
   * Warms the version cache off the request path (eager mode only): the first
   * successful resolve schedules the probe for the next tick instead of
   * blocking the caller for up to one probe timeout per invocation.
   */
  function scheduleVersionProbe(enginePath: string): void {
    if (!config.versionProbe || !config.eagerVersionProbe || versionProbeScheduled || cachedVersion) {
      return;
    }
    versionProbeScheduled = true;
    setImmediate(() => runVersionProbe(enginePath));
  }

  function tryResolveEnginePath(): string | null {
    if (cachedEnginePath !== null) {
      return cachedEnginePath;
    }
    if (negativeResolvedAt !== null && now() - negativeResolvedAt < DEFAULT_NEGATIVE_PROBE_TTL_MS) {
      return null;
    }

    const resolved = resolveFromEnv() ?? resolveFromWhich() ?? resolveFromPlatformPaths();
    if (resolved) {
      cachedEnginePath = resolved;
      scheduleVersionProbe(resolved);
      return resolved;
    }

    negativeResolvedAt = now();
    return null;
  }

  function getEngineVersion(): string | null {
    const enginePath = tryResolveEnginePath();
    if (!enginePath) {
      return null;
    }
    // On-demand mode: probe synchronously once, exactly like the original
    // per-provider implementations did. Eager mode returns the warmed cache.
    if (!cachedVersion && config.versionProbe && !config.eagerVersionProbe) {
      runVersionProbe(enginePath);
    }
    return cachedVersion;
  }

  function clearEnginePathCache(): void {
    cachedEnginePath = null;
    negativeResolvedAt = null;
    cachedVersion = null;
    versionProbeScheduled = false;
  }

  return {
    tryResolveEnginePath,
    getEngineVersion,
    clearEnginePathCache,
  };
}
