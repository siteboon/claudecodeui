import { spawn as spawnChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';
import type { Router } from 'express';

import { appConfigDb } from '@/modules/database/index.js';
import { IS_PLATFORM } from '@/shared/utils.js';

import { createKeepAwakeService } from './keep-awake.service.js';
import { createSystemRouter } from './system.routes.js';
import { createSystemUpdateService } from './system.service.js';

type SystemModuleOptions = {
  appRoot: string;
  installMode: 'git' | 'npm';
  isPlatform: boolean;
};

function runShellCommand(
  command: string,
  workingDirectory: string,
  environment: NodeJS.ProcessEnv,
  onOutput: (output: string) => void,
  onErrorOutput: (errorOutput: string) => void,
): Promise<{ exitCode: number | null; output: string; errorOutput: string }> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn('sh', ['-c', command], {
      cwd: workingDirectory,
      env: environment,
    });
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

/** app_config key holding the keep-awake setting as `{ "enabled": boolean }`. */
const KEEP_AWAKE_SETTINGS_KEY = 'keep_awake_settings';

function readKeepAwakeEnabled(): boolean {
  const raw = appConfigDb.get(KEEP_AWAKE_SETTINGS_KEY);
  if (!raw) {
    return false;
  }

  try {
    return (JSON.parse(raw) as { enabled?: unknown }).enabled === true;
  } catch {
    return false;
  }
}

/** Whether an executable named `command` is on this process's PATH. */
function isCommandOnPath(command: string): boolean {
  return (process.env.PATH ?? '').split(path.delimiter).some((directory) => {
    if (!directory) {
      return false;
    }
    try {
      fs.accessSync(path.join(directory, command), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Keeps this computer out of idle sleep while agents work, when the user opted in.
 *
 * Used by the providers module's runtime service, which holds it for the length
 * of every provider run, and by the server entrypoint, which loads the saved
 * setting at startup and releases the hold on shutdown.
 */
export const keepAwakeService = createKeepAwakeService({
  platform: process.platform,
  serverPid: process.pid,
  isPlatform: IS_PLATFORM,
  commandExists: isCommandOnPath,
  spawnProcess: (command, args, options) => spawnChildProcess(command, args, options),
  killProcessGroup: (pid) => {
    process.kill(-pid, 'SIGTERM');
  },
  readEnabled: readKeepAwakeEnabled,
  writeEnabled: (enabled) => appConfigDb.set(KEEP_AWAKE_SETTINGS_KEY, JSON.stringify({ enabled })),
  logInfo: (message) => console.log(message),
  logWarn: (message) => console.warn(message),
});

/**
 * Builds the authenticated system router for the server entrypoint using the
 * installation details it already resolves for health and startup metadata.
 */
export function createSystemModule(options: SystemModuleOptions): Router {
  const systemUpdateService = createSystemUpdateService({
    ...options,
    homeDirectory: os.homedir(),
    environment: process.env,
    runShellCommand,
    logInfo: (message, detail) => console.log(message, detail ?? ''),
    logError: (message, detail) => console.error(message, detail ?? ''),
  });

  return createSystemRouter(systemUpdateService, keepAwakeService);
}
