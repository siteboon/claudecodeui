import {
  appendFilesInputTag,
  appendImagesInputTag,
} from '@/shared/image-attachments.js';
import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import { PiRpcClient } from '@/modules/providers/list/pi/pi-rpc.client.js';
import type { PiRpcExit, PiRpcRecord } from '@/modules/providers/list/pi/pi-rpc.client.js';
import type { NormalizedMessage, ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';
import { AppError, createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

/**
 * How long an aborted run gets to report `agent_settled` before its child is
 * signalled. An abort normally settles within milliseconds; the grace exists
 * for a tool that is slow to stop, and a run that has to be terminated is
 * reported as one that failed to stop.
 */
const ABORT_SETTLE_GRACE_MS = 8_000;

/** The extension UI methods that block the agent until a response arrives. */
const DIALOG_METHODS = new Set(['select', 'confirm', 'input', 'editor']);

/**
 * Options the pi runtime reads from one run call.
 *
 * `permissionMode` and `effort` are deliberately absent: pi has no permission
 * prompt and no reasoning-effort option that maps onto a run, so neither can
 * be forwarded. (A thinking level exists, but nothing sends it yet.)
 */
type PiRunOptions = {
  sessionId?: string | null;
  projectPath?: string;
  cwd?: string;
  model?: string | null;
  sessionSummary?: string;
  images?: unknown;
  files?: unknown;
};

/** Cumulative per-run usage counters pi attaches to its streaming events. */
type PiUsageCounters = {
  input?: number;
  output?: number;
  cacheRead?: number;
  totalTokens?: number;
  cost?: { total?: number };
};

/**
 * Mutable state of one live run, shared between the run function and the
 * abort entry point. Registered in the run table before the resume model
 * resolves, so an abort that lands in that window is not reported as "not
 * running" and cannot be followed by a spawn the caller never wanted.
 */
type PiRunState = {
  aborted: boolean;
  client: PiRpcClient | null;
  abortTimer: NodeJS.Timeout | null;
};

/** What the record handler needs from the run it belongs to. */
type PiRecordContext = {
  ws: ProviderRuntimeWriter;
  /** The app session id the caller supplied, when it supplied one. */
  sessionId: string | null;
  getCapturedSessionId(): string | null;
  setUsage(usage: PiUsageCounters): void;
  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[];
  respond(response: Record<string, unknown>): void;
  markSettled(): void;
};

const activeRuns = new Map<string, PiRunState>();

/**
 * The finishing promise of the latest run started per session key.
 *
 * Runs on one session take turns. `interruptActiveRun` aborts a run and
 * prompts again in the same breath, so the next `run` call can arrive while
 * the aborted child is still settling; two pi processes appending to one
 * session file would interleave their entries, so the newcomer waits.
 */
const sessionTurns = new Map<string, Promise<void>>();

/**
 * Builds the `pi --mode rpc` argument vector for one run.
 *
 * Verified against pi 1.6:
 * - `--mode rpc` keeps the process alive and reads commands from stdin;
 * - `--session` resumes a provider session by its full uuid;
 * - `--model` accepts a bare model id or a `provider/model` pair;
 * - there is no `--dir`/`--cwd` flag — the working directory is the spawn
 *   `cwd` option.
 *
 * Exported for the runtime tests only.
 */
export function buildPiArgs({
  providerSessionId,
  model,
}: {
  providerSessionId?: string | null;
  model?: string | null;
}): string[] {
  const args = ['--mode', 'rpc'];
  if (providerSessionId) {
    args.push('--session', providerSessionId);
  }
  if (model) {
    args.push('--model', model);
  }
  return args;
}

/**
 * Maps pi's cumulative usage counters onto the token-budget shape the chat
 * composer reads (`inputTokens`/`outputTokens`/`used`/`breakdown`, mirroring
 * the opencode runtime), keeping pi's own totals and cost as extra fields.
 *
 * pi reports cache reads separately; like opencode, they count as input.
 */
function readPiTokenBudget(usage: PiUsageCounters | null): {
  used: number;
  inputTokens: number;
  outputTokens: number;
  breakdown: { input: number; output: number };
  totalTokens: number;
  cost?: number;
} | null {
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const inputTokens = Number(usage.input || 0) + Number(usage.cacheRead || 0);
  const outputTokens = Number(usage.output || 0);
  const used = Number(usage.totalTokens || 0) || inputTokens + outputTokens;
  if (used <= 0) {
    return null;
  }

  return {
    used,
    inputTokens,
    outputTokens,
    breakdown: {
      input: inputTokens,
      output: outputTokens,
    },
    totalTokens: Number(usage.totalTokens || 0),
    cost: usage.cost && typeof usage.cost === 'object' ? usage.cost.total : undefined,
  };
}

/**
 * Handles one record `pi --mode rpc` wrote to stdout that is not the answer
 * to a command the run is waiting on: a session event, an extension UI
 * request, a late or unmatched response, or a line that is not JSON.
 *
 * Exported for the runtime tests only; the run passes a ctx bag because the
 * mutable state (captured session id, last usage) lives in the run closure.
 *
 * - Session events are mapped by `context.normalizeMessage`; the runtime
 *   never interprets their contents itself. The latest top-level `usage`
 *   wins, as the run's final accounting.
 * - `agent_settled` is what the run waits on. `agent_end` only closes one
 *   low-level run: retries, compaction recovery and queued messages can still
 *   follow it.
 * - An extension dialog (`select`/`confirm`/`input`/`editor`) blocks the
 *   agent until it is answered, and nothing in this app can answer it yet, so
 *   it is cancelled at once — the extension gets `undefined`/`false`, its
 *   fail-closed path — and the user is told why. Without this a run that
 *   reaches such a dialog would hang until aborted. Fire-and-forget UI
 *   records (`notify`, `setWidget`, ...) need no answer and are ignored.
 * - A `response` nobody awaits is either pi rejecting a malformed command or
 *   a late answer to a request that already timed out; only the rejection is
 *   worth a row.
 * - A non-JSON line is dropped. Stdout is reserved for protocol records; the
 *   usual source is an extension logging with `console.log`, and forwarding
 *   it into the transcript would pass a stray log line off as model output.
 */
export function handlePiRecord(record: PiRpcRecord, ctx: PiRecordContext): void {
  const sessionId = ctx.getCapturedSessionId() || ctx.sessionId || null;

  if (record.type === 'unparseable') {
    console.warn('[Pi] Ignored a non-protocol line on stdout:', String(record.line).slice(0, 200));
    return;
  }

  if (record.type === 'response') {
    if (record.success === false) {
      ctx.ws.send(createNormalizedMessage({
        kind: 'error',
        content: `pi: ${typeof record.error === 'string' ? record.error : 'unanswered command failed'}`,
        sessionId,
        provider: 'pi',
      }));
    }
    return;
  }

  if (record.type === 'extension_ui_request') {
    const method = typeof record.method === 'string' ? record.method : '';
    if (!DIALOG_METHODS.has(method) || typeof record.id !== 'string') {
      return;
    }
    ctx.respond({ type: 'extension_ui_response', id: record.id, cancelled: true });
    const title = typeof record.title === 'string' ? `: "${record.title}"` : '';
    ctx.ws.send(createNormalizedMessage({
      kind: 'error',
      content: `A pi extension asked for input (${method}${title}). The request was cancelled: interactive extension dialogs are not supported here yet.`,
      sessionId,
      provider: 'pi',
    }));
    return;
  }

  if (record.usage && typeof record.usage === 'object') {
    ctx.setUsage(record.usage as PiUsageCounters);
  }

  for (const message of ctx.normalizeMessage(record, sessionId)) {
    ctx.ws.send(message);
  }

  if (record.type === 'agent_settled') {
    ctx.markSettled();
  }
}

/** Reads one field out of an `AppError`'s details, when it is there. */
function readErrorDetail(error: unknown, key: string): unknown {
  if (!(error instanceof AppError) || !error.details || typeof error.details !== 'object') {
    return undefined;
  }
  return (error.details as Record<string, unknown>)[key];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runPiSession(
  command: string,
  options: PiRunOptions = {},
  ws: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
): Promise<void> {
  const {
    sessionId,
    projectPath,
    cwd,
    model,
    sessionSummary,
    images,
    files,
  } = options;
  // Callers pass the stable app session id; the CLI resumes with the
  // provider-native id recorded on the session row.
  const providerSessionId = context.resolveProviderSessionId(sessionId);
  const workingDir = cwd || projectPath || process.cwd();
  // Run-table key: the app session id when the caller supplied one, so
  // abort-by-app-id always works.
  const runKey = sessionId || `pi-${Date.now()}`;

  let capturedSessionId: string | null = providerSessionId;
  let sessionCreatedSent = false;
  let lastUsage: PiUsageCounters | null = null;
  let sawAgentSettled = false;
  let exitInfo: PiRpcExit | null = null;
  // Both flags above are set from the record handler and the exit listener,
  // which run between this function's awaits. They are read through these
  // accessors because TypeScript's control-flow analysis does not follow
  // assignments made inside callbacks and would otherwise narrow each
  // variable to its initial value at every later use.
  const hasSettled = (): boolean => sawAgentSettled;
  const readExit = (): PiRpcExit | null => exitInfo;
  // Unified lifecycle contract: exactly one terminal `complete` per run,
  // and none for an aborted run (the gateway sends that one).
  let completeSent = false;
  let notificationSent = false;

  const state: PiRunState = { aborted: false, client: null, abortTimer: null };
  let resolveSettled!: () => void;
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });

  const reportedSessionId = (): string => sessionId || capturedSessionId || runKey;

  const registerSession = (nextSessionId: string): void => {
    if (!nextSessionId || capturedSessionId === nextSessionId) {
      return;
    }

    capturedSessionId = nextSessionId;
    // Legacy/direct callers without an app session id can abort by the
    // provider-native id once it is known.
    if (!sessionId) {
      activeRuns.set(capturedSessionId, state);
    }
    if (ws.setSessionId) {
      ws.setSessionId(capturedSessionId);
    }

    // Contract: a brand-new provider session announces `session_created`
    // once, and the writer learns the id before any content event.
    if (!providerSessionId && !sessionCreatedSent) {
      sessionCreatedSent = true;
      ws.send(createNormalizedMessage({
        kind: 'session_created',
        newSessionId: capturedSessionId,
        sessionId: capturedSessionId,
        provider: 'pi',
      }));
    }
  };

  const sendComplete = (exitCode: number | null): void => {
    if (completeSent) {
      return;
    }
    completeSent = true;
    ws.send(createCompleteMessage({
      provider: 'pi',
      sessionId: reportedSessionId(),
      actualSessionId: capturedSessionId || null,
      exitCode,
    }));
  };

  const notifyStopped = (): void => {
    if (notificationSent) {
      return;
    }
    notificationSent = true;
    notifyRunStopped({
      userId: ws?.userId || null,
      provider: 'pi',
      sessionId: reportedSessionId(),
      sessionName: sessionSummary,
      stopReason: 'completed',
    });
  };

  const notifyFailed = (error: string): void => {
    if (notificationSent) {
      return;
    }
    notificationSent = true;
    notifyRunFailed({
      userId: ws?.userId || null,
      provider: 'pi',
      sessionId: reportedSessionId(),
      sessionName: sessionSummary,
      error,
    });
  };

  // Registered before the resume model resolves so abort can reach the run
  // in that window (see PiRunState).
  activeRuns.set(runKey, state);

  const previousTurn = sessionTurns.get(runKey) ?? Promise.resolve();
  let endTurn!: () => void;
  const turn = new Promise<void>((resolve) => {
    endTurn = resolve;
  });
  sessionTurns.set(runKey, turn);
  void turn.then(() => {
    if (sessionTurns.get(runKey) === turn) {
      sessionTurns.delete(runKey);
    }
  });

  try {
    const resolvedModel = await context.resolveResumeModel(sessionId ?? undefined, model);
    // Aborted while the model was still resolving: the gateway already sent
    // this run's terminal complete on the abort path, so spawn nothing and
    // stay silent.
    if (state.aborted) {
      return;
    }
    await previousTurn;
    if (state.aborted) {
      return;
    }

    // Attachment paths ride along as <images_input>/<files_input> blocks
    // appended to the prompt; the session history reader strips the tags
    // back out. Unlike the print-mode argv, the prompt travels as one JSON
    // record, so its line breaks survive on every platform.
    const prompt = appendFilesInputTag(
      appendImagesInputTag(command?.trim() || '', images),
      files,
    ).trim();

    const client = new PiRpcClient(buildPiArgs({ providerSessionId, model: resolvedModel }), {
      cwd: workingDir,
      env: process.env,
    });
    state.client = client;
    client.onRecord = (record) => handlePiRecord(record, {
      ws,
      sessionId: sessionId ?? null,
      getCapturedSessionId: () => capturedSessionId,
      setUsage: (usage) => {
        lastUsage = usage;
      },
      normalizeMessage: (raw, normalizedSessionId) => context.normalizeMessage(raw, normalizedSessionId),
      respond: (response) => client.respond(response),
      markSettled: () => {
        sawAgentSettled = true;
        resolveSettled();
      },
    });
    // A child that exits before `agent_settled` — a crash, a CLI error, a
    // forced kill — must still release the run. Whether that is a failure is
    // decided once the run has settled.
    void client.exited.then((exit) => {
      exitInfo = exit;
      resolveSettled();
    });

    // `get_state` names the session before anything streams, for a resumed
    // session as much as a fresh one: pi mints the id when it opens the
    // session, not when the first message is written. RPC mode has no
    // session header to read it from.
    const sessionState = await client.request('get_state');
    if (sessionState && typeof sessionState === 'object' && 'sessionId' in sessionState && typeof sessionState.sessionId === 'string' && sessionState.sessionId) {
      registerSession(sessionState.sessionId);
    }
    if (state.aborted) {
      return;
    }

    if (prompt) {
      const accepted = await client.request<{ disposition?: unknown }>('prompt', { message: prompt });
      // `handled` means an extension command consumed the prompt: no run
      // started, so no `agent_settled` will ever come.
      if (!accepted || accepted.disposition !== 'handled') {
        await settled;
      }
    }

    const tokenBudget = readPiTokenBudget(lastUsage);
    if (tokenBudget) {
      ws.send(createNormalizedMessage({
        kind: 'status',
        text: 'token_budget',
        tokenBudget,
        sessionId: reportedSessionId(),
        provider: 'pi',
      }));
    }

    if (state.aborted) {
      // The gateway sent this run's terminal complete at abort time and
      // sent no failure notification; an abort the user asked for is not a
      // failure. Only a child that had to be terminated is reported, so the
      // log shows the abort did not work as intended.
      if (hasSettled()) {
        return;
      }
      throw new AppError('pi did not report agent_settled after abort and was terminated.', {
        code: 'PI_ABORT_FORCED',
        details: { exit: readExit() },
      });
    }

    const exit = readExit();
    if (exit && !hasSettled()) {
      throw new AppError(
        `pi exited (code ${exit.code ?? 'null'}, signal ${exit.signal ?? 'null'}) before the run finished.${client.stderrTail.trim() ? ` Last stderr line: ${client.stderrTail.trim().split('\n').pop()}` : ''}`,
        { code: 'PI_RPC_CLOSED', details: { exitCode: exit.code } },
      );
    }

    sendComplete(0);
    notifyStopped();
  } catch (error) {
    if (state.aborted) {
      // An abort's consequences land here too: a command that was still
      // pending when the aborted child exited rejects with PI_RPC_CLOSED.
      // That is not a run failure, and the gateway already sent this run's
      // complete, so nothing is sent or notified. Only a child that was
      // started and then left without reporting agent_settled is passed up,
      // for the log: that is an abort that did not work as intended. A run
      // aborted before or without a child settles silently whatever else was
      // in flight, a failing model lookup included.
      if (!state.client || hasSettled()) {
        return;
      }
      throw error instanceof Error ? error : new Error(String(error));
    }

    const notInstalled = readErrorDetail(error, 'spawnCode') === 'ENOENT'
      && !(await context.isProviderInstalled());
    if (notInstalled) {
      const message = 'Pi CLI is not installed. Install it from https://pi.dev/';
      ws.send(createNormalizedMessage({ kind: 'error', content: message, sessionId: reportedSessionId(), provider: 'pi' }));
      sendComplete(1);
      notifyFailed(message);
      throw new AppError(message, { code: 'PROVIDER_NOT_INSTALLED' });
    }

    const errorContent = describeError(error);
    console.error('[Pi] Run failed:', errorContent);
    ws.send(createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: reportedSessionId(), provider: 'pi' }));
    const exitCode = readErrorDetail(error, 'exitCode');
    sendComplete(typeof exitCode === 'number' ? exitCode : 1);
    notifyFailed(errorContent);
    throw error;
  } finally {
    if (state.abortTimer) {
      clearTimeout(state.abortTimer);
    }
    const client = state.client;
    if (client) {
      // Bounded by the client: stdin EOF, then SIGTERM, then SIGKILL. Awaiting
      // it is what keeps the next run on this session from overlapping this
      // one's child (see sessionTurns).
      await client.end();
    }
    if (activeRuns.get(runKey) === state) {
      activeRuns.delete(runKey);
    }
    if (capturedSessionId && activeRuns.get(capturedSessionId) === state) {
      activeRuns.delete(capturedSessionId);
    }
    endTurn();
  }
}

/**
 * Aborts the run registered for `sessionId`.
 *
 * Returns at once: the gateway emits the run's terminal complete as soon as
 * this answers, so nothing here may wait for the agent to stop. The run
 * itself settles when pi reports `agent_settled`, or is terminated after
 * `ABORT_SETTLE_GRACE_MS`. Answers true for as long as the run is settling,
 * so a repeated abort is harmless; false only when no run is registered.
 *
 * Consumer: `piRuntime` (the provider registry) and the runtime tests.
 */
export function abortPiSession(sessionId: string): boolean {
  const state = activeRuns.get(sessionId);
  if (!state) {
    return false;
  }

  state.aborted = true;
  const client = state.client;
  if (!client) {
    // Still resolving the resume model: flagging the state is the whole
    // contract, since the run path checks the flag before it spawns.
    return true;
  }

  // Fire and forget. The answer comes once pi is idle, which may be a while
  // if a tool is slow to stop; the run does not depend on it.
  client.request('abort', {}, ABORT_SETTLE_GRACE_MS * 4).catch(() => {});
  if (state.abortTimer) {
    clearTimeout(state.abortTimer);
  }
  state.abortTimer = setTimeout(() => client.kill('SIGTERM'), ABORT_SETTLE_GRACE_MS);
  state.abortTimer.unref?.();
  return true;
}

/**
 * Whether a run is registered for `sessionId`, including one that is still
 * resolving its model or still settling after an abort.
 *
 * Consumer: the runtime tests.
 */
export function isPiSessionActive(sessionId: string): boolean {
  return activeRuns.has(sessionId);
}

/**
 * Live execution facet of the pi provider: starts a `pi --mode rpc` child per
 * run and stops it through the protocol.
 *
 * Consumer: `pi.provider.ts`, which registers it on the provider registry.
 */
export const piRuntime = {
  run: runPiSession,
  abort: abortPiSession,
};
