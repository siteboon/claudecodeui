import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  type CrewAIBridgeConfig,
  type CrewAIRunOptions,
  type CrewAIAgentOutput,
  validateCrewAIConfig,
  buildCrewAISpawnArgs,
  parseCrewAIOutput,
} from '@/services/crewai-bridge.service.js';

export type CrewAIRunCallbacks = {
  onAgentOutput: (output: CrewAIAgentOutput) => void;
  onCrewComplete: (outputs: CrewAIAgentOutput[], exitCode: number) => void;
  onCrewError: (error: string) => void;
};

export type CrewAIStartResult = {
  success: boolean;
  runId?: string;
  error?: string;
};

type MockChildProcess = {
  pid: number;
  stdout: { on: (event: string, cb: (data: Buffer) => void) => void };
  stderr: { on: (event: string, cb: (data: Buffer) => void) => void };
  on: (event: string, cb: (code: number) => void) => void;
  kill: () => boolean;
};

type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; env?: Record<string, string> },
) => MockChildProcess;

export type CrewAIRunnerOptions = {
  spawn?: SpawnFn;
};

type ActiveRun = {
  runId: string;
  process: MockChildProcess;
  stdoutBuffer: string;
};

export type CrewAIRunner = {
  startRun: (
    config: CrewAIBridgeConfig,
    options: CrewAIRunOptions,
    callbacks: CrewAIRunCallbacks,
  ) => Promise<CrewAIStartResult>;
  abortRun: (runId: string) => boolean;
  isRunActive: (runId: string) => boolean;
  getActiveRunIds: () => string[];
};

export function createCrewAIRunner(opts?: CrewAIRunnerOptions): CrewAIRunner {
  const activeRuns = new Map<string, ActiveRun>();

  const defaultSpawn: SpawnFn = (command, args, options) => {
    const { spawn } = require('node:child_process');
    return spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
    });
  };

  const spawnFn = opts?.spawn ?? defaultSpawn;

  function startRun(
    config: CrewAIBridgeConfig,
    options: CrewAIRunOptions,
    callbacks: CrewAIRunCallbacks,
  ): Promise<CrewAIStartResult> {
    const validation = validateCrewAIConfig(config);
    if (!validation.valid) {
      return Promise.resolve({ success: false, error: validation.error });
    }

    let spawnArgs;
    try {
      spawnArgs = buildCrewAISpawnArgs(options);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    const allowedRoot = path.resolve(process.env.CREWAI_PROJECTS_ROOT ?? process.cwd());
    const safeCwd = path.resolve(spawnArgs.cwd);
    if (safeCwd !== allowedRoot && !safeCwd.startsWith(allowedRoot + path.sep)) {
      return { success: false, error: 'Project path is outside the allowed root' };
    }

    const runId = randomUUID();
    const child = spawnFn(spawnArgs.command, spawnArgs.args, {
      cwd: safeCwd,
      env: spawnArgs.env,
    });

    const run: ActiveRun = { runId, process: child, stdoutBuffer: '' };
    activeRuns.set(runId, run);

    child.stdout.on('data', (data: Buffer) => {
      run.stdoutBuffer += data.toString();
    });

    child.stderr.on('data', () => {});

    child.on('close', (code: number) => {
      const outputs = parseCrewAIOutput(run.stdoutBuffer);

      for (const output of outputs) {
        callbacks.onAgentOutput(output);
      }

      activeRuns.delete(runId);

      if (code !== 0) {
        callbacks.onCrewError(`CrewAI process exited with exit code ${code}`);
      } else {
        callbacks.onCrewComplete(outputs, code);
      }
    });

    return Promise.resolve({ success: true, runId });
  }

  function abortRun(runId: string): boolean {
    const run = activeRuns.get(runId);
    if (!run) return false;
    run.process.kill();
    activeRuns.delete(runId);
    return true;
  }

  function isRunActive(runId: string): boolean {
    return activeRuns.has(runId);
  }

  function getActiveRunIds(): string[] {
    return Array.from(activeRuns.keys());
  }

  return { startRun, abortRun, isRunActive, getActiveRunIds };
}
