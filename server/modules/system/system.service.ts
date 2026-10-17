import path from 'node:path';

type SystemUpdateCommandResult = {
  exitCode: number | null;
  output: string;
  errorOutput: string;
};

type SystemUpdateResult =
  | { success: true; output: string; message: string }
  | { success: false; error: string; output?: string; errorOutput?: string };

type SystemUpdateDependencies = {
  appRoot: string;
  homeDirectory: string;
  installMode: 'git' | 'npm';
  isPlatform: boolean;
  environment: NodeJS.ProcessEnv;
  runShellCommand(
    command: string,
    workingDirectory: string,
    environment: NodeJS.ProcessEnv,
    onOutput: (output: string) => void,
    onErrorOutput: (errorOutput: string) => void,
  ): Promise<SystemUpdateCommandResult>;
  createDirectory(directory: string): Promise<void>;
  moveDirectory(from: string, to: string): Promise<void>;
  removeDirectory(directory: string): Promise<void>;
  logInfo(message: string, detail?: string): void;
  logError(message: string, detail?: string): void;
};

// --install-strategy=shallow nests every transitive dependency inside the
// package directory, exactly like `npm install -g`, so the directory can be moved.
const NPM_STAGED_INSTALL_COMMAND =
  'npm install --prefix . --install-strategy=shallow --no-save --no-package-lock @cloudcli-ai/cloudcli@latest';

/**
 * Creates the update workflow used by the system module and its focused tests.
 * Runtime-specific process spawning stays behind the injected command adapter.
 */
export function createSystemUpdateService(dependencies: SystemUpdateDependencies) {
  let runningUpdate: Promise<SystemUpdateResult> | null = null;
  let lastResult: SystemUpdateResult | null = null;

  async function runUpdateCommand(command: string, workingDirectory: string): Promise<SystemUpdateResult> {
    const result = await dependencies.runShellCommand(
      command,
      workingDirectory,
      dependencies.environment,
      (output) => dependencies.logInfo('Update output:', output),
      (errorOutput) => dependencies.logError('Update error:', errorOutput),
    );

    if (result.exitCode === 0) {
      return {
        success: true,
        output: result.output || 'Update completed successfully',
        message: 'Update completed. Please restart the server to apply changes.',
      };
    }

    return {
      success: false,
      error: 'Update command failed',
      output: result.output,
      errorOutput: result.errorOutput,
    };
  }

  /**
   * Installs the new version next to the running one and swaps the directories
   * only after npm succeeded. An in-place `npm install -g` that gets killed
   * (e.g. by the OOM killer together with the server's cgroup) leaves a
   * half-deleted package behind that can no longer start.
   */
  async function updateNpmInstallation(): Promise<SystemUpdateResult> {
    const scopeDirectory = path.dirname(dependencies.appRoot);
    const stagingRoot = path.join(scopeDirectory, '.cloudcli-update');
    const stagedApp = path.join(stagingRoot, 'node_modules', '@cloudcli-ai', 'cloudcli');
    const previousApp = path.join(scopeDirectory, '.cloudcli-previous');

    dependencies.logInfo('Starting system update from directory:', stagingRoot);
    await dependencies.removeDirectory(stagingRoot);
    await dependencies.createDirectory(stagingRoot);

    const result = await runUpdateCommand(NPM_STAGED_INSTALL_COMMAND, stagingRoot);
    if (!result.success) {
      return result;
    }

    // shortcut: the global bin symlink is reused as is, so a release that renames its bin entry needs a manual `npm install -g`.
    await dependencies.removeDirectory(previousApp);
    await dependencies.moveDirectory(dependencies.appRoot, previousApp);
    try {
      await dependencies.moveDirectory(stagedApp, dependencies.appRoot);
    } catch (error) {
      await dependencies.moveDirectory(previousApp, dependencies.appRoot);
      throw error;
    }

    await dependencies.removeDirectory(stagingRoot);
    await dependencies.removeDirectory(previousApp);
    return result;
  }

  /** Selects and executes the correct update workflow for this installation. */
  async function updateSystem(): Promise<SystemUpdateResult> {
    try {
      if (!dependencies.isPlatform && dependencies.installMode === 'npm') {
        return await updateNpmInstallation();
      }

      const updateCommand = dependencies.isPlatform
        ? 'npm run update:platform'
        : 'git checkout main && git pull && npm install';
      dependencies.logInfo('Starting system update from directory:', dependencies.appRoot);
      return await runUpdateCommand(updateCommand, dependencies.appRoot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dependencies.logError('Update process error:', message);
      return {
        success: false,
        error: message,
      };
    }
  }

  return {
    updateSystem,

    /**
     * Runs the update in the background so a slow install cannot outlast the
     * HTTP request and surface as a proxy timeout. Repeated calls while an
     * update is running join the existing run.
     */
    startUpdate() {
      if (runningUpdate) {
        return;
      }

      lastResult = null;
      runningUpdate = updateSystem().then((result) => {
        lastResult = result;
        runningUpdate = null;
        return result;
      });
    },

    getUpdateStatus() {
      return { running: runningUpdate !== null, result: lastResult };
    },
  };
}
