import path from 'node:path';

import type {
  CliApplication,
  CliEnvironment,
  CliFileSystem,
  CliOutput,
  CliPackageMetadata,
  SandboxCommandService,
  SystemUpdateHistory,
  SystemUpdateRecord,
} from '@/shared/types.js';
import { terminalTextStyles } from '@/shared/utils.js';

type CliServiceDependencies = {
  applicationRoot: string;
  defaultDatabasePath: string;
  homeDirectory: string;
  packageMetadata: CliPackageMetadata;
  environment: CliEnvironment;
  fileSystem: CliFileSystem;
  output: CliOutput;
  sandboxService: SandboxCommandService;
  getLatestPackageVersion(): Promise<string>;
  /** Runs the npm update through the system module's recorded and checked workflow. */
  updateGlobalPackage(): Promise<SystemUpdateRecord>;
  readUpdateHistory(): Promise<SystemUpdateHistory>;
  startServer(): Promise<void>;
  startBrowserUseMcp(): Promise<void>;
};

type ParsedCliArguments = {
  command: string;
  options: {
    serverPort?: string;
    databasePath?: string;
  };
  remainingArguments: string[];
};

function parseCliArguments(argumentsList: string[]): ParsedCliArguments {
  const parsedArguments: ParsedCliArguments = {
    command: 'start',
    options: {},
    remainingArguments: [],
  };

  for (let argumentIndex = 0; argumentIndex < argumentsList.length; argumentIndex += 1) {
    const argument = argumentsList[argumentIndex];
    if (argument === '--port' || argument === '-p') {
      parsedArguments.options.serverPort = argumentsList[++argumentIndex];
    } else if (argument.startsWith('--port=')) {
      parsedArguments.options.serverPort = argument.slice('--port='.length);
    } else if (argument === '--database-path') {
      parsedArguments.options.databasePath = argumentsList[++argumentIndex];
    } else if (argument.startsWith('--database-path=')) {
      parsedArguments.options.databasePath = argument.slice('--database-path='.length);
    } else if (argument === '--help' || argument === '-h') {
      parsedArguments.command = 'help';
    } else if (argument === '--version' || argument === '-v') {
      parsedArguments.command = 'version';
    } else if (!argument.startsWith('-')) {
      parsedArguments.command = argument;
      if (argument === 'sandbox') {
        parsedArguments.remainingArguments = argumentsList.slice(argumentIndex + 1);
        break;
      }
    }
  }

  return parsedArguments;
}

function isNewerVersion(candidateVersion: string, currentVersion: string): boolean {
  const candidateParts = candidateVersion.split('.').map(Number);
  const currentParts = currentVersion.split('.').map(Number);
  for (let partIndex = 0; partIndex < 3; partIndex += 1) {
    if (candidateParts[partIndex] > currentParts[partIndex]) return true;
    if (candidateParts[partIndex] < currentParts[partIndex]) return false;
  }
  return false;
}

function formatRecordedTime(timestamp: string | null): string {
  const recordedAt = timestamp ? new Date(timestamp) : null;
  return recordedAt && !Number.isNaN(recordedAt.getTime()) ? recordedAt.toLocaleString() : 'unknown time';
}

const UPDATE_RESULT_LABELS: Record<SystemUpdateRecord['result'], string> = {
  running: terminalTextStyles.warn('did not finish'),
  succeeded: terminalTextStyles.ok('succeeded'),
  failed: terminalTextStyles.error('failed'),
  'verification-failed': terminalTextStyles.error('installed, but cannot start'),
};

// Speaks for a server that is down: which version last bound its port, what
// the last update changed, and the one command that goes back.
function showUpdateHistory(dependencies: CliServiceDependencies, history: SystemUpdateHistory): void {
  const { output } = dependencies;
  const installedVersion = dependencies.packageMetadata.version;
  const { lastStart, lastUpdate } = history;
  const lastStartIsThisInstall = lastStart?.appRoot === dependencies.applicationRoot;
  const installedVersionNeverStarted = Boolean(
    lastStart?.version && lastStartIsThisInstall && lastStart.version !== installedVersion,
  );

  output.log(`\n${terminalTextStyles.info('[INFO]')} Starts and Updates:`);
  if (lastStart) {
    const otherInstallNote = lastStartIsThisInstall ? '' : terminalTextStyles.dim(` (from ${lastStart.appRoot})`);
    output.log(`       Last started: ${terminalTextStyles.bright(lastStart.version ?? 'unknown version')} at ${formatRecordedTime(lastStart.startedAt)}${otherInstallNote}`);
  } else {
    output.log(`       Last started: ${terminalTextStyles.dim(`not recorded yet (${history.lastStartPath})`)}`);
  }
  if (installedVersionNeverStarted) {
    output.log(`       ${terminalTextStyles.warn('[WARN]')} ${installedVersion} is installed but has not started yet (restart pending, or it fails to start)`);
  }

  if (lastUpdate) {
    const versionChange = `${lastUpdate.previousVersion ?? 'unknown'} -> ${lastUpdate.installedVersion ?? 'unknown'}`;
    output.log(`       Last update:  ${versionChange} from ${lastUpdate.source}, ${UPDATE_RESULT_LABELS[lastUpdate.result] ?? lastUpdate.result} (${formatRecordedTime(lastUpdate.finishedAt ?? lastUpdate.startedAt)})`);
    if (lastUpdate.failureReason) {
      output.log(`                     ${terminalTextStyles.dim(lastUpdate.failureReason)}`);
    }
    if (lastUpdate.logPath) {
      output.log(`       Update log:   ${terminalTextStyles.dim(lastUpdate.logPath)}`);
    }
  } else {
    output.log(`       Last update:  ${terminalTextStyles.dim(`not recorded yet (${history.lastUpdatePath})`)}`);
  }

  // Offer a way back only while the installed version has not started. The
  // last version this install started is the safest target, and it also covers
  // a plain `npm install -g` that left no update record; without a start
  // record, fall back to the failed update's own command.
  let rollbackCommand: string | null = null;
  if (installedVersionNeverStarted) {
    rollbackCommand = lastStart?.installMode === 'npm'
      ? `npm install -g @cloudcli-ai/cloudcli@${lastStart.version}`
      : null;
  } else if (!lastStartIsThisInstall && lastUpdate && lastUpdate.result !== 'succeeded') {
    rollbackCommand = lastUpdate.rollbackCommand;
  }
  if (rollbackCommand) {
    output.log(`       Roll back:    ${terminalTextStyles.bright(rollbackCommand)}`);
  }
}

async function showStatus(dependencies: CliServiceDependencies): Promise<void> {
  const { environment, fileSystem, output } = dependencies;
  const databasePath = environment.DATABASE_PATH || dependencies.defaultDatabasePath;
  const databaseExists = fileSystem.pathExists(databasePath);
  const claudeProjectsPath = path.join(dependencies.homeDirectory, '.claude', 'projects');
  const environmentFilePath = path.join(dependencies.applicationRoot, '.env');

  output.log(`\n${terminalTextStyles.bright('CloudCLI UI - Status')}\n`);
  output.log(terminalTextStyles.dim('═'.repeat(60)));
  output.log(`\n${terminalTextStyles.info('[INFO]')} Version: ${terminalTextStyles.bright(dependencies.packageMetadata.version)}`);
  try {
    showUpdateHistory(dependencies, await dependencies.readUpdateHistory());
  } catch (error) {
    // Status has to work on a broken install, so a history that cannot load
    // only loses its own section.
    const message = error instanceof Error ? error.message : String(error);
    output.log(`\n${terminalTextStyles.warn('[WARN]')} Could not read the update history: ${message}`);
  }
  output.log(`\n${terminalTextStyles.info('[INFO]')} Installation Directory:`);
  output.log(`       ${terminalTextStyles.dim(dependencies.applicationRoot)}`);
  output.log(`\n${terminalTextStyles.info('[INFO]')} Database Location:`);
  output.log(`       ${terminalTextStyles.dim(databasePath)}`);
  output.log(`       Status: ${databaseExists
    ? terminalTextStyles.ok('[OK] Exists')
    : terminalTextStyles.warn('[WARN] Not created yet (will be created on first run)')}`);

  if (databaseExists) {
    const databaseStats = fileSystem.getFileStats(databasePath);
    output.log(`       Size: ${terminalTextStyles.dim(`${(databaseStats.size / 1024).toFixed(2)} KB`)}`);
    output.log(`       Modified: ${terminalTextStyles.dim(databaseStats.modifiedAt.toLocaleString())}`);
  }

  output.log(`\n${terminalTextStyles.info('[INFO]')} Configuration:`);
  output.log(`       SERVER_PORT: ${terminalTextStyles.bright(environment.SERVER_PORT || environment.PORT || '3001')} ${terminalTextStyles.dim(environment.SERVER_PORT || environment.PORT ? '' : '(default)')}`);
  output.log(`       DATABASE_PATH: ${terminalTextStyles.dim(environment.DATABASE_PATH || '(using default location)')}`);
  output.log(`       CLAUDE_CLI_PATH: ${terminalTextStyles.dim(environment.CLAUDE_CLI_PATH || 'claude (default)')}`);
  output.log(`       CONTEXT_WINDOW: ${terminalTextStyles.dim(environment.CONTEXT_WINDOW || '160000 (default)')}`);
  output.log(`\n${terminalTextStyles.info('[INFO]')} Claude Projects Folder:`);
  output.log(`       ${terminalTextStyles.dim(claudeProjectsPath)}`);
  output.log(`       Status: ${fileSystem.pathExists(claudeProjectsPath)
    ? terminalTextStyles.ok('[OK] Exists')
    : terminalTextStyles.warn('[WARN] Not found')}`);
  output.log(`\n${terminalTextStyles.info('[INFO]')} Configuration File:`);
  output.log(`       ${terminalTextStyles.dim(environmentFilePath)}`);
  output.log(`       Status: ${fileSystem.pathExists(environmentFilePath)
    ? terminalTextStyles.ok('[OK] Exists')
    : terminalTextStyles.warn('[WARN] Not found (using defaults)')}`);
  output.log(`\n${terminalTextStyles.dim('═'.repeat(60))}`);
  output.log(`\n${terminalTextStyles.tip('[TIP]')} Hints:`);
  output.log(`      ${terminalTextStyles.dim('>')} Use ${terminalTextStyles.bright('cloudcli --port 8080')} to run on a custom port`);
  output.log(`      ${terminalTextStyles.dim('>')} Use ${terminalTextStyles.bright('cloudcli --database-path /path/to/db')} for custom database`);
  output.log(`      ${terminalTextStyles.dim('>')} Run ${terminalTextStyles.bright('cloudcli help')} for all options`);
  output.log(`      ${terminalTextStyles.dim('>')} Access the UI at http://localhost:${environment.SERVER_PORT || environment.PORT || '3001'}\n`);
}

function showHelp(dependencies: CliServiceDependencies): void {
  dependencies.output.log(`
╔═══════════════════════════════════════════════════════════════╗
║              CloudCLI - Command Line Tool               ║
╚═══════════════════════════════════════════════════════════════╝

Usage:
  claude-code-ui [command] [options]
  cloudcli [command] [options]

Commands:
  start            Start the CloudCLI server (default)
  sandbox          Manage Docker sandbox environments
  browser-use-mcp  Run Browser MCP stdio server
  status           Show configuration and data locations
  update           Update to the latest version
  help             Show this help information
  version          Show version information

Options:
  -p, --port <port>           Set server port (default: 3001)
  --database-path <path>      Set custom database location
  -h, --help                  Show this help information
  -v, --version               Show version information

Examples:
  $ cloudcli                        # Start with defaults
  $ cloudcli --port 8080            # Start on port 8080
  $ cloudcli sandbox ~/my-project   # Run in a Docker sandbox
  $ cloudcli status                 # Show configuration

Environment Variables:
  SERVER_PORT         Set server port (default: 3001)
  PORT                Set server port (default: 3001) (LEGACY)
  DATABASE_PATH       Set custom database location
  CLAUDE_CLI_PATH     Set custom Claude CLI path
  CONTEXT_WINDOW      Set context window size (default: 160000)

Documentation:
  ${dependencies.packageMetadata.homepage || 'https://github.com/siteboon/claudecodeui'}

Report Issues:
  ${dependencies.packageMetadata.bugsUrl || 'https://github.com/siteboon/claudecodeui/issues'}
`);
}

/**
 * Creates the top-level CLI command service used by the CLI composition root
 * and unit tests. Every filesystem, subprocess, environment, output, and
 * cross-module startup dependency is explicit and required.
 */
export function createCliService(dependencies: CliServiceDependencies): CliApplication {
  const checkForUpdates = async (silent = false): Promise<boolean> => {
    try {
      const latestVersion = await dependencies.getLatestPackageVersion();
      const currentVersion = dependencies.packageMetadata.version;
      if (isNewerVersion(latestVersion, currentVersion)) {
        dependencies.output.log(`\n${terminalTextStyles.warn('[UPDATE]')} New version available: ${terminalTextStyles.bright(latestVersion)} (current: ${currentVersion})`);
        dependencies.output.log(`         Run ${terminalTextStyles.bright('cloudcli update')} to update\n`);
        return true;
      }
      if (!silent) {
        dependencies.output.log(`${terminalTextStyles.ok('[OK]')} You are on the latest version (${currentVersion})`);
      }
      return false;
    } catch {
      if (!silent) {
        dependencies.output.log(`${terminalTextStyles.warn('[WARN]')} Could not check for updates`);
      }
      return false;
    }
  };

  /** Returns false when the update failed or installed a version that cannot start. */
  const updatePackage = async (): Promise<boolean> => {
    dependencies.output.log(`${terminalTextStyles.info('[INFO]')} Checking for updates...`);
    const hasUpdate = await checkForUpdates(true);
    if (!hasUpdate) {
      dependencies.output.log(`${terminalTextStyles.ok('[OK]')} Already on the latest version (${dependencies.packageMetadata.version})`);
      return true;
    }

    let record: SystemUpdateRecord;
    try {
      dependencies.output.log(`${terminalTextStyles.info('[INFO]')} Updating ${dependencies.packageMetadata.version}...`);
      record = await dependencies.updateGlobalPackage();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dependencies.output.error(`${terminalTextStyles.error('[ERROR]')} Update failed: ${message}`);
      dependencies.output.log(`${terminalTextStyles.tip('[TIP]')} Try running manually: npm update -g @cloudcli-ai/cloudcli`);
      return false;
    }

    if (record.result === 'succeeded') {
      dependencies.output.log(`${terminalTextStyles.ok('[OK]')} Update complete (${record.previousVersion ?? 'unknown'} -> ${record.installedVersion ?? 'unknown'})! Restart cloudcli to use the new version.`);
      if (record.rollbackCommand) {
        dependencies.output.log(`${terminalTextStyles.tip('[TIP]')} If it does not start after the restart, go back with: ${record.rollbackCommand}`);
      }
    } else if (record.result === 'verification-failed') {
      dependencies.output.error(`${terminalTextStyles.error('[ERROR]')} ${record.installedVersion ?? 'The new version'} was installed but cannot start: ${record.failureReason}`);
      if (record.rollbackCommand) {
        dependencies.output.log(`${terminalTextStyles.tip('[TIP]')} Go back to the previous version with: ${record.rollbackCommand}`);
      }
    } else {
      dependencies.output.error(`${terminalTextStyles.error('[ERROR]')} Update failed: ${record.failureReason ?? 'unknown error'}`);
      dependencies.output.log(`${terminalTextStyles.tip('[TIP]')} Try running manually: npm update -g @cloudcli-ai/cloudcli`);
    }
    if (record.logPath) {
      dependencies.output.log(`${terminalTextStyles.info('[INFO]')} Update log: ${record.logPath}`);
    }
    return record.result === 'succeeded';
  };

  return {
    async run(argumentsList) {
      const parsedArguments = parseCliArguments(argumentsList);
      if (parsedArguments.options.serverPort) {
        dependencies.environment.SERVER_PORT = parsedArguments.options.serverPort;
      } else if (!dependencies.environment.SERVER_PORT && dependencies.environment.PORT) {
        dependencies.environment.SERVER_PORT = dependencies.environment.PORT;
      }
      if (parsedArguments.options.databasePath) {
        dependencies.environment.DATABASE_PATH = parsedArguments.options.databasePath;
      }

      switch (parsedArguments.command) {
        case 'start':
          void checkForUpdates(true);
          await dependencies.startServer();
          return 0;
        case 'sandbox':
          return dependencies.sandboxService.execute(parsedArguments.remainingArguments);
        case 'browser-use-mcp':
          await dependencies.startBrowserUseMcp();
          return 0;
        case 'status':
        case 'info':
          await showStatus(dependencies);
          return 0;
        case 'help':
          showHelp(dependencies);
          return 0;
        case 'version':
          dependencies.output.log(dependencies.packageMetadata.version);
          return 0;
        case 'update':
          return await updatePackage() ? 0 : 1;
        default:
          dependencies.output.error(`\n❌ Unknown command: ${parsedArguments.command}`);
          dependencies.output.log('   Run "cloudcli help" for usage information.\n');
          return 1;
      }
    },
  };
}
