import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import spawn from 'cross-spawn';

import { AbstractProvider } from '@/modules/llm/providers/abstract.provider.js';
import type {
  MutableProviderSession,
  ProviderCapabilities,
  ProviderSessionEvent,
  ProviderSessionSnapshot,
  StartSessionInput,
} from '@/modules/llm/providers/provider.interface.js';
import { createStreamLineAccumulator } from '@/shared/platform/stream.js';
import type { LLMProvider } from '@/shared/types/app.js';

type CreateCliInvocationInput = StartSessionInput & {
  sessionId: string;
  isResume: boolean;
};

type CliInvocation = {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
};

const PROCESS_SHUTDOWN_GRACE_PERIOD_MS = 2_000;

/**
 * Base class for CLI-driven providers with streamed stdout/stderr parsing.
 */
export abstract class BaseCliProvider extends AbstractProvider {
  protected constructor(providerId: LLMProvider, capabilities: ProviderCapabilities) {
    super(providerId, 'cli', capabilities);
  }

  /**
   * Starts a new CLI session and begins process output streaming.
   */
  async launchSession(input: StartSessionInput): Promise<ProviderSessionSnapshot> {
    return this.startSessionInternal({
      ...input,
      sessionId: input.sessionId ?? randomUUID(),
      isResume: false,
    });
  }

  /**
   * Resumes an existing CLI session and begins process output streaming.
   */
  async resumeSession(input: StartSessionInput & { sessionId: string }): Promise<ProviderSessionSnapshot> {
    return this.startSessionInternal({
      ...input,
      isResume: true,
    });
  }

  /**
   * Implemented by concrete CLI providers to describe command invocation.
   */
  protected abstract createCliInvocation(input: CreateCliInvocationInput): CliInvocation;

  /**
   * Appends uploaded image paths to prompt text for CLI providers that only accept string prompts.
   */
  protected appendImagePathsToPrompt(prompt: string, imagePaths?: string[]): string {
    if (!imagePaths || imagePaths.length === 0) {
      return prompt;
    }

    return `${prompt}\n\n${JSON.stringify(imagePaths)}`;
  }

  /**
   * Maps one stdout/stderr line into either JSON or plain-text event shapes.
   */
  protected mapCliOutputLine(line: string, channel: 'stdout' | 'stderr'): ProviderSessionEvent {
    const parsedJson = this.tryParseJson(line);
    if (parsedJson !== null) {
      return {
        timestamp: new Date().toISOString(),
        channel: 'json',
        data: parsedJson,
      };
    }

    return {
      timestamp: new Date().toISOString(),
      channel,
      message: line,
    };
  }

  /**
   * Runs a one-off CLI command and returns full stdout text on success.
   */
  protected async runCommandForOutput(command: string, args: string[]): Promise<string> {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const closePromise = once(child, 'close');
    const errorPromise = once(child, 'error').then(([error]) => {
      throw error;
    });

    await Promise.race([closePromise, errorPromise]);

    if ((child.exitCode ?? 1) !== 0) {
      const message = stderr.trim() || `Command "${command}" failed with code ${child.exitCode}`;
      throw new Error(message);
    }

    return stdout;
  }

  /**
   * Boots one CLI child process and wires stream handlers to the session buffer.
   */
  private async startSessionInternal(input: CreateCliInvocationInput): Promise<ProviderSessionSnapshot> {
    const preferred = this.getSessionPreference(input.sessionId);
    const effectiveModel = input.model ?? preferred.model;
    const effectiveThinking = input.thinkingMode ?? preferred.thinkingMode;

    const session = this.createSessionRecord(input.sessionId, {
      model: effectiveModel,
      thinkingMode: effectiveThinking,
    });

    const invocation = this.createCliInvocation({
      ...input,
      model: effectiveModel,
      thinkingMode: effectiveThinking,
    });

    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd ?? input.workspacePath ?? process.cwd(),
      env: {
        ...process.env,
        ...invocation.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    const stop = async (): Promise<boolean> => this.terminateChildProcess(child);
    session.stop = stop;

    const stdoutAccumulator = createStreamLineAccumulator({ preserveEmptyLines: false });
    const stderrAccumulator = createStreamLineAccumulator({ preserveEmptyLines: false });

    child.stdout.on('data', (chunk) => {
      const lines = stdoutAccumulator.push(chunk);
      for (const line of lines) {
        const event = this.mapCliOutputLine(line, 'stdout');
        this.appendEvent(session, event);
      }
    });

    child.stderr.on('data', (chunk) => {
      const lines = stderrAccumulator.push(chunk);
      for (const line of lines) {
        const event = this.mapCliOutputLine(line, 'stderr');
        this.appendEvent(session, event);
      }
    });

    session.completion = this.waitForCliProcess(
      session,
      child,
      stdoutAccumulator,
      stderrAccumulator,
    );
    return this.toSnapshot(session);
  }

  /**
   * Waits for process completion/error and marks final session status.
   */
  private async waitForCliProcess(
    session: MutableProviderSession,
    child: ChildProcessWithoutNullStreams,
    stdoutAccumulator: { flush: () => string[] },
    stderrAccumulator: { flush: () => string[] },
  ): Promise<void> {
    const closePromise = once(child, 'close') as Promise<[number | null, NodeJS.Signals | null]>;
    const errorPromise = once(child, 'error') as Promise<[Error]>;
    const raceResult = await Promise.race([
      closePromise.then((result) => ({ type: 'close' as const, result })),
      errorPromise.then((result) => ({ type: 'error' as const, result })),
    ]);

    const pendingStdout = stdoutAccumulator.flush();
    const pendingStderr = stderrAccumulator.flush();

    for (const line of pendingStdout) {
      this.appendEvent(session, this.mapCliOutputLine(line, 'stdout'));
    }

    for (const line of pendingStderr) {
      this.appendEvent(session, this.mapCliOutputLine(line, 'stderr'));
    }

    if (raceResult.type === 'error') {
      const [error] = raceResult.result;
      const message = error.message || 'CLI process failed before start.';
      this.updateSessionStatus(session, 'failed', message);
      this.appendEvent(session, {
        timestamp: new Date().toISOString(),
        channel: 'error',
        message,
      });
      return;
    }

    const [code, signal] = raceResult.result;

    if (session.status === 'stopped') {
      this.appendEvent(session, {
        timestamp: new Date().toISOString(),
        channel: 'system',
        message: `Session stopped (${signal ?? 'SIGTERM'}).`,
      });
      return;
    }

    if (code === 0) {
      this.updateSessionStatus(session, 'completed');
      return;
    }

    const message = `CLI command exited with code ${code ?? 'null'}${signal ? ` (signal: ${signal})` : ''}`;
    this.updateSessionStatus(session, 'failed', message);
    this.appendEvent(session, {
      timestamp: new Date().toISOString(),
      channel: 'error',
      message,
    });
  }

  /**
   * Attempts graceful termination first, then force-kills when necessary.
   */
  private async terminateChildProcess(child: ChildProcessWithoutNullStreams): Promise<boolean> {
    if (child.killed || child.exitCode !== null) {
      return true;
    }

    try {
      child.kill('SIGTERM');
      await Promise.race([
        once(child, 'close'),
        new Promise((resolve) => setTimeout(resolve, PROCESS_SHUTDOWN_GRACE_PERIOD_MS)),
      ]);

      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Best-effort JSON parser for stream-json providers.
   */
  private tryParseJson(line: string): unknown | null {
    const trimmed = line.trim();
    if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
      return null;
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
}
