import os from 'node:os';

import spawn from 'cross-spawn';
import type { Router } from 'express';

import { createSystemRouter } from './system.routes.js';
import { createSystemUpdateService } from './system.service.js';

type SystemModuleOptions = {
  appRoot: string;
  installMode: 'git' | 'npm';
  isPlatform: boolean;
};

/**
 * Run a single command without involving a shell. Passing the executable and
 * each argument as separate `argv` entries prevents shell metacharacter
 * injection from any future caller that splices user-controlled values into
 * the command path or working directory. The previous implementation used
 * `sh -c <full command string>`, which would let a poisoned `$PATH`, a
 * hostile `appRoot`, or a future `homeDirectory` override execute arbitrary
 * code with the server process's privileges.
 */
function runShellCommand(
  command: string,
  args: string[],
  workingDirectory: string,
  environment: NodeJS.ProcessEnv,
  onOutput: (output: string) => void,
  onErrorOutput: (errorOutput: string) => void,
): Promise<{ exitCode: number | null; output: string; errorOutput: string }> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
      cwd: workingDirectory,
      env: environment,
      shell: false,
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

  return createSystemRouter(systemUpdateService);
}
