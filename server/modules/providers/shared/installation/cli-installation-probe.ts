/**
 * Cached CLI installation probe.
 *
 * @module cli-installation-probe
 */

import spawn from 'cross-spawn';

/**
 * How long an "uninstalled" result stays cached before the next query probes
 * again. A short TTL matters because users legitimately install a CLI right
 * after seeing "not installed" (the onboarding flow walks them through it).
 *
 * Consumers: the CLI auth providers via `createCliInstallationProbe`, and
 * `cli-engine-path` for its negative-cache expiry so both caches share the
 * product-agreed window.
 */
export const DEFAULT_NEGATIVE_PROBE_TTL_MS = 120_000;

/**
 * Configuration for one provider's installation probe.
 *
 * Consumers: cursor/claude/codex/opencode auth providers (one module-level
 * probe instance each).
 */
export type CliInstallationProbeConfig = {
  /**
   * Resolves the command to probe on each attempt (not cached): claude needs
   * `resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH)` so env
   * overrides take effect without a server restart.
   */
  command: () => string;
  /** Probe arguments; defaults to a `--version` run, matching the historical
   * check that only counts a CLI as installed when it actually executes. */
  args?: string[];
  /** Probe timeout in milliseconds; defaults to 5000 like the previous
   * synchronous checks. */
  timeoutMs?: number;
  /** How long an "uninstalled" result is cached; defaults to
   * `DEFAULT_NEGATIVE_PROBE_TTL_MS`. */
  negativeTtlMs?: number;
};

/**
 * The probe surface consumed by auth providers' `getStatus()`.
 *
 * Consumers: cursor/claude/codex/opencode auth providers.
 */
export type CliInstallationProbe = {
  isInstalled(): Promise<boolean>;
};

/**
 * One subprocess probe outcome, shaped so the installed check mirrors the
 * fixed `spawnSync` semantics: exit 0 without an error means installed;
 * ENOENT, non-zero exit, timeout, and thrown errors all mean not installed.
 */
type ProbeOutcome = {
  error?: Error;
  status: number | null;
};

/**
 * Test seam for `createCliInstallationProbe`: production uses the default
 * asynchronous cross-spawn wrapper, tests stub it to avoid real subprocesses.
 */
export type ProbeSpawn = (
  command: string,
  args: string[],
  options: { timeoutMs: number },
) => Promise<ProbeOutcome>;

const probeSpawnAsync: ProbeSpawn = (command, args, { timeoutMs }) =>
  new Promise((resolve) => {
    let settled = false;
    let childProcess: ReturnType<typeof spawn> | undefined;

    // A hung CLI must not pin the status endpoint; treat it as not installed.
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      childProcess?.kill();
      resolve({ error: new Error('installation probe timed out'), status: null });
    }, timeoutMs);

    try {
      childProcess = spawn(command, args, { stdio: 'ignore' });
    } catch (error) {
      clearTimeout(timeout);
      settled = true;
      resolve({ error: error as Error, status: null });
      return;
    }

    childProcess.on('error', (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ error, status: null });
    });

    childProcess.on('close', (status: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ status });
    });
  });

/**
 * Creates a cached, asynchronous installation probe for one CLI.
 *
 * Consumers: cursor/claude/codex/opencode auth providers. Caching rules:
 * "installed" is cached for the process lifetime (CLIs are not uninstalled
 * mid-use); "not installed" is cached for `negativeTtlMs` so the status
 * endpoint stops spawning a subprocess per request while still self-healing
 * shortly after the user installs the CLI. Concurrent queries during a probe
 * share the in-flight attempt.
 */
export function createCliInstallationProbe(
  config: CliInstallationProbeConfig,
  dependencies: { spawnAsync?: ProbeSpawn; now?: () => number } = {},
): CliInstallationProbe {
  const spawnAsync = dependencies.spawnAsync ?? probeSpawnAsync;
  const now = dependencies.now ?? Date.now;
  const negativeTtlMs = config.negativeTtlMs ?? DEFAULT_NEGATIVE_PROBE_TTL_MS;

  /** `true` = installed (cached forever); `false` = not installed (cached until `negativeUntil`). */
  let cachedInstalled: boolean | null = null;
  let negativeUntil = 0;
  let inFlight: Promise<boolean> | null = null;

  const isInstalled = (): Promise<boolean> => {
    if (cachedInstalled === true) {
      return Promise.resolve(true);
    }
    if (cachedInstalled === false && now() < negativeUntil) {
      return Promise.resolve(false);
    }
    if (inFlight) {
      return inFlight;
    }

    inFlight = (async () => {
      try {
        const outcome = await spawnAsync(
          config.command(),
          config.args ?? ['--version'],
          { timeoutMs: config.timeoutMs ?? 5000 },
        );
        cachedInstalled = !outcome.error && outcome.status === 0;
        return cachedInstalled;
      } catch {
        // A crashed probe is indistinguishable from a broken install; report
        // not installed and let the negative TTL schedule a retry.
        cachedInstalled = false;
        return false;
      } finally {
        if (cachedInstalled === false) {
          negativeUntil = now() + negativeTtlMs;
        }
        inFlight = null;
      }
    })();

    return inFlight;
  };

  return { isInstalled };
}
