import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

import { AppError } from '@/shared/utils.js';

const execFileAsync = promisify(execFile);

const gatewayCommandParts = (process.env.HERMES_GATEWAY_COMMAND || '').trim().split(/\s+/).filter(Boolean);
const fallbackHermesCommand = (
  process.env.HERMES_COMMAND_PATH
  || process.env.HERMES_CLI_PATH
  || 'hermes'
).trim().split(/\s+/)[0] || 'hermes';
const HERMES_COMMAND = gatewayCommandParts[0] || fallbackHermesCommand;
const HERMES_BASE_ARGS = gatewayCommandParts.slice(1);

const MAX_LOG_LINES = 300;
const COMMAND_TIMEOUT_MS = 10_000;

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
};

export type HermesGatewayProfile = {
  name: string;
  current: boolean;
  model: string | null;
  gateway: string | null;
  alias: string | null;
  distribution: string | null;
};

export type HermesGatewayStatus = {
  installed: boolean;
  command: string;
  version: string | null;
  running: boolean;
  managedByCloudCLI: boolean;
  state: 'running' | 'stopped' | 'unknown';
  statusOutput: string;
  profiles: HermesGatewayProfile[];
  logs: string[];
  lastExit: {
    code: number | null;
    signal: NodeJS.Signals | null;
    at: string;
  } | null;
  commands: {
    setup: string;
    run: string;
  };
};

const removeAnsi = (value: string): string => value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');

const compactOutput = (result: CommandResult): string => (
  [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
);

const parseGatewayRunning = (output: string, managedByCloudCLI: boolean): boolean => {
  if (managedByCloudCLI) {
    return true;
  }

  const normalized = output.toLowerCase();
  if (/\b(not running|stopped|inactive|failed)\b/.test(normalized)) {
    return false;
  }

  return /\b(running|active)\b/.test(normalized);
};

const parseProfiles = (output: string): HermesGatewayProfile[] => {
  const profiles: HermesGatewayProfile[] = [];
  for (const rawLine of removeAnsi(output).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('Profile ') || /^[-─\s]+$/.test(line)) {
      continue;
    }

    const current = line.startsWith('◆');
    const cleaned = line.replace(/^[◆*]\s*/, '').trim();
    const columns = cleaned.split(/\s{2,}/).map((column) => column.trim());
    const [name, model, gateway, alias, distribution] = columns;
    if (!name || name.toLowerCase() === 'profile') {
      continue;
    }

    profiles.push({
      name,
      current,
      model: model && model !== '—' ? model : null,
      gateway: gateway && gateway !== '—' ? gateway : null,
      alias: alias && alias !== '—' ? alias : null,
      distribution: distribution && distribution !== '—' ? distribution : null,
    });
  }

  return profiles;
};

class HermesGatewayService {
  private gatewayProcess: ChildProcess | null = null;
  private readonly logs: string[] = [];
  private lastExit: HermesGatewayStatus['lastExit'] = null;

  async getStatus(): Promise<HermesGatewayStatus> {
    const versionResult = await this.runHermes(['--version'], { timeout: 5000 });
    const installed = versionResult.exitCode === 0;
    const version = installed ? compactOutput(versionResult).split(/\r?\n/)[0] || null : null;

    const statusResult = installed
      ? await this.runHermes(['gateway', 'status'], { timeout: COMMAND_TIMEOUT_MS })
      : { stdout: '', stderr: versionResult.error || 'Hermes is not installed.', exitCode: 1 };
    const profilesResult = installed
      ? await this.runHermes(['profile', 'list'], { timeout: COMMAND_TIMEOUT_MS })
      : { stdout: '', stderr: '', exitCode: 1 };

    const statusOutput = compactOutput(statusResult);
    const managedByCloudCLI = this.isManagedProcessRunning();
    const running = parseGatewayRunning(statusOutput, managedByCloudCLI);

    return {
      installed,
      command: this.commandPrefix().join(' '),
      version,
      running,
      managedByCloudCLI,
      state: running ? 'running' : statusOutput ? 'stopped' : 'unknown',
      statusOutput,
      profiles: parseProfiles(profilesResult.stdout),
      logs: this.getLogs(),
      lastExit: this.lastExit,
      commands: {
        setup: [...this.commandPrefix(), 'gateway', 'setup'].join(' '),
        run: [...this.commandPrefix(), 'gateway', 'run'].join(' '),
      },
    };
  }

  async start(): Promise<HermesGatewayStatus> {
    await this.assertInstalled();
    if (this.isManagedProcessRunning()) {
      return this.getStatus();
    }

    const currentStatus = await this.getStatus();
    if (currentStatus.running) {
      return currentStatus;
    }

    const args = [...HERMES_BASE_ARGS, 'gateway', 'run', '--accept-hooks'];
    this.appendLog(`[cloudcli] starting Hermes gateway: ${HERMES_COMMAND} ${args.join(' ')}`);
    this.lastExit = null;
    const child = spawn(HERMES_COMMAND, args, {
      env: {
        ...process.env,
        HERMES_ACCEPT_HOOKS: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.gatewayProcess = child;

    child.stdout?.on('data', (chunk) => this.appendLog(String(chunk)));
    child.stderr?.on('data', (chunk) => this.appendLog(String(chunk)));
    child.on('error', (error) => {
      this.appendLog(`[cloudcli] gateway process error: ${error.message}`);
    });
    child.on('exit', (code, signal) => {
      this.lastExit = {
        code,
        signal,
        at: new Date().toISOString(),
      };
      this.appendLog(`[cloudcli] gateway exited with code ${code ?? 'null'}${signal ? ` signal ${signal}` : ''}`);
      this.gatewayProcess = null;
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });

    if (!this.isManagedProcessRunning()) {
      throw new AppError('Hermes gateway exited before it could start.', {
        code: 'HERMES_GATEWAY_START_FAILED',
        statusCode: 500,
        details: {
          logs: this.getLogs().slice(-20),
          lastExit: this.lastExit,
        },
      });
    }

    return this.getStatus();
  }

  async stop(): Promise<HermesGatewayStatus> {
    if (this.isManagedProcessRunning() && this.gatewayProcess) {
      this.appendLog('[cloudcli] stopping managed Hermes gateway');
      await this.stopManagedProcess();
      return this.getStatus();
    }

    await this.runHermes(['gateway', 'stop'], { timeout: COMMAND_TIMEOUT_MS });
    return this.getStatus();
  }

  async restart(): Promise<HermesGatewayStatus> {
    if (this.isManagedProcessRunning()) {
      await this.stopManagedProcess();
    } else {
      await this.runHermes(['gateway', 'stop'], { timeout: COMMAND_TIMEOUT_MS });
    }

    return this.start();
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  private async assertInstalled(): Promise<void> {
    const result = await this.runHermes(['--version'], { timeout: 5000 });
    if (result.exitCode !== 0) {
      throw new AppError('Hermes is not installed or is not available on PATH.', {
        code: 'HERMES_NOT_INSTALLED',
        statusCode: 400,
        details: compactOutput(result),
      });
    }
  }

  private isManagedProcessRunning(): boolean {
    return Boolean(this.gatewayProcess && !this.gatewayProcess.killed && this.gatewayProcess.exitCode === null);
  }

  private async stopManagedProcess(): Promise<void> {
    const child = this.gatewayProcess;
    if (!child) {
      return;
    }

    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
    child.kill('SIGTERM');

    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        setTimeout(() => {
          if (this.gatewayProcess === child && this.isManagedProcessRunning()) {
            this.appendLog('[cloudcli] gateway did not stop after SIGTERM; sending SIGKILL');
            child.kill('SIGKILL');
          }
          resolve();
        }, 5000);
      }),
    ]);
  }

  private async runHermes(args: string[], options: { timeout: number }): Promise<CommandResult> {
    try {
      const result = await execFileAsync(HERMES_COMMAND, [...HERMES_BASE_ARGS, ...args], {
        timeout: options.timeout,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          HERMES_ACCEPT_HOOKS: '1',
        },
      });

      return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: 0,
      };
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string | null;
      };

      return {
        stdout: execError.stdout ?? '',
        stderr: execError.stderr ?? '',
        exitCode: typeof execError.code === 'number' ? execError.code : 1,
        error: execError.message,
      };
    }
  }

  private appendLog(chunk: string): void {
    const lines = removeAnsi(chunk)
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    if (lines.length === 0) {
      return;
    }

    this.logs.push(...lines.map((line) => `${new Date().toISOString()} ${line}`));
    if (this.logs.length > MAX_LOG_LINES) {
      this.logs.splice(0, this.logs.length - MAX_LOG_LINES);
    }
  }

  private commandPrefix(): string[] {
    return [HERMES_COMMAND, ...HERMES_BASE_ARGS];
  }
}

export const hermesGatewayService = new HermesGatewayService();
