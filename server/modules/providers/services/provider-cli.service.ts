import spawn from 'cross-spawn';

import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { IProvider } from '@/shared/interfaces.js';
import type { CliVersionProbe, LLMProvider } from '@/shared/types.js';
import { AppError, IS_PLATFORM, stripAnsiSequences } from '@/shared/utils.js';

/** How long the registry's answer is reused before it is asked again. */
const LATEST_VERSION_TTL_MS = 60 * 60 * 1000;
/** A failed lookup is retried sooner, but not on every settings page view of an offline server. */
const LATEST_VERSION_FAILURE_TTL_MS = 5 * 60 * 1000;
/** The registry gets this long; past it the settings page shows the installed version alone. */
const LATEST_VERSION_TIMEOUT_MS = 4000;
const NPM_REGISTRY_URL = 'https://registry.npmjs.org';

/** One update run may take this long: `claude update` downloads a ~250 MB binary. */
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
/** After SIGTERM on timeout, the updater gets this long to exit before SIGKILL. */
const UPDATE_KILL_GRACE_MS = 10_000;
/** Only the tail of the updater's output is returned; that is where its result and errors are. */
const UPDATE_OUTPUT_LIMIT = 20_000;
/** Raw output kept while the updater runs; spinner and progress-bar redraws shrink a lot once collapsed. */
const UPDATE_RAW_OUTPUT_LIMIT = 256_000;

// How the updaters word a write they were refused: npm and Node print EACCES or
// EPERM, `claude update` says "Insufficient permissions", and `opencode upgrade`
// only passes on npm's exit code, which is 243 (errno -13, EACCES).
const PERMISSION_DENIED_PATTERN = /\bEACCES\b|\bEPERM\b|permission denied|insufficient permissions|exit code 243\b/i;
const FAILURE_PATTERN = /\bfailed\b/i;
const RELEASE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

type CliUpdater = {
  /** The CLI chats run, or undefined when they run a binary that ships inside CloudCLI's dependencies. */
  resolveCommand: () => string | undefined;
  /** Arguments that make the CLI update itself. */
  args: string[];
  /** The npm package whose `latest` dist-tag is the newest release, or null when the CLI is not on npm. */
  npmPackage: string | null;
};

// Each CLI updates itself with its own updater. That updater knows how it was
// installed (npm, a native installer, Homebrew, ...), which a blanket
// `npm install -g` does not: on a native or Homebrew install it would add a
// second copy that PATH may not even pick. Codex is absent on purpose: chats
// run the @openai/codex build CloudCLI depends on, so it changes with CloudCLI.
const CLI_UPDATERS: Partial<Record<LLMProvider, CliUpdater>> = {
  claude: {
    // undefined only on Windows when no CLI resolves: the SDK then runs its bundled binary.
    resolveCommand: () => resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH),
    args: ['update'],
    npmPackage: '@anthropic-ai/claude-code',
  },
  cursor: {
    // cursor-agent is distributed by Cursor's installer only, so there is no registry to compare with.
    resolveCommand: () => 'cursor-agent',
    args: ['update'],
    npmPackage: null,
  },
  opencode: {
    resolveCommand: () => 'opencode',
    args: ['upgrade'],
    npmPackage: 'opencode-ai',
  },
};

/** Why the settings page offers no update: the CLI ships with CloudCLI, or the hosting platform manages the CLIs. */
type CliUpdateUnavailableReason = 'bundled' | 'platform';

/** Why an update run went wrong, as read from its exit code and output. */
type CliUpdateFailure = 'permission_denied' | 'timed_out' | 'failed';

type ProviderCliUpdateResult = {
  provider: LLMProvider;
  command: string;
  /** null when the updater could not be started or was stopped by the timeout. */
  exitCode: number | null;
  output: string;
  previousVersion: string | null;
  installedVersion: string | null;
  /** null when neither the exit code nor the output reports a failure. */
  failure: CliUpdateFailure | null;
};

type ProviderCliStatus = {
  provider: LLMProvider;
  installed: boolean;
  installedVersion: string | null;
  /** The registry's `latest` release, or null when the CLI is not on npm or the lookup failed. */
  latestVersion: string | null;
  updateAvailable: boolean;
  /** What the update action runs, e.g. `claude update`; null when it is unavailable. */
  updateCommand: string | null;
  updateUnavailableReason: CliUpdateUnavailableReason | null;
  /**
   * Whether an update run is going on right now. An update outlives the page
   * that started it (another agent tab, a closed Settings dialog, a proxy that
   * gave up on the long request), so a page that sees this polls until it
   * turns false and then shows `lastUpdate`.
   */
  updateInProgress: boolean;
  /** The most recent finished update run since the server started, or null. */
  lastUpdate: ProviderCliUpdateResult | null;
};

/** An update run that has passed its checks and started the updater. */
type UpdateInProgress = {
  /** What `--version` reported just before the updater started; the status reports it while the run lasts. */
  before: CliVersionProbe;
  result: Promise<ProviderCliUpdateResult>;
};

type UpdaterRun = {
  exitCode: number | null;
  output: string;
  spawnErrorCode: string | null;
  timedOut: boolean;
};

type RunUpdaterOptions = {
  timeoutMs: number;
  killGraceMs: number;
};

type ProviderCliServiceDependencies = {
  resolveProvider(provider: string): IProvider;
  /** Providers with a chat run, background work or a busy Claude CLI session right now. */
  listBusyProviders(): Promise<LLMProvider[]>;
  fetch: typeof fetch;
  platformMode: boolean;
  now(): number;
  latestVersionTimeoutMs: number;
  updateTimeoutMs: number;
  updateKillGraceMs: number;
};

const defaultDependencies: ProviderCliServiceDependencies = {
  resolveProvider: (provider) => providerRegistry.resolveProvider(provider),
  listBusyProviders: async () => (await sessionsService.listRunningSessions()).map((session) => session.provider),
  fetch: (input, init) => fetch(input, init),
  platformMode: IS_PLATFORM,
  now: () => Date.now(),
  latestVersionTimeoutMs: LATEST_VERSION_TIMEOUT_MS,
  updateTimeoutMs: UPDATE_TIMEOUT_MS,
  updateKillGraceMs: UPDATE_KILL_GRACE_MS,
};

/**
 * Whether `candidate` is a later release than `current`. Both are
 * `major.minor.patch` with an optional prerelease; a release outranks its own
 * prereleases. Anything else (a date-based or unparsable version) compares as
 * not newer, so no update is ever advertised on a guess.
 */
function isNewerVersion(candidate: string, current: string): boolean {
  const next = RELEASE_VERSION_PATTERN.exec(candidate);
  const installed = RELEASE_VERSION_PATTERN.exec(current);
  if (!next || !installed) {
    return false;
  }

  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(next[index]) - Number(installed[index]);
    if (difference !== 0) {
      return difference > 0;
    }
  }

  return !next[4] && Boolean(installed[4]);
}

/** Renders the updater as a user would type it, for display only; it is spawned without a shell. */
function formatCommand(command: string, args: string[]): string {
  const quote = (part: string) => (/[\s"']/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part);
  return [command, ...args].map(quote).join(' ');
}

function getProviderLabel(provider: LLMProvider): string {
  const labels: Record<LLMProvider, string> = {
    claude: 'Claude Code',
    codex: 'Codex',
    cursor: 'Cursor CLI',
    opencode: 'OpenCode',
  };
  return labels[provider];
}

/**
 * Turns what an updater drew for a terminal into plain lines. Spinners and
 * progress bars redraw one line with `\r` or a cursor-to-column sequence
 * (`opencode upgrade` sends `ESC[999D` for every frame), so only the last
 * non-empty state of each line is kept before the escapes are stripped.
 */
function toPlainOutput(raw: string): string {
  const lines = stripAnsiSequences(raw.replace(/\u001B\[\d*[DG]/g, '\r'))
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.split('\r').filter((state) => state.trim()).pop() ?? '');
  return lines.join('\n').trim().slice(-UPDATE_OUTPUT_LIMIT);
}

/**
 * Runs one updater to completion and keeps the tail of its combined output.
 * No shell is involved: the command is the configured CLI and the arguments
 * are fixed per provider. On POSIX the updater gets its own process group so
 * a timeout also stops the npm or download child it started.
 */
function runUpdater(command: string, args: string[], options: RunUpdaterOptions): Promise<UpdaterRun> {
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let settled = false;
    const timers: NodeJS.Timeout[] = [];

    const later = (delayMs: number, callback: () => void) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref?.();
      timers.push(timer);
    };

    const finish = (result: Omit<UpdaterRun, 'output' | 'timedOut'>) => {
      if (settled) {
        return;
      }
      settled = true;
      timers.forEach((timer) => clearTimeout(timer));
      resolve({ ...result, output: toPlainOutput(output), timedOut });
    };

    const child = spawn(command, args, {
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });

    const signalUpdater = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch {
        // Already gone.
      }
    };

    later(options.timeoutMs, () => {
      timedOut = true;
      signalUpdater('SIGTERM');
      later(options.killGraceMs, () => {
        signalUpdater('SIGKILL');
        // A process that left the group can keep the pipes open; stop waiting for it.
        later(2000, () => finish({ exitCode: null, spawnErrorCode: null }));
      });
    });

    // Decoded per stream, so a multi-byte character split across chunks survives.
    for (const stream of [child.stdout, child.stderr]) {
      stream?.setEncoding('utf8');
      stream?.on('data', (chunk: string) => {
        output = (output + chunk).slice(-UPDATE_RAW_OUTPUT_LIMIT);
      });
    }
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({ exitCode: null, spawnErrorCode: error.code ?? 'UNKNOWN' });
    });
    // 'close' waits for the pipes as well, so the last output is in. A
    // background process the updater left running could hold them open
    // forever, so its exit code is used after a short grace period.
    child.on('exit', (code) => {
      later(2000, () => finish({ exitCode: timedOut ? null : code, spawnErrorCode: null }));
    });
    child.on('close', (code) => {
      finish({ exitCode: timedOut ? null : code, spawnErrorCode: null });
    });
  });
}

/**
 * Classifies a finished update run. Exit codes alone are not enough:
 * `opencode upgrade` prints "Upgrade failed" and still exits 0, so a run that
 * left the version unchanged is also checked for a failure in its output.
 */
function classifyUpdateFailure(
  run: UpdaterRun,
  previousVersion: string | null,
  installedVersion: string | null,
): CliUpdateFailure | null {
  if (run.spawnErrorCode) {
    return run.spawnErrorCode === 'EACCES' || run.spawnErrorCode === 'EPERM' ? 'permission_denied' : 'failed';
  }
  if (run.timedOut) {
    return 'timed_out';
  }
  const permissionDenied = PERMISSION_DENIED_PATTERN.test(run.output);
  if (run.exitCode !== 0) {
    return permissionDenied ? 'permission_denied' : 'failed';
  }
  if (previousVersion === installedVersion) {
    if (permissionDenied) {
      return 'permission_denied';
    }
    if (FAILURE_PATTERN.test(run.output)) {
      return 'failed';
    }
  }
  return null;
}

/**
 * Creates the service behind Settings -> Agents -> Account's CLI version row:
 * the installed version, the newest release on npm, and the update action.
 * Exported so tests can swap the registry, the busy-session lookup and the
 * platform flag.
 */
export function createProviderCliService(dependencyOverrides: Partial<ProviderCliServiceDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const latestVersionCache = new Map<string, { version: string | null; expiresAt: number }>();
  const latestVersionLookups = new Map<string, Promise<string | null>>();
  const updatesInProgress = new Map<LLMProvider, UpdateInProgress>();
  const lastUpdateResults = new Map<LLMProvider, ProviderCliUpdateResult>();

  const fetchLatestVersion = async (npmPackage: string): Promise<string | null> => {
    const response = await dependencies.fetch(`${NPM_REGISTRY_URL}/${npmPackage.replace('/', '%2F')}/latest`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(dependencies.latestVersionTimeoutMs),
    });
    if (!response.ok) {
      return null;
    }
    const manifest = (await response.json()) as { version?: unknown } | null;
    const version = typeof manifest?.version === 'string' ? manifest.version : null;
    return version && RELEASE_VERSION_PATTERN.test(version) ? version : null;
  };

  /** Never throws: an unreachable registry only means no "update available" hint. */
  const getLatestVersion = (npmPackage: string): Promise<string | null> => {
    const cached = latestVersionCache.get(npmPackage);
    if (cached && cached.expiresAt > dependencies.now()) {
      return Promise.resolve(cached.version);
    }

    // Concurrent page loads share one request instead of each asking the registry.
    let lookup = latestVersionLookups.get(npmPackage);
    if (!lookup) {
      lookup = fetchLatestVersion(npmPackage)
        .catch(() => null)
        .then((version) => {
          const ttl = version ? LATEST_VERSION_TTL_MS : LATEST_VERSION_FAILURE_TTL_MS;
          latestVersionCache.set(npmPackage, { version, expiresAt: dependencies.now() + ttl });
          return version;
        })
        .finally(() => latestVersionLookups.delete(npmPackage));
      latestVersionLookups.set(npmPackage, lookup);
    }
    return lookup;
  };

  const resolveUpdateCommand = (provider: LLMProvider): { command: string; args: string[] } | null => {
    const updater = CLI_UPDATERS[provider];
    const command = updater?.resolveCommand();
    return updater && command ? { command, args: updater.args } : null;
  };

  const runUpdate = async (
    provider: IProvider,
    update: { command: string; args: string[] },
    before: CliVersionProbe,
  ): Promise<ProviderCliUpdateResult> => {
    const run = await runUpdater(update.command, update.args, {
      timeoutMs: dependencies.updateTimeoutMs,
      killGraceMs: dependencies.updateKillGraceMs,
    });
    const installedVersion = provider.auth.checkInstalled().version;

    return {
      provider: provider.id,
      command: formatCommand(update.command, update.args),
      exitCode: run.exitCode,
      output: run.output,
      previousVersion: before.version,
      installedVersion,
      failure: classifyUpdateFailure(run, before.version, installedVersion),
    };
  };

  return {
    /**
     * Installed version, newest npm release, whether this server can update
     * the CLI, and whether an update of it is running.
     */
    async getCliStatus(providerName: LLMProvider): Promise<ProviderCliStatus> {
      const provider = dependencies.resolveProvider(providerName);
      // While an updater runs, the version from just before it is reported
      // instead of probed. `--version` runs synchronously and holds up every
      // other request for the CLI's start-up time (about a second for OpenCode
      // and cursor-agent), a page that follows the run asks every few seconds,
      // and the updater may be replacing that binary right then.
      const running = updatesInProgress.get(provider.id);
      let { installed, version: installedVersion } = running?.before ?? provider.auth.checkInstalled();
      const update = resolveUpdateCommand(provider.id);
      const updateUnavailableReason: CliUpdateUnavailableReason | null = dependencies.platformMode
        ? 'platform'
        : update ? null : 'bundled';

      // The registry is only worth asking when the answer can lead to an update
      // of a CLI that is there.
      const npmPackage = CLI_UPDATERS[provider.id]?.npmPackage;
      const latestVersion = installed && updateUnavailableReason === null && npmPackage
        ? await getLatestVersion(npmPackage)
        : null;

      // Read after the registry lookup, so a run that started meanwhile counts.
      // A run that ended meanwhile replaced the binary: the version from before
      // it would sit next to that run's result, so the CLI is probed once more,
      // or, when another run has started since, that run's starting version is
      // reported instead (still no probe while a run is going on).
      const runAfterLookup = updatesInProgress.get(provider.id);
      if (running && runAfterLookup !== running) {
        ({ installed, version: installedVersion } = runAfterLookup?.before ?? provider.auth.checkInstalled());
      }

      return {
        provider: provider.id,
        installed,
        installedVersion,
        latestVersion,
        updateAvailable: Boolean(installedVersion && latestVersion && isNewerVersion(latestVersion, installedVersion)),
        updateCommand: update && updateUnavailableReason === null ? formatCommand(update.command, update.args) : null,
        updateUnavailableReason,
        updateInProgress: Boolean(runAfterLookup),
        lastUpdate: lastUpdateResults.get(provider.id) ?? null,
      };
    },

    /**
     * Runs the CLI's own updater and reports its output and the version after
     * it. A second request while one runs gets the same result instead of
     * starting another updater over the first.
     */
    async updateCli(providerName: LLMProvider): Promise<ProviderCliUpdateResult> {
      if (dependencies.platformMode) {
        throw new AppError('The hosting platform manages the CLIs on this server.', {
          code: 'PROVIDER_CLI_UPDATE_UNAVAILABLE',
          statusCode: 403,
        });
      }

      const provider = dependencies.resolveProvider(providerName);
      const update = resolveUpdateCommand(provider.id);
      if (!update) {
        throw new AppError(`${getProviderLabel(provider.id)} ships with CloudCLI and is updated together with it.`, {
          code: 'PROVIDER_CLI_UPDATE_UNAVAILABLE',
          statusCode: 400,
        });
      }

      const running = updatesInProgress.get(provider.id);
      if (running) {
        return running.result;
      }

      // Replacing the binary under a live turn can break it mid-run, and some
      // updaters (Claude's native installer) refuse while the CLI is running.
      const busyProviders = await dependencies.listBusyProviders();
      // A request that came in during that lookup may have started a run.
      const startedMeanwhile = updatesInProgress.get(provider.id);
      if (startedMeanwhile) {
        return startedMeanwhile.result;
      }
      if (busyProviders.includes(provider.id)) {
        throw new AppError(
          `${getProviderLabel(provider.id)} is busy in at least one session. Wait for it to finish or stop it, then update.`,
          { code: 'PROVIDER_CLI_BUSY', statusCode: 409 },
        );
      }

      const before = provider.auth.checkInstalled();
      if (!before.installed) {
        throw new AppError(`${getProviderLabel(provider.id)} is not installed on the server, so there is nothing to update.`, {
          code: 'PROVIDER_CLI_NOT_INSTALLED',
          statusCode: 409,
        });
      }

      // Registered only now that the updater starts, so a refused request is
      // never reported as running; nothing above awaits after the re-check.
      // The result is stored before the run leaves updatesInProgress, so a
      // status request never sees the run over without its result.
      const result = runUpdate(provider, update, before)
        .then((finished) => {
          lastUpdateResults.set(provider.id, finished);
          return finished;
        })
        .finally(() => updatesInProgress.delete(provider.id));
      updatesInProgress.set(provider.id, { before, result });
      return result;
    },
  };
}

/** Used by the provider routes for `GET /:provider/cli` and `POST /:provider/cli/update`. */
export const providerCliService = createProviderCliService();
