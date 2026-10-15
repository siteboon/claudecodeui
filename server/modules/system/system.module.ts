import os from 'node:os';

import spawn from 'cross-spawn';
import type { Router } from 'express';

import { getConnection, getDatabasePath } from '@/modules/database/index.js';
import { getGlobalImageAssetsDir } from '@/shared/image-attachments.js';

import { createSystemStorageService } from './system-storage.service.js';
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

/**
 * Builds the authenticated system router (update, storage locations, database
 * backup) for the server entrypoint using the installation details it already
 * resolves for health and startup metadata.
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

  const systemStorageService = createSystemStorageService({
    isPlatform: options.isPlatform,
    getDatabasePath,
    getAssetsPath: getGlobalImageAssetsDir,
    // better-sqlite3's online backup copies the shared connection page by page
    // across event-loop turns, so the server keeps serving while it runs.
    backupDatabase: (destinationPath) => getConnection().backup(destinationPath),
    temporaryDirectory: os.tmpdir(),
    now: () => new Date(),
  });

  return createSystemRouter({ systemUpdateService, systemStorageService });
}
