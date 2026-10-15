import type { SystemUpdateRecord } from '@/shared/types.js';

import type { createSystemUpdateHistoryService } from './system-update-history.service.js';

type SystemUpdateCommandResult = {
  exitCode: number | null;
  output: string;
  errorOutput: string;
};

type InstalledPackageCheckResult =
  | { passed: true }
  | { passed: false; reason: string; details: string };

type SystemUpdateDependencies = {
  appRoot: string;
  homeDirectory: string;
  installMode: 'git' | 'npm';
  isPlatform: boolean;
  /** Version this process runs; null for `cloudcli update`, which is not the server. */
  runningVersion: string | null;
  nodeVersion: string;
  environment: NodeJS.ProcessEnv;
  updateHistory: ReturnType<typeof createSystemUpdateHistoryService>;
  runShellCommand(
    command: string,
    workingDirectory: string,
    environment: NodeJS.ProcessEnv,
    onOutput: (output: string) => void,
    onErrorOutput: (errorOutput: string) => void,
  ): Promise<SystemUpdateCommandResult>;
  /** Reads the version in the application's package.json, or null when unreadable. */
  readInstalledVersion(): string | null;
  /** Loads the installed package the way the next start will, without starting a server. */
  checkInstalledPackage(): Promise<InstalledPackageCheckResult>;
  now(): Date;
  logInfo(message: string, detail?: string): void;
  logError(message: string, detail?: string): void;
};

type RecordedUpdateRequest = {
  source: SystemUpdateRecord['source'];
  command: string;
  workingDirectory: string;
  onOutput(output: string): void;
  onErrorOutput(errorOutput: string): void;
};

const PACKAGE_NAME = '@cloudcli-ai/cloudcli';

function formatUpdateLog(
  record: SystemUpdateRecord,
  commandResult: SystemUpdateCommandResult,
  checkDetails: string,
): string {
  const header: Array<[string, string | number | null]> = [
    ['Started', record.startedAt],
    ['Finished', record.finishedAt],
    ['Source', record.source],
    ['Install mode', record.installMode],
    ['Command', record.command],
    ['Working directory', record.workingDirectory],
    ['Application root', record.appRoot],
    ['Node', record.nodeVersion],
    ['Running version', record.runningVersion],
    ['Previous version', record.previousVersion],
    ['Installed version', record.installedVersion],
    ['Exit code', record.exitCode],
    ['Result', record.result],
    ['Failure', record.failureReason],
    ['Roll back with', record.rollbackCommand],
  ];
  const sections = [
    'CloudCLI update log',
    ...header.map(([label, value]) => `${`${label}:`.padEnd(19)} ${value ?? '-'}`),
    '',
    '===== stdout =====',
    commandResult.output,
    // npm prints deprecation notices and other warnings on stderr even when an
    // install succeeds: the exit code above, not this section, decides success.
    '===== stderr (warnings and errors) =====',
    commandResult.errorOutput,
  ];
  if (checkDetails) {
    sections.push('===== installed package check =====', checkDetails);
  }
  return `${sections.join('\n')}\n`;
}

function describeFailedPackageCheck(record: SystemUpdateRecord): string {
  const installedLabel = record.installedVersion ?? 'The new version';
  const reason = record.failureReason ?? 'unknown error';
  const parts = [`${installedLabel} was installed but cannot start: ${reason}${/[.!?]$/.test(reason) ? '' : '.'}`];
  if (record.runningVersion) {
    parts.push(`This server keeps running ${record.runningVersion} until it restarts.`);
  }
  if (record.rollbackCommand) {
    // Quoted so the command ends visibly where the next sentence starts.
    parts.push(`To go back, run "${record.rollbackCommand}".`);
  }
  if (record.logPath) {
    parts.push(`Full log: ${record.logPath}`);
  }
  return parts.join(' ');
}

/**
 * Creates the update workflow used by the system module and its focused tests.
 * Runtime-specific process spawning stays behind the injected command adapter.
 */
export function createSystemUpdateService(dependencies: SystemUpdateDependencies) {
  const { updateHistory } = dependencies;

  // Records are best effort: a full disk or a read-only home folder must never
  // turn a finished install into a failed update.
  const saveRecord = (record: SystemUpdateRecord): void => {
    try {
      updateHistory.recordUpdate(record);
    } catch (error) {
      dependencies.logError('Could not write the update record:', error instanceof Error ? error.message : String(error));
    }
  };

  /**
   * Runs one update command and leaves a durable trace of it: the versions
   * before and after, a check that an npm install can still load, a full log,
   * and the last-update record that `cloudcli status` reads.
   */
  const runRecordedUpdate = async (request: RecordedUpdateRequest) => {
    const installMode = dependencies.isPlatform ? 'platform' as const : dependencies.installMode;
    const startedAt = dependencies.now();
    const previousVersion = dependencies.readInstalledVersion();
    // Go back to a version proven to start: the running server's own, else (for
    // `cloudcli update`) the last one this install started, else the one that
    // was installed when the update began.
    const lastStart = dependencies.runningVersion ? null : updateHistory.readHistory().lastStart;
    const lastStartedVersion = lastStart?.appRoot === dependencies.appRoot ? lastStart.version : null;
    const knownGoodVersion = dependencies.runningVersion ?? lastStartedVersion ?? previousVersion;
    const logPath = updateHistory.getUpdateLogPath(startedAt);
    const record: SystemUpdateRecord = {
      source: request.source,
      installMode,
      command: request.command,
      workingDirectory: request.workingDirectory,
      appRoot: dependencies.appRoot,
      nodeVersion: dependencies.nodeVersion,
      runningVersion: dependencies.runningVersion,
      previousVersion,
      installedVersion: null,
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      exitCode: null,
      result: 'running',
      failureReason: null,
      rollbackCommand: installMode === 'npm' && knownGoodVersion
        ? `npm install -g ${PACKAGE_NAME}@${knownGoodVersion}`
        : null,
      // Set once the log exists, so a record never points at a missing file.
      logPath: null,
    };
    // Written before the command runs, so an update killed midway (a platform
    // restart, an OOM kill) still shows up in `cloudcli status`.
    saveRecord(record);

    let commandResult: SystemUpdateCommandResult = { exitCode: null, output: '', errorOutput: '' };
    let processError: string | null = null;
    try {
      commandResult = await dependencies.runShellCommand(
        request.command,
        request.workingDirectory,
        dependencies.environment,
        request.onOutput,
        request.onErrorOutput,
      );
    } catch (error) {
      processError = error instanceof Error ? error.message : String(error);
    }

    let checkDetails = '';
    record.exitCode = commandResult.exitCode;
    record.installedVersion = dependencies.readInstalledVersion();
    if (processError) {
      record.result = 'failed';
      record.failureReason = processError;
    } else if (commandResult.exitCode !== 0) {
      record.result = 'failed';
      record.failureReason = `Update command exited with code ${commandResult.exitCode}`;
    } else if (installMode === 'npm') {
      // Only a global npm install replaces the package in place with files this
      // process has never loaded; git and platform updates keep their workflows.
      const checkResult = await dependencies.checkInstalledPackage().catch((error: unknown) => ({
        passed: false as const,
        reason: `the installed package check could not run (${error instanceof Error ? error.message : String(error)})`,
        details: '',
      }));
      if (checkResult.passed) {
        record.result = 'succeeded';
      } else {
        record.result = 'verification-failed';
        record.failureReason = checkResult.reason;
        checkDetails = checkResult.details;
      }
    } else {
      record.result = 'succeeded';
    }
    record.finishedAt = dependencies.now().toISOString();

    try {
      updateHistory.writeUpdateLog(logPath, formatUpdateLog(record, commandResult, checkDetails));
      record.logPath = logPath;
    } catch (error) {
      dependencies.logError('Could not write the update log:', error instanceof Error ? error.message : String(error));
    }
    saveRecord(record);

    return { record, commandResult, processError };
  };

  return {
    /** Selects and executes the correct update workflow for this installation. */
    async updateSystem() {
      const updateCommand = dependencies.isPlatform
        ? 'npm run update:platform'
        : dependencies.installMode === 'git'
          ? 'git checkout main && git pull && npm install'
          : 'npm install -g @cloudcli-ai/cloudcli@latest';
      const workingDirectory = dependencies.isPlatform || dependencies.installMode === 'git'
        ? dependencies.appRoot
        : dependencies.homeDirectory;

      dependencies.logInfo('Starting system update from directory:', workingDirectory);

      const { record, commandResult, processError } = await runRecordedUpdate({
        source: 'web',
        command: updateCommand,
        workingDirectory,
        onOutput: (output) => dependencies.logInfo('Update output:', output),
        // npm writes warnings (deprecations, funding notes) to stderr on success.
        onErrorOutput: (errorOutput) => dependencies.logInfo('Update output (stderr):', errorOutput),
      });
      if (record.logPath) {
        dependencies.logInfo('Update log written to:', record.logPath);
      }

      const updateDetails = {
        previousVersion: record.previousVersion,
        installedVersion: record.installedVersion,
        rollbackCommand: record.rollbackCommand,
        logPath: record.logPath,
      };

      if (record.result === 'succeeded') {
        return {
          success: true as const,
          output: commandResult.output || 'Update completed successfully',
          message: 'Update completed. Please restart the server to apply changes.',
          ...updateDetails,
        };
      }

      if (processError) {
        dependencies.logError('Update process error:', processError);
        return {
          success: false as const,
          error: processError,
          ...updateDetails,
        };
      }

      if (record.result === 'failed') {
        dependencies.logError('Update error:', record.failureReason ?? 'Update command failed');
        return {
          success: false as const,
          error: 'Update command failed',
          output: commandResult.output,
          errorOutput: commandResult.errorOutput,
          ...updateDetails,
        };
      }

      const failureMessage = describeFailedPackageCheck(record);
      dependencies.logError('Update installed a version that cannot start:', failureMessage);
      return {
        success: false as const,
        error: failureMessage,
        output: commandResult.output,
        errorOutput: commandResult.errorOutput,
        ...updateDetails,
      };
    },

    runRecordedUpdate,
  };
}
