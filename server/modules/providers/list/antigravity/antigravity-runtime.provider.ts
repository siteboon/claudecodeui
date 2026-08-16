import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import crossSpawn from 'cross-spawn';

import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
} from '@/shared/types.js';
import {
  buildProviderCliEnv,
  createCompleteMessage,
  createNormalizedMessage,
  flattenPromptForWindowsShell,
} from '@/shared/utils.js';

type AntigravityProcess = ReturnType<typeof crossSpawn> & {
  aborted?: boolean;
  sessionId?: string;
};

type ConversationDbFile = {
  id: string;
  mtimeMs: number;
};

type AntigravitySpawn = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    stdio: ['pipe', 'pipe', 'pipe'];
    env: NodeJS.ProcessEnv;
  },
) => AntigravityProcess;

type AntigravityRuntimeDependencies = {
  spawnProcess: AntigravitySpawn;
  readConversationDbFiles: () => Promise<ConversationDbFile[]>;
};

/** Reads a trimmed runtime option without accepting blank values. */
function readStringOption(options: AnyRecord, key: string): string | null {
  const value = options[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Resolves the provider-native conversation database directory. */
function getAntigravityConversationsDir(): string {
  return process.env.ANTIGRAVITY_CONVERSATIONS_DIR
    || path.join(os.homedir(), '.gemini', 'antigravity-cli', 'conversations');
}

/** Lists AGY conversation databases used to discover newly created sessions. */
async function readAntigravityConversationDbFiles(): Promise<ConversationDbFile[]> {
  try {
    const conversationsDir = getAntigravityConversationsDir();
    const entries = await readdir(conversationsDir, { withFileTypes: true });
    const dbFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.db'));

    return Promise.all(dbFiles.map(async (entry) => {
      const absolutePath = path.join(conversationsDir, entry.name);
      const fileStat = await stat(absolutePath);
      return {
        id: entry.name.slice(0, -'.db'.length),
        mtimeMs: fileStat.mtimeMs,
      };
    }));
  } catch {
    return [];
  }
}

/** Selects the newest conversation created by the current runtime invocation. */
async function findNewAntigravityConversationId(
  previousIds: Set<string>,
  startedAtMs: number,
  readConversationDbFiles: () => Promise<ConversationDbFile[]>,
): Promise<string | null> {
  const candidates = (await readConversationDbFiles())
    .filter((entry) => !previousIds.has(entry.id) && entry.mtimeMs >= startedAtMs - 1000)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.id ?? null;
}

/** Publishes a provider-native session id discovered after AGY starts. */
function announceAntigravityConversation(
  writer: ProviderRuntimeWriter,
  conversationId: string,
): void {
  writer.setSessionId?.(conversationId);
  writer.send(createNormalizedMessage({
    kind: 'session_created',
    newSessionId: conversationId,
    sessionId: conversationId,
    provider: 'antigravity',
  }));
}

/** Normalizes and forwards one incremental AGY output chunk. */
function sendAntigravityText(
  writer: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
  text: string,
  sessionId: string | null,
): void {
  for (const message of context.normalizeMessage(text, sessionId)) {
    writer.send(message);
  }
}

/**
 * Maps CloudCLI permission modes to the Antigravity CLI flags consumed by the
 * runtime adapter. Exported for the Providers module runtime tests.
 */
export function resolveAntigravityPermissionArgs(permissionMode: unknown): string[] {
  switch (permissionMode) {
    case 'plan':
      return ['--mode', 'plan'];
    case 'acceptEdits':
      return ['--mode', 'accept-edits'];
    case 'bypassPermissions':
      return ['--dangerously-skip-permissions'];
    default:
      return [];
  }
}

/** Runs one AGY prompt and owns its provider-specific process lifecycle. */
async function runAntigravity(
  command: string,
  options: AnyRecord,
  writer: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
  dependencies: AntigravityRuntimeDependencies,
  activeProcesses: Map<string, AntigravityProcess>,
): Promise<void> {
  const appSessionId = readStringOption(options, 'sessionId');
  const providerSessionId = context.resolveProviderSessionId(appSessionId);
  const fallbackSessionId = appSessionId ?? providerSessionId ?? `${Date.now()}`;
  const processKey = appSessionId ?? providerSessionId ?? fallbackSessionId;
  const workingDirectory = readStringOption(options, 'cwd')
    ?? readStringOption(options, 'projectPath')
    ?? process.cwd();
  const sessionSummary = readStringOption(options, 'sessionSummary');
  const requestedModel = readStringOption(options, 'model');
  const startedAtMs = Date.now();
  const previousConversationIds = new Set(
    (await dependencies.readConversationDbFiles()).map((entry) => entry.id),
  );

  if (providerSessionId) {
    writer.setSessionId?.(providerSessionId);
  }

  let terminalNotificationSent = false;
  const notifyTerminalState = (
    outcome: { code?: number | null; error?: Error | string | null; aborted?: boolean },
  ) => {
    if (terminalNotificationSent) {
      return;
    }

    terminalNotificationSent = true;
    if (outcome.aborted || (outcome.code === 0 && !outcome.error)) {
      notifyRunStopped({
        userId: writer.userId ?? null,
        provider: 'antigravity',
        sessionId: fallbackSessionId,
        sessionName: sessionSummary,
        stopReason: outcome.aborted ? 'aborted' : 'completed',
      });
      return;
    }

    notifyRunFailed({
      userId: writer.userId ?? null,
      provider: 'antigravity',
      sessionId: fallbackSessionId,
      sessionName: sessionSummary,
      error: outcome.error ?? `Antigravity CLI exited with code ${outcome.code ?? 'unknown'}`,
    });
  };

  let resolvedModel: string | undefined;
  try {
    resolvedModel = await context.resolveResumeModel(appSessionId ?? undefined, requestedModel);
  } catch (error) {
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    writer.send(createNormalizedMessage({
      kind: 'error',
      content: resolvedError.message,
      sessionId: providerSessionId ?? fallbackSessionId,
      provider: 'antigravity',
    }));
    writer.send(createCompleteMessage({
      provider: 'antigravity',
      sessionId: providerSessionId ?? fallbackSessionId,
      exitCode: 1,
    }));
    notifyTerminalState({ error: resolvedError });
    throw resolvedError;
  }

  const args: string[] = [];
  if (providerSessionId) {
    args.push('--conversation', providerSessionId);
  }
  if (resolvedModel) {
    args.push('--model', resolvedModel);
  }
  args.push(...resolveAntigravityPermissionArgs(options.permissionMode));
  args.push('--print', flattenPromptForWindowsShell(command.trim()));

  return new Promise((resolve, reject) => {
    const antigravityProcess = dependencies.spawnProcess('agy', args, {
      cwd: workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildProviderCliEnv(),
    }) as AntigravityProcess;
    let stderrBuffer = '';
    let settled = false;
    let completeSent = false;
    let spawnError: Error | null = null;

    const settle = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    activeProcesses.set(processKey, antigravityProcess);
    antigravityProcess.sessionId = processKey;
    antigravityProcess.stdin?.end();

    antigravityProcess.stdout?.on('data', (data: Buffer | string) => {
      const text = data.toString();
      if (text) {
        sendAntigravityText(
          writer,
          context,
          text,
          providerSessionId ?? fallbackSessionId,
        );
      }
    });

    antigravityProcess.stderr?.on('data', (data: Buffer | string) => {
      stderrBuffer += data.toString();
    });

    antigravityProcess.once('close', async (code) => {
      activeProcesses.delete(processKey);
      if (spawnError) {
        return;
      }

      const discoveredConversationId = providerSessionId
        ?? await findNewAntigravityConversationId(
          previousConversationIds,
          startedAtMs,
          dependencies.readConversationDbFiles,
        );
      const outputSessionId = discoveredConversationId ?? fallbackSessionId;
      if (!providerSessionId && discoveredConversationId) {
        announceAntigravityConversation(writer, discoveredConversationId);
      }

      if (stderrBuffer.trim()) {
        writer.send(createNormalizedMessage({
          kind: code === 0 ? 'stream_delta' : 'error',
          content: stderrBuffer,
          sessionId: outputSessionId,
          provider: 'antigravity',
        }));
      }

      if (antigravityProcess.aborted) {
        // The generic websocket abort handler owns the terminal aborted frame.
        notifyTerminalState({ aborted: true });
        settle();
        return;
      }

      if (!completeSent) {
        completeSent = true;
        writer.send(createCompleteMessage({
          provider: 'antigravity',
          sessionId: outputSessionId,
          exitCode: code,
        }));
      }

      if (code === 0) {
        notifyTerminalState({ code });
        settle();
        return;
      }

      if (code === 127 || code === null) {
        const installed = await context.isProviderInstalled();
        if (!installed) {
          writer.send(createNormalizedMessage({
            kind: 'error',
            content: 'Antigravity CLI is not installed. Install it from https://antigravity.google/cli/install.sh',
            sessionId: outputSessionId,
            provider: 'antigravity',
          }));
        }
      }

      const error = new Error(
        code === null
          ? 'Antigravity CLI process was terminated'
          : `Antigravity CLI exited with code ${code}${stderrBuffer.trim() ? `: ${stderrBuffer.trim()}` : ''}`,
      );
      notifyTerminalState({ code, error });
      settle(error);
    });

    antigravityProcess.once('error', async (error) => {
      spawnError = error;
      activeProcesses.delete(processKey);
      if (antigravityProcess.aborted) {
        notifyTerminalState({ aborted: true });
        settle();
        return;
      }

      const installed = await context.isProviderInstalled();
      const errorContent = !installed
        ? 'Antigravity CLI is not installed. Install it from https://antigravity.google/cli/install.sh'
        : error.message;

      writer.send(createNormalizedMessage({
        kind: 'error',
        content: errorContent,
        sessionId: providerSessionId ?? fallbackSessionId,
        provider: 'antigravity',
      }));
      if (!completeSent && !antigravityProcess.aborted) {
        completeSent = true;
        writer.send(createCompleteMessage({
          provider: 'antigravity',
          sessionId: providerSessionId ?? fallbackSessionId,
          exitCode: 1,
        }));
      }
      notifyTerminalState({ error });
      settle(error);
    });
  });
}

/** Terminates an active AGY process by application or provider session id. */
function abortAntigravitySession(
  sessionId: string,
  activeProcesses: Map<string, AntigravityProcess>,
): boolean {
  const activeProcess = activeProcesses.get(sessionId);
  if (!activeProcess) {
    return false;
  }

  activeProcess.aborted = true;
  activeProcess.kill('SIGTERM');
  activeProcesses.delete(sessionId);
  return true;
}

/**
 * Creates an Antigravity runtime adapter with injectable process and history
 * dependencies. The provider registry uses the defaults; Providers module
 * tests inject deterministic in-memory subprocesses.
 */
export function createAntigravityRuntime(
  overrides: Partial<AntigravityRuntimeDependencies> = {},
): IProviderRuntime {
  const dependencies: AntigravityRuntimeDependencies = {
    spawnProcess: crossSpawn as AntigravitySpawn,
    readConversationDbFiles: readAntigravityConversationDbFiles,
    ...overrides,
  };
  const activeProcesses = new Map<string, AntigravityProcess>();

  return {
    run: (command, options, writer, context) => (
      runAntigravity(command, options, writer, context, dependencies, activeProcesses)
    ),
    abort: (sessionId) => abortAntigravitySession(sessionId, activeProcesses),
  };
}

/** Runtime adapter consumed by the Providers registry and runtime service. */
export const antigravityRuntime: IProviderRuntime = createAntigravityRuntime();
