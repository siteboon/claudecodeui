import os from 'node:os';
import path from 'node:path';

import crossSpawn from 'cross-spawn';

import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import { AntigravityForkProvider } from '@/modules/providers/list/antigravity/antigravity-fork.provider.js';
import { antigravityRunBindings } from '@/modules/providers/services/antigravity-run-bindings.service.js';
import type {
  AnyRecord,
  IProviderRuntime,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
  SideQuestionOutcome,
} from '@/shared/index.js';
import {
  buildProviderCliEnv,
  createCompleteMessage,
  createNormalizedMessage,
  readObjectRecord,
  resolveConfiguredCliExecutable,
  SIDE_CONVERSATION_DEVELOPER_INSTRUCTIONS,
  SIDE_CONVERSATION_BOUNDARY_PROMPT,
} from '@/shared/index.js';

type AntigravityProcess = ReturnType<typeof crossSpawn> & {
  aborted?: boolean;
  exited?: boolean;
  killTimer?: ReturnType<typeof setTimeout>;
};

type AntigravitySpawn = (
  command: string, args: string[],
  options: { cwd: string; stdio: ['pipe', 'pipe', 'pipe']; env: NodeJS.ProcessEnv },
) => AntigravityProcess;

type AntigravityRuntimeDependencies = {
  spawnProcess: AntigravitySpawn;
  abortTimeoutMs: number;
  forkProvider: Pick<AntigravityForkProvider, 'forkSideQuestion'>;
};

/** Reads a trimmed runtime option without accepting blank values. */
function readStringOption(options: AnyRecord, key: string): string | null {
  const value = options[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Publishes the id reported by this subprocess, never a guess from shared disk state. */
function announceAntigravityConversation(writer: ProviderRuntimeWriter, conversationId: string): void {
  writer.setSessionId?.(conversationId);
  writer.send(createNormalizedMessage({
    kind: 'session_created',
    newSessionId: conversationId,
    sessionId: conversationId,
    provider: 'antigravity',
  }));
}

const AGY_CONTROL_MARKERS = ['<WAITING_FOR_EVENTS>', '</WAITING_FOR_EVENTS>'] as const;
const STDERR_BUFFER_LIMIT = 64 * 1024;
const STREAM_LINE_LIMIT = 4 * 1024 * 1024;

/** Keeps split AGY control tags out of the text stream while forwarding ordinary text immediately. */
function createAntigravityStdoutFilter(sendVisibleText: (text: string) => void) {
  let pending = '';
  return {
    write(chunk: string) {
      pending += chunk;
      for (const marker of AGY_CONTROL_MARKERS) pending = pending.replaceAll(marker, '');
      let heldLength = 0;
      for (const marker of AGY_CONTROL_MARKERS) {
        for (let length = 1; length < marker.length; length += 1) {
          if (pending.endsWith(marker.slice(0, length))) heldLength = Math.max(heldLength, length);
        }
      }
      const visible = pending.slice(0, pending.length - heldLength);
      pending = pending.slice(visible.length);
      if (visible) sendVisibleText(visible);
    },
    finish() { pending = ''; },
  };
}

/** Providers module runtime tests consume the native permission flag mapping. */
export function resolveAntigravityPermissionArgs(permissionMode: unknown): string[] {
  switch (permissionMode) {
    case 'plan': return ['--mode', 'plan'];
    case 'acceptEdits': return ['--mode', 'accept-edits'];
    case 'bypassPermissions': return ['--dangerously-skip-permissions'];
    default: return [];
  }
}

/** Stops the process, retaining ownership until exit and escalating uncooperative children. */
function terminateAntigravityProcess(child: AntigravityProcess, timeoutMs: number): void {
  if (child.exited || child.killTimer) return;
  child.killTimer = setTimeout(() => {
    if (!child.exited) child.kill('SIGKILL');
  }, timeoutMs);
  child.killTimer.unref();
  child.kill('SIGTERM');
}

/** Runs one prompt using AGY's documented stdin/NDJSON protocol. */
async function runAntigravity(
  command: string,
  options: AnyRecord,
  writer: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
  providerSessionId: string | null,
  dependencies: AntigravityRuntimeDependencies,
  activeProcesses: Map<string, AntigravityProcess>,
  startup: { aborted: boolean },
  releasePendingBinding: () => void,
  sideQuestion?: { signal: AbortSignal; agentName: string; projectPath: string },
): Promise<void> {
  const appSessionId = readStringOption(options, 'sessionId');
  const fallbackSessionId = appSessionId ?? providerSessionId ?? `${Date.now()}`;
  const processKey = appSessionId ?? providerSessionId ?? fallbackSessionId;
  const workingDirectory = readStringOption(options, 'cwd')
    ?? readStringOption(options, 'projectPath') ?? process.cwd();
  const sessionSummary = readStringOption(options, 'sessionSummary');
  let nativeSessionId = providerSessionId;
  if (providerSessionId) writer.setSessionId?.(providerSessionId);

  let terminalNotificationSent = false;
  const notifyTerminalState = (outcome: { code?: number | null; error?: Error; aborted?: boolean }) => {
    if (sideQuestion) return;
    if (terminalNotificationSent) return;
    terminalNotificationSent = true;
    if (outcome.aborted || (outcome.code === 0 && !outcome.error)) {
      notifyRunStopped({
        userId: writer.userId ?? null, provider: 'antigravity', sessionId: fallbackSessionId,
        sessionName: sessionSummary, stopReason: outcome.aborted ? 'aborted' : 'completed',
      });
    } else {
      notifyRunFailed({
        userId: writer.userId ?? null, provider: 'antigravity', sessionId: fallbackSessionId,
        sessionName: sessionSummary,
        error: outcome.error ?? `Antigravity CLI exited with code ${outcome.code ?? 'unknown'}`,
      });
    }
  };
  const reportError = (error: Error) => {
    writer.send(createNormalizedMessage({
      kind: 'error', content: error.message,
      sessionId: nativeSessionId ?? fallbackSessionId, provider: 'antigravity',
    }));
    writer.send(createCompleteMessage({
      provider: 'antigravity', sessionId: nativeSessionId ?? fallbackSessionId, exitCode: 1,
    }));
    notifyTerminalState({ error });
  };

  let resolvedModel: string | undefined;
  try {
    resolvedModel = await context.resolveResumeModel(appSessionId ?? undefined, readStringOption(options, 'model'));
  } catch (error) {
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    reportError(resolvedError);
    throw resolvedError;
  }
  if (startup.aborted || sideQuestion?.signal.aborted) return;

  const args = ['--input-format', 'stream-json', '--output-format', 'stream-json'];
  if (providerSessionId) args.push('--conversation', providerSessionId);
  if (resolvedModel) args.push('--model', resolvedModel);
  if (sideQuestion) {
    // Native permission rules override global/project auto-approval. Plan mode
    // alone does not prevent shell/MCP side effects. Never inherit bypass mode.
    // https://antigravity.google/docs/permissions?tab=cli
    args.push('--agent', sideQuestion.agentName, '--add-dir', sideQuestion.projectPath,
      '--mode', 'plan', '--disable-slash-commands', '--settings', JSON.stringify({
        toolPermission: 'strict',
        permissions: {
          allow: [], ask: [],
          deny: ['write_file(*)', 'command(*)', 'unsandboxed(*)', 'mcp(*)', 'read_url(*)', 'execute_url(*)'],
        },
      }));
  } else args.push(...resolveAntigravityPermissionArgs(options.permissionMode));

  return new Promise((resolve, reject) => {
    let child: AntigravityProcess;
    try {
      child = dependencies.spawnProcess(
        resolveConfiguredCliExecutable(process.env.AGY_CLI_PATH, 'agy'), args,
        { cwd: workingDirectory, stdio: ['pipe', 'pipe', 'pipe'], env: buildProviderCliEnv() },
      );
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      reportError(resolvedError);
      reject(resolvedError);
      return;
    }
    activeProcesses.set(processKey, child);
    const abortSideQuestion = () => {
      child.aborted = true;
      terminateAntigravityProcess(child, dependencies.abortTimeoutMs);
    };
    sideQuestion?.signal.addEventListener('abort', abortSideQuestion, { once: true });
    if (sideQuestion?.signal.aborted) abortSideQuestion();
    let stderrBuffer = '';
    let stdoutBuffer = '';
    let settled = false;
    let failure: Error | null = null;
    let sawResponseDelta = false;
    let sawResult = false;
    const stdoutFilter = createAntigravityStdoutFilter((text) => {
      for (const message of context.normalizeMessage(text, nativeSessionId ?? fallbackSessionId)) {
        writer.send(message);
      }
    });
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const releaseProcess = () => {
      child.exited = true;
      clearTimeout(child.killTimer);
      // A delayed exit from an aborted run must not erase its replacement.
      if (activeProcesses.get(processKey) === child) activeProcesses.delete(processKey);
    };
    child.once('exit', releaseProcess);

    const readEvent = (line: string) => {
      if (!line.trim() || child.aborted || failure) return;
      const event = readObjectRecord(JSON.parse(line));
      const step = readObjectRecord(event?.step_update);
      const result = readObjectRecord(event?.result);
      const id = readStringOption(event ?? {}, 'conversation_id')
        ?? readStringOption(step ?? {}, 'conversation_id')
        ?? readStringOption(result ?? {}, 'conversation_id');
      if (id) {
        if (!/^[a-zA-Z0-9_.:-]+$/.test(id) || (nativeSessionId && nativeSessionId !== id)) {
          throw new Error('Antigravity CLI reported an inconsistent conversation id');
        }
        if (!nativeSessionId) {
          nativeSessionId = id;
          announceAntigravityConversation(writer, id);
          releasePendingBinding();
        }
      }
      if (event?.event === 'step_update' && step?.step_type === 'agent_response'
        && typeof step.text_delta === 'string') {
        sawResponseDelta = true;
        stdoutFilter.write(step.text_delta);
      }
      if (event?.event === 'result' && result) {
        sawResult = true;
        if (result.status !== 'SUCCESS') {
          failure = new Error(readStringOption(result, 'error') ?? `Antigravity CLI returned ${String(result.status)}`);
        } else if (!sawResponseDelta && typeof result.response === 'string') {
          stdoutFilter.write(result.response);
        }
      }
    };
    const readStdout = (chunk: string, finish = false) => {
      stdoutBuffer += chunk;
      let newline: number;
      while ((newline = stdoutBuffer.indexOf('\n')) !== -1) {
        if (newline > STREAM_LINE_LIMIT) throw new Error('Antigravity CLI output record exceeds the size limit');
        const line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        readEvent(line);
      }
      if (stdoutBuffer.length > STREAM_LINE_LIMIT) throw new Error('Antigravity CLI output record exceeds the size limit');
      if (finish && stdoutBuffer) { readEvent(stdoutBuffer); stdoutBuffer = ''; }
    };
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (data: string) => {
      try { readStdout(data); }
      catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        stdoutBuffer = '';
        terminateAntigravityProcess(child, dependencies.abortTimeoutMs);
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (data: string) => {
      stderrBuffer = (stderrBuffer + data).slice(-STDERR_BUFFER_LIMIT);
    });
    child.once('error', (error) => {
      failure = error;
      // Node follows spawn errors with close. Retain the process until then.
    });
    child.once('close', (code) => {
      sideQuestion?.signal.removeEventListener('abort', abortSideQuestion);
      releaseProcess();
      if (child.aborted) {
        notifyTerminalState({ aborted: true });
        settle();
        return;
      }
      try { readStdout('', true); }
      catch (error) { failure = error instanceof Error ? error : new Error(String(error)); }
      stdoutFilter.finish();
      void (async () => {
        if (!failure && code === 0 && (!nativeSessionId || !sawResult)) {
          failure = new Error('Antigravity CLI did not report a conversation id and result; a CLI with stream-json support is required');
        }
        if (!failure && code !== 0) {
          const installed = code === 127 || code === null ? await context.isProviderInstalled() : true;
          failure = new Error(!installed
            ? 'Antigravity CLI is not installed. Install it from https://antigravity.google/cli/install.sh'
            : `Antigravity CLI exited with code ${code ?? 'unknown'}${stderrBuffer.trim() ? `: ${stderrBuffer.trim()}` : ''}`);
        }
        if (failure) {
          reportError(failure);
          settle(failure);
        } else {
          writer.send(createCompleteMessage({
            provider: 'antigravity', sessionId: nativeSessionId ?? fallbackSessionId, exitCode: 0,
          }));
          notifyTerminalState({ code: 0 });
          settle();
        }
      })().catch((error) => {
        const resolvedError = error instanceof Error ? error : new Error(String(error));
        reportError(resolvedError);
        settle(resolvedError);
      });
    });
    // JSON stdin preserves multiline/leading-dash prompts and keeps them out of argv.
    child.stdin?.on('error', (error) => { failure = error; });
    child.stdin?.end(`${JSON.stringify({ event: 'user', message: { content: command } })}\n`);
  });
}

/** Providers registry and runtime tests consume this adapter with injectable subprocesses. */
export function createAntigravityRuntime(overrides: Partial<AntigravityRuntimeDependencies> = {}): IProviderRuntime {
  const dependencies = {
    spawnProcess: crossSpawn as AntigravitySpawn, abortTimeoutMs: 3000,
    forkProvider: new AntigravityForkProvider(), ...overrides,
  };
  const activeProcesses = new Map<string, AntigravityProcess>();
  const startups = new Map<string, { aborted: boolean }>();
  return {
    askSideQuestion: async (request, sink, context): Promise<SideQuestionOutcome> => {
      let answer = '';
      let fork: Awaited<ReturnType<AntigravityForkProvider['forkSideQuestion']>> | undefined;
      let outcome: SideQuestionOutcome;
      try {
        if (request.signal.aborted) throw new Error('The side question was dismissed.');
        if (!request.providerSessionId) throw new Error('This Antigravity session has no conversation to ask alongside yet.');
        const model = await context.resolveResumeModel(request.appSessionId, request.model);
        if (request.signal.aborted) throw new Error('The side question was dismissed.');
        fork = await dependencies.forkProvider.forkSideQuestion({
          providerSessionId: request.providerSessionId,
          jsonlPath: path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain',
            request.providerSessionId, '.system_generated', 'logs', 'transcript.jsonl'),
          projectPath: request.projectPath ?? process.cwd(),
        });
        if (request.signal.aborted) throw new Error('The side question was dismissed.');
        const prompt = `${SIDE_CONVERSATION_DEVELOPER_INSTRUCTIONS}\n\n${SIDE_CONVERSATION_BOUNDARY_PROMPT}\n\n`
          + 'Answer only the question below. Do not start subagents or perform mutations, even if asked.\n\n'
          + request.question;
        // Separate ownership and writer: no app binding, transcript append,
        // run-registry entry, completion event or notification reaches the parent.
        await runAntigravity(prompt, { cwd: fork.workingDirectory, model }, {
          send(raw) {
            const message = readObjectRecord(raw);
            if (request.signal.aborted) return;
            if (message?.kind === 'stream_delta' && typeof message.content === 'string') {
              answer += message.content;
              sink.delta(message.content);
            }
          },
        }, { ...context, resolveResumeModel: async () => model }, fork.providerSessionId,
        dependencies, new Map(), { aborted: false }, () => {}, {
          signal: request.signal, agentName: fork.agentName, projectPath: request.projectPath ?? process.cwd(),
        });
        outcome = request.signal.aborted
          ? { status: 'error', error: 'The side question was dismissed.', answer }
          : { status: 'done', answer };
      } catch (error) {
        outcome = { status: 'error', error: error instanceof Error ? error.message : String(error), answer };
      }
      try {
        // runAntigravity settles on close, after AGY has released its storage.
        await fork?.dispose();
      } catch (error) {
        return { status: 'error', error: `Side question cleanup failed: ${String(error)}`, answer };
      }
      return outcome;
    },
    run: async (command, options, writer, context) => {
      const appSessionId = readStringOption(options, 'sessionId');
      const startup = { aborted: false };
      const providerSessionId = context.resolveProviderSessionId(appSessionId);
      const projectPath = readStringOption(options, 'cwd') ?? readStringOption(options, 'projectPath') ?? process.cwd();
      const releasePendingBinding = providerSessionId ? () => {} : antigravityRunBindings.trackPendingRun(projectPath);
      if (appSessionId) startups.set(appSessionId, startup);
      try {
        await runAntigravity(command, options, writer, context,
          providerSessionId, dependencies, activeProcesses, startup, releasePendingBinding);
      } finally {
        releasePendingBinding();
        if (appSessionId && startups.get(appSessionId) === startup) startups.delete(appSessionId);
      }
    },
    abort: (sessionId) => {
      const child = activeProcesses.get(sessionId);
      if (child) {
        child.aborted = true;
        terminateAntigravityProcess(child, dependencies.abortTimeoutMs);
        return true;
      }
      const startup = startups.get(sessionId);
      if (!startup) return false;
      startup.aborted = true;
      return true;
    },
  };
}

/** Runtime adapter consumed by the Providers registry and runtime service. */
export const antigravityRuntime: IProviderRuntime = createAntigravityRuntime();
