import { spawn as spawnInPlatformShell, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';
import type { Router } from 'express';

import type { SystemUpdateCommandResult } from '@/shared/types.js';

import { createSystemRouter } from './system.routes.js';
import { checkInstalledPackage, readInstalledPackageVersion } from './system-installed-package.service.js';
import { createSystemUpdateHistoryService } from './system-update-history.service.js';
import { createRecordedUpdateRunner, createSystemUpdateService } from './system.service.js';

type SystemModuleOptions = {
  appRoot: string;
  installMode: 'git' | 'npm';
  isPlatform: boolean;
  /**
   * Version of the running server, read once at startup by the entrypoint.
   * Optional for existing callers; without it the rollback target falls back
   * to the last recorded start of this install, then to the version on disk.
   */
  runningVersion?: string | null;
};

function collectCommandOutput(
  childProcess: ChildProcess,
  onOutput: (output: string) => void,
  onErrorOutput: (errorOutput: string) => void,
): Promise<SystemUpdateCommandResult> {
  return new Promise((resolve, reject) => {
    let output = '';
    let errorOutput = '';

    childProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      onOutput(text);
    });
    childProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      errorOutput += text;
      onErrorOutput(text);
    });
    childProcess.once('error', reject);
    childProcess.once('close', (exitCode) => {
      resolve({ exitCode, output, errorOutput });
    });
  });
}

function runShellCommand(
  command: string,
  workingDirectory: string,
  environment: NodeJS.ProcessEnv,
  onOutput: (output: string) => void,
  onErrorOutput: (errorOutput: string) => void,
): Promise<SystemUpdateCommandResult> {
  const childProcess = spawn('sh', ['-c', command], {
    cwd: workingDirectory,
    env: environment,
  });
  return collectCommandOutput(childProcess, onOutput, onErrorOutput);
}

// `cloudcli update` ran its npm command through execSync, i.e. the platform
// shell (cmd.exe on Windows); keep that rather than the web updater's `sh -c`.
function runPlatformShellCommand(
  command: string,
  workingDirectory: string,
  environment: NodeJS.ProcessEnv,
  onOutput: (output: string) => void,
  onErrorOutput: (errorOutput: string) => void,
): Promise<SystemUpdateCommandResult> {
  const childProcess = spawnInPlatformShell(command, {
    cwd: workingDirectory,
    env: environment,
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return collectCommandOutput(childProcess, onOutput, onErrorOutput);
}

function createUpdateHistory() {
  return createSystemUpdateHistoryService({
    dataDirectory: path.join(os.homedir(), '.cloudcli'),
    readTextFile: (filePath) => fs.readFileSync(filePath, 'utf8'),
    writeTextFile: (filePath, contents) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      // Write then rename so a crash never leaves half a record; logs hold
      // command output, so only their owner may read them.
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporaryPath, filePath);
    },
  });
}

// Adapters that let the update service record each update and check what an
// npm install put on disk, shared by the web updater and `cloudcli update`.
function createUpdateTrackingDependencies(
  appRoot: string,
  updateHistory: ReturnType<typeof createUpdateHistory>,
) {
  return {
    nodeVersion: process.version,
    updateHistory,
    readInstalledVersion: () => readInstalledPackageVersion(appRoot),
    checkInstalledPackage: () => checkInstalledPackage(appRoot, {
      // The Node (or Electron-as-Node) binary running now is the one the next
      // start uses, so its ABI is the one the installed modules must match.
      nodeExecutable: process.execPath,
      environment: process.env,
      timeoutMilliseconds: 60_000,
    }),
    now: () => new Date(),
  };
}

/**
 * Builds the authenticated system router for the server entrypoint using the
 * installation details it already resolves for health and startup metadata.
 */
export function createSystemModule(options: SystemModuleOptions): Router {
  const systemUpdateService = createSystemUpdateService({
    ...options,
    runningVersion: options.runningVersion ?? null,
    homeDirectory: os.homedir(),
    environment: process.env,
    runShellCommand,
    ...createUpdateTrackingDependencies(options.appRoot, createUpdateHistory()),
    logInfo: (message, detail) => console.log(message, detail ?? ''),
    logError: (message, detail) => console.error(message, detail ?? ''),
  });

  return createSystemRouter(systemUpdateService);
}

/**
 * Server entrypoint: records the version that just bound its port in
 * `~/.cloudcli/last-start.json`, so `cloudcli status` can name the last version
 * that actually started when a newer install never gets that far. Never throws.
 */
export function recordServerStart(details: {
  version: string | null;
  appRoot: string;
  installMode: 'git' | 'npm';
}): void {
  try {
    createUpdateHistory().recordServerStart({
      ...details,
      nodeVersion: process.version,
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[WARN] Could not record the server start:', error instanceof Error ? error.message : String(error));
  }
}

/**
 * CLI module: `cloudcli update` runs its npm command through the same recorded
 * and checked workflow as the web updater (streaming output to the terminal),
 * and `cloudcli status` reads what that workflow and the server recorded.
 */
export function createCliUpdateWorkflow(appRoot: string) {
  const updateHistory = createUpdateHistory();
  const runRecordedUpdate = createRecordedUpdateRunner({
    appRoot,
    homeDirectory: os.homedir(),
    installMode: fs.existsSync(path.join(appRoot, '.git')) ? 'git' : 'npm',
    isPlatform: false,
    runningVersion: null,
    environment: process.env,
    runShellCommand: runPlatformShellCommand,
    ...createUpdateTrackingDependencies(appRoot, updateHistory),
    logInfo: (message, detail) => console.log(message, detail ?? ''),
    logError: (message, detail) => console.error(message, detail ?? ''),
  });

  return {
    async runUpdate(command: string) {
      const { record } = await runRecordedUpdate({
        source: 'cli',
        command,
        workingDirectory: os.homedir(),
        onOutput: (output) => process.stdout.write(output),
        onErrorOutput: (errorOutput) => process.stderr.write(errorOutput),
      });
      return record;
    },
    readHistory: () => updateHistory.readHistory(),
  };
}
