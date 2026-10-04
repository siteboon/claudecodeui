import type { ChildProcess, SpawnOptions } from 'node:child_process';

/** An OS helper that holds a sleep assertion for exactly as long as it runs. */
type KeepAwakeCommand = {
  command: string;
  args: string[];
};

/** What the Settings screen shows: the saved choice, whether this machine can honour it, and whether it is now. */
type KeepAwakeStatus = {
  enabled: boolean;
  supported: boolean;
  active: boolean;
};

type KeepAwakeDependencies = {
  platform: NodeJS.Platform;
  /**
   * Every helper watches this pid and exits on its own once it is gone, so a
   * server that crashes or is killed can never leave the machine pinned awake.
   */
  serverPid: number;
  /** Hosted instances run in the cloud, where there is no machine of the user's to keep awake. */
  isPlatform: boolean;
  commandExists(command: string): boolean;
  spawnProcess(command: string, args: string[], options: SpawnOptions): ChildProcess;
  /** Signals a helper's whole process group, which on Linux also holds its watchdog. */
  killProcessGroup(pid: number): void;
  readEnabled(): boolean;
  writeEnabled(enabled: boolean): void;
  logInfo(message: string): void;
  logWarn(message: string): void;
  /** Overrides MAX_HOLD_MS; tests only. */
  maxHoldMs?: number;
};

/**
 * Backstop for a run whose runtime promise never settles. Without it one hung
 * runtime would keep the machine awake until the server restarts; real runs,
 * including Claude's post-turn wait for background agents, end long before.
 */
const MAX_HOLD_MS = 12 * 60 * 60 * 1000;

/** Shown by `systemd-inhibit --list`, and by desktops that list who blocks sleep. */
const KEEP_AWAKE_REASON = 'An agent is working';

/**
 * Picks the helper for this platform, or null where none is available.
 *
 * None of them is an npm dependency: `caffeinate` ships with macOS,
 * PowerShell with Windows, and `systemd-inhibit` with systemd (checked on
 * PATH, because plenty of Linux machines and containers run without it).
 */
function resolveKeepAwakeCommand(dependencies: KeepAwakeDependencies): KeepAwakeCommand | null {
  if (dependencies.isPlatform) {
    return null;
  }

  const serverPid = String(dependencies.serverPid);

  switch (dependencies.platform) {
    case 'darwin':
      // -i prevents idle sleep only: the display can still turn off, and
      // closing the lid still sleeps the Mac. -w exits with the server.
      return { command: 'caffeinate', args: ['-i', '-w', serverPid] };

    case 'linux':
      if (!dependencies.commandExists('systemd-inhibit')) {
        return null;
      }
      // The inhibitor lasts as long as the command it runs. That command
      // polls the server pid, so an orphaned inhibitor lets go within seconds.
      return {
        command: 'systemd-inhibit',
        args: [
          '--what=idle:sleep',
          '--who=CloudCLI',
          `--why=${KEEP_AWAKE_REASON}`,
          '--mode=block',
          'sh',
          '-c',
          'while kill -0 "$0" 2>/dev/null; do sleep 5; done',
          serverPid,
        ],
      };

    case 'win32':
      return {
        command: 'powershell.exe',
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', buildWindowsKeepAwakeScript(serverPid)],
      };

    default:
      return null;
  }
}

/**
 * Asks Windows to stay out of idle sleep (ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
 * for as long as this PowerShell thread lives, which is until the server exits
 * or the helper is stopped. The DllImport string is assembled from [char]34
 * so the script carries no double quotes through Windows argument quoting.
 */
function buildWindowsKeepAwakeScript(serverPid: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    '$quote = [char]34',
    "Add-Type -Namespace CloudCli -Name Power -MemberDefinition ('[DllImport(' + $quote + 'kernel32.dll' + $quote + ')] public static extern uint SetThreadExecutionState(uint esFlags);')",
    '[void][CloudCli.Power]::SetThreadExecutionState([uint32]2147483649)',
    `Wait-Process -Id ${serverPid}`,
  ].join('; ');
}

/**
 * Keeps the computer running CloudCLI out of idle sleep while agents work, when
 * the user has opted in.
 *
 * Runs are reference-counted and share ONE helper process: it starts when the
 * first hold is taken and stops when the last is released, when the setting is
 * switched off, and on shutdown. Nothing is ever spawned while the setting is
 * off, and a helper that cannot start only logs — it never fails a run.
 */
export function createKeepAwakeService(dependencies: KeepAwakeDependencies) {
  const maxHoldMs = dependencies.maxHoldMs ?? MAX_HOLD_MS;
  const activeHolds = new Set<symbol>();
  // Off until initialize() reads the saved choice, so code that runs a
  // provider without the database (tests, scripts) never spawns anything.
  let enabled = false;
  let isShutDown = false;
  let helper: ChildProcess | null = null;

  const stopHelper = (): void => {
    const runningHelper = helper;
    if (!runningHelper) {
      return;
    }
    // Cleared first so the helper's exit reads as expected, not as a failure.
    helper = null;

    try {
      if (dependencies.platform !== 'win32' && runningHelper.pid) {
        dependencies.killProcessGroup(runningHelper.pid);
      } else {
        runningHelper.kill();
      }
    } catch {
      // Already gone (it watches the server and may have exited on its own).
      runningHelper.kill();
    }
    dependencies.logInfo('[KeepAwake] Allowing this computer to sleep again');
  };

  const startHelper = (): void => {
    const keepAwakeCommand = resolveKeepAwakeCommand(dependencies);
    if (!keepAwakeCommand) {
      return;
    }

    const { command, args } = keepAwakeCommand;
    let startedHelper: ChildProcess;
    try {
      startedHelper = dependencies.spawnProcess(command, args, {
        stdio: 'ignore',
        // Its own process group on POSIX, so stopping it also stops the
        // watchdog that systemd-inhibit runs. Windows needs no group, and
        // detaching there would open a console window.
        detached: dependencies.platform !== 'win32',
        windowsHide: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dependencies.logWarn(`[KeepAwake] Could not start ${command}: ${message}`);
      return;
    }

    helper = startedHelper;
    // The helper must never keep the server process alive on its own.
    startedHelper.unref();

    // `on`, not `once`: a failed kill() can emit a second 'error' later, and an
    // unhandled one would take the whole server down.
    startedHelper.on('error', (error) => {
      if (helper === startedHelper) {
        helper = null;
      }
      dependencies.logWarn(`[KeepAwake] ${command} failed: ${error.message}`);
    });
    startedHelper.once('exit', (code, signal) => {
      if (helper !== startedHelper) {
        return;
      }
      // Exited without being stopped. The next run that starts or ends tries again.
      helper = null;
      dependencies.logWarn(`[KeepAwake] ${command} exited unexpectedly (${signal ?? `code ${code}`})`);
    });

    dependencies.logInfo(`[KeepAwake] Keeping this computer awake while agents work (${command})`);
  };

  /** Brings the helper in line with the setting and the number of runs in progress. */
  const reconcile = (): void => {
    const shouldHold = enabled && !isShutDown && activeHolds.size > 0;
    if (shouldHold && !helper) {
      startHelper();
    } else if (!shouldHold && helper) {
      stopHelper();
    }
  };

  const getStatus = (): KeepAwakeStatus => ({
    enabled,
    supported: resolveKeepAwakeCommand(dependencies) !== null,
    active: helper !== null,
  });

  return {
    /** Loads the saved setting. Called once the database is ready, before any run can start. */
    initialize(): void {
      enabled = dependencies.readEnabled();
      reconcile();
    },

    /**
     * Holds the computer awake for one run and returns its release. Release is
     * idempotent, and a hold that is never released lapses after MAX_HOLD_MS.
     */
    acquire(): () => void {
      const hold = Symbol('keep-awake-hold');
      let released = false;

      const release = (): void => {
        if (released) {
          return;
        }
        released = true;
        clearTimeout(lapseTimer);
        activeHolds.delete(hold);
        reconcile();
      };

      const lapseTimer = setTimeout(() => {
        dependencies.logWarn('[KeepAwake] A run has held this computer awake for too long; releasing it');
        release();
      }, maxHoldMs);
      lapseTimer.unref?.();

      activeHolds.add(hold);
      reconcile();
      return release;
    },

    getStatus,

    /** Saves the setting and applies it at once, to runs already in progress too. */
    setEnabled(nextEnabled: boolean): KeepAwakeStatus {
      dependencies.writeEnabled(nextEnabled);
      enabled = nextEnabled;
      reconcile();
      return getStatus();
    },

    /** Stops the helper for good; called while the server shuts down. */
    shutdown(): void {
      isShutDown = true;
      stopHelper();
    },
  };
}
