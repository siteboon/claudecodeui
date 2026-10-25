/**
 * OpenAI Codex Integration
 * ========================
 *
 * Runs Codex chat turns. It mirrors the Claude runtime adapter for consistency.
 *
 * Turns run over `codex app-server` (JSON-RPC, one child per running turn), so
 * a message sent while the agent works joins the running turn (`turn/steer`)
 * instead of waiting for it to end, and approval requests reach the user's
 * permission prompt. CLOUDCLI_CODEX_TRANSPORT=exec switches back to the
 * `@openai/codex-sdk` path (`codex exec`, one input per process, no steering).
 *
 * ## Usage
 *
 * - codexRuntime.run(command, options, writer, context) - Execute a streamed prompt
 * - codexRuntime.inject(sessionId, text, attachments) - Steer the running turn
 * - codexRuntime.abort(sessionId) - Cancel an active session
 */

import crypto from 'node:crypto';

import { Codex } from '@openai/codex-sdk';
import type { ModelReasoningEffort, Thread, ThreadOptions } from '@openai/codex-sdk';

import { openCodexAppServer } from '@/modules/providers/list/codex/codex-app-server.client.js';
import type { CodexAppServerConnection } from '@/modules/providers/list/codex/codex-app-server.client.js';
import {
  appendFilesInputTag,
  buildCodexInputItems,
  normalizeImageDescriptors,
  createCompleteMessage,
  createNormalizedMessage,
} from '@/shared/index.js';
import {
  createNotificationEvent,
  notifyRunFailed,
  notifyRunStopped,
  notifyUserIfEnabled,
} from '@/modules/notifications/index.js';
import type { AnyRecord, ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/index.js';
import type { ProviderPermissionDecision } from '@/shared/types.js';

// The notification helpers are JavaScript, so TypeScript reads their parameter
// types off the defaults (`null`). These are the shapes they actually take.
const notifyCodexUser = notifyUserIfEnabled as (input: { userId: unknown; event: unknown }) => void;
const createCodexNotificationEvent = createNotificationEvent as unknown as (input: AnyRecord) => AnyRecord;

type ActiveCodexSession = {
  status: 'running' | 'aborted' | 'completed';
  abortController: AbortController;
  startedAt: string;
  /** Exec path only. */
  thread?: Thread;
  codex?: Codex;
  /** App-server path only: hands the running turn another user message. */
  steer?: (text: string, images: unknown[], files: unknown[]) => Promise<boolean>;
};

const activeCodexSessions = new Map<string, ActiveCodexSession>();

// Codex CLI requires non-whitespace stdin even when --image arguments are
// present, so attachment-only turns need a small text instruction.
const CODEX_IMAGE_ONLY_PROMPT = 'Please analyze the attached image(s).';

/**
 * Item types whose in-flight updates are worth showing. These are the ones a
 * user waits on — a shell command's output, an MCP call, and the running plan.
 */
const PROGRESSIVE_CODEX_ITEM_TYPES = new Set(['command_execution', 'mcp_tool_call', 'todo_list']);

/** How long an approval prompt waits for an answer before it is declined. Same default as Claude's. */
const CODEX_APPROVAL_TIMEOUT_MS = parseInt(process.env.CODEX_TOOL_APPROVAL_TIMEOUT_MS || '', 10) || 55000;

/** Command output arrives in many small deltas; the row is refreshed at most this often. */
const COMMAND_OUTPUT_FLUSH_MS = 250;

/** How long an interrupted turn may take to report back before its child is killed. */
const INTERRUPT_GRACE_MS = 5000;

/** `thread/resume` replays a long thread from disk, so it gets more time than other requests. */
const THREAD_RESUME_TIMEOUT_MS = 120_000;

function readUsageNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractCodexTokenBudget(event: AnyRecord) {
  const info = event?.info || event?.payload?.info || event?.usage?.info;
  const usage = info?.total_token_usage || event?.usage?.total_token_usage || event?.usage;
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const inputTokens = readUsageNumber(usage.input_tokens);
  const outputTokens = readUsageNumber(usage.output_tokens);
  const used = readUsageNumber(usage.total_tokens) || inputTokens + outputTokens;

  return {
    used,
    total: readUsageNumber(info?.model_context_window || event?.usage?.model_context_window) || 200000,
    inputTokens,
    outputTokens,
    breakdown: {
      input: inputTokens,
      output: outputTokens,
    },
  };
}

/**
 * Transform Codex SDK event to WebSocket message format
 * @param {object} event - SDK event
 * @returns {object} - Transformed event for WebSocket
 */
function transformCodexEvent(event: AnyRecord): AnyRecord {
  // Map SDK event types to a consistent format
  switch (event.type) {
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      const item = event.item;
      if (!item) {
        return { type: event.type, item: null };
      }

      // `itemId` is the SDK's stable per-item id. Carrying it through means an
      // in-progress row and its later completion normalize to the same message
      // id, so the client updates one transcript entry instead of appending a
      // new one for every progress tick.
      switch (item.type) {
        case 'agent_message':
          return {
            type: 'item',
            itemType: 'agent_message',
            itemId: item.id,
            message: {
              role: 'assistant',
              content: item.text
            }
          };

        case 'reasoning':
          return {
            type: 'item',
            itemType: 'reasoning',
            itemId: item.id,
            message: {
              role: 'assistant',
              content: item.text,
              isReasoning: true
            }
          };

        case 'command_execution':
          return {
            type: 'item',
            itemType: 'command_execution',
            itemId: item.id,
            command: item.command,
            output: item.aggregated_output,
            exitCode: item.exit_code,
            status: item.status
          };

        case 'file_change':
          return {
            type: 'item',
            itemType: 'file_change',
            itemId: item.id,
            changes: item.changes,
            status: item.status
          };

        case 'mcp_tool_call':
          return {
            type: 'item',
            itemType: 'mcp_tool_call',
            itemId: item.id,
            server: item.server,
            tool: item.tool,
            arguments: item.arguments,
            result: item.result,
            error: item.error,
            status: item.status
          };

        case 'web_search':
          return {
            type: 'item',
            itemType: 'web_search',
            itemId: item.id,
            query: item.query
          };

        case 'todo_list':
          return {
            type: 'item',
            itemType: 'todo_list',
            itemId: item.id,
            items: item.items
          };

        case 'error':
          return {
            type: 'item',
            itemType: 'error',
            itemId: item.id,
            message: {
              role: 'error',
              content: item.message
            }
          };

        default:
          return {
            type: 'item',
            itemType: item.type,
            itemId: item.id,
            item: item
          };
      }

    case 'turn.started':
      return {
        type: 'turn_started'
      };

    case 'turn.completed':
      return {
        type: 'turn_complete',
        usage: event.usage
      };

    case 'turn.failed':
      return {
        type: 'turn_failed',
        error: event.error
      };

    case 'thread.started':
      return {
        type: 'thread_started',
        threadId: event.thread_id || event.id
      };

    case 'error':
      return {
        type: 'error',
        message: event.message
      };

    default:
      return {
        type: event.type,
        data: event
      };
  }
}

/**
 * Map permission mode to Codex SDK options
 * @param {string} permissionMode - 'default', 'acceptEdits', or 'bypassPermissions'
 * @returns {object} - { sandboxMode, approvalPolicy }
 */
function mapPermissionModeToCodexOptions(permissionMode: string): Pick<ThreadOptions, 'sandboxMode' | 'approvalPolicy'> {
  switch (permissionMode) {
    case 'acceptEdits':
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never'
      };
    case 'bypassPermissions':
      return {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never'
      };
    case 'default':
    default:
      return {
        sandboxMode: 'workspace-write',
        // Current Codex CLI versions reject the retired `untrusted` policy.
        // Keep sandboxing enabled; exec cannot grant interactive approval requests.
        approvalPolicy: 'on-request'
      };
  }
}

/**
 * Forwards one run's Codex events to the client. Both transports produce
 * SDK-shaped events (`item.started`, `turn.completed`, …), so the filtering,
 * normalizing, failure notification and token budget live here once.
 */
function createCodexRunReporter(input: {
  ws: ProviderRuntimeWriter;
  context: ProviderRuntimeContext;
  sessionSummary: any;
  /** Id carried on client messages: the provider thread id once known. */
  messageSessionId: () => any;
  /** Id carried on notifications, which are app-facing. */
  appSessionId: () => any;
}) {
  const { ws, context, sessionSummary } = input;
  let terminalFailure: { message: string } | null = null;
  // Codex surfaces API failures as streamed error items/turn.failed events,
  // and the exec path then also throws "Codex Exec exited with code N:
  // <stderr>" once the process dies. Showing both means the rendered error is
  // followed by a raw stderr dump of unrelated CLI log lines, so the thrown
  // wrapper is dropped when the stream already reported the failure.
  let errorSurfaced = false;

  return {
    get terminalFailure() {
      return terminalFailure;
    },
    get errorSurfaced() {
      return errorSurfaced;
    },

    forward(event: AnyRecord) {
      // Progress events used to be dropped, so a long shell command or a
      // growing plan showed nothing until it finished. They are forwarded now;
      // every item carries a stable id, so the client replaces the row it
      // already has rather than stacking a new one per tick. Text items are
      // still skipped mid-flight and shown whole when they complete.
      if (
        (event.type === 'item.started' || event.type === 'item.updated')
        && !PROGRESSIVE_CODEX_ITEM_TYPES.has(event.item?.type)
      ) {
        return;
      }

      const transformed = transformCodexEvent(event);
      if (transformed.type === 'error' || transformed.itemType === 'error') {
        errorSurfaced = true;
      }

      // Normalize the transformed event into NormalizedMessage(s) via adapter
      const normalizedMsgs = context.normalizeMessage(transformed, input.messageSessionId());
      for (const msg of normalizedMsgs) {
        sendMessage(ws, msg);
      }

      if (event.type === 'turn.failed' && !terminalFailure) {
        terminalFailure = event.error || new Error('Turn failed');
        errorSurfaced = true;
        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: input.appSessionId(),
          sessionName: sessionSummary,
          error: terminalFailure
        });
      }

      // Extract and send token usage if available (normalized to match Claude format)
      if (event.type === 'turn.completed') {
        const tokenBudget = extractCodexTokenBudget(event);
        if (tokenBudget) {
          sendMessage(ws, createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget, sessionId: input.messageSessionId(), provider: 'codex' }));
        }
      }
    },
  };
}

/** Builds the turn input: text with the files tag, plus local images, as the SDK did for `codex exec`. */
function buildTurnInput(command: string, images: unknown, files: unknown, workingDirectory: string) {
  const promptWithFiles = appendFilesInputTag(command, files);
  const normalizedImages = normalizeImageDescriptors(images);
  const promptWithImageFallback = !promptWithFiles.trim() && normalizedImages.length > 0
    ? CODEX_IMAGE_ONLY_PROMPT
    : promptWithFiles;
  return normalizedImages.length > 0
    ? buildCodexInputItems(promptWithImageFallback, normalizedImages, workingDirectory)
    : promptWithFiles;
}

/** Resolves model, effort and permission settings for a run; shared by both transports. */
async function resolveCodexRunSettings(options: AnyRecord, context: ProviderRuntimeContext) {
  const { sessionId, cwd, projectPath, model, effort, permissionMode = 'default' } = options;

  // Callers pass the stable app session id; Codex resumes threads with the
  // provider-native id recorded on the session row.
  const providerSessionId = context.resolveProviderSessionId(sessionId);
  const resolvedModel = await context.resolveResumeModel(sessionId, model);
  const workingDirectory: string = cwd || projectPath || process.cwd();
  const { sandboxMode, approvalPolicy } = mapPermissionModeToCodexOptions(permissionMode);
  const catalog = await context.getProviderModels();
  const selectedModel = catalog.OPTIONS.find((option) => option.value === resolvedModel) || null;
  const allowedEfforts = selectedModel?.effort?.values?.map((value) => value.value) || [];
  const resolvedEffort = typeof effort === 'string' && effort !== 'default' && allowedEfforts.includes(effort)
    ? effort as ModelReasoningEffort
    : undefined;

  return { providerSessionId, resolvedModel, workingDirectory, sandboxMode, approvalPolicy, resolvedEffort };
}

/**
 * Runs one turn through `@openai/codex-sdk` (`codex exec`): the fallback
 * transport, used when CLOUDCLI_CODEX_TRANSPORT=exec. It takes one input per
 * process, so it cannot be steered.
 */
async function queryCodexExec(
  command: string,
  options: AnyRecord = {},
  ws: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
) {
  const { sessionId, sessionSummary, images, files } = options;
  const {
    providerSessionId,
    resolvedModel,
    workingDirectory,
    sandboxMode,
    approvalPolicy,
    resolvedEffort,
  } = await resolveCodexRunSettings(options, context);

  let codex: Codex;
  let thread: Thread;
  // Provider-native thread id (starts as the resume id, or is captured from
  // the stream for brand-new sessions).
  let capturedSessionId = providerSessionId;
  let sessionCreatedSent = false;
  const abortController = new AbortController();
  // Session-map key: the app session id when the caller supplied one, else
  // the provider-native thread id once captured (legacy/direct API callers).
  const sessionKey = () => sessionId || capturedSessionId || null;
  const reporter = createCodexRunReporter({
    ws,
    context,
    sessionSummary,
    messageSessionId: () => capturedSessionId || sessionId || null,
    appSessionId: () => sessionId || capturedSessionId || null,
  });

  try {
    codex = new Codex();

    const threadOptions: ThreadOptions = {
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode,
      approvalPolicy,
      model: resolvedModel,
      modelReasoningEffort: resolvedEffort,
    };

    if (providerSessionId) {
      thread = codex.resumeThread(providerSessionId, threadOptions);
    } else {
      thread = codex.startThread(threadOptions);
    }

    const registerSession = (id: string | null) => {
      if (!id) {
        return;
      }
      activeCodexSessions.set(id, {
        thread,
        codex,
        status: 'running',
        abortController,
        startedAt: new Date().toISOString()
      });
    };

    if (sessionKey()) {
      registerSession(sessionKey());
    }

    // Execute with streaming. Turns with image attachments send structured
    // input items so Codex reads the images from their local asset paths.
    const turnInput = buildTurnInput(command, images, files, workingDirectory);
    const streamedTurn = await thread.runStreamed(turnInput, {
      signal: abortController.signal
    });

    for await (const event of streamedTurn.events) {
      // Capture thread/session id lazily from the stream (Codex emits this asynchronously).
      if (event.type === 'thread.started') {
        const discoveredSessionId = event.thread_id || null;
        if (discoveredSessionId && !capturedSessionId) {
          capturedSessionId = discoveredSessionId;
          registerSession(sessionKey());

          if (ws.setSessionId && typeof ws.setSessionId === 'function') {
            ws.setSessionId(capturedSessionId);
          }

          if (!providerSessionId && !sessionCreatedSent) {
            sessionCreatedSent = true;
            sendMessage(ws, createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'codex' }));
          }
        }
      }

      // Check if session was aborted
      if (abortController.signal.aborted) {
        break;
      }
      if (sessionKey()) {
        const session = activeCodexSessions.get(sessionKey() || '');
        if (session?.status === 'aborted') {
          break;
        }
      }

      reporter.forward(event as AnyRecord);
    }

    // Send the terminal completion event — skipped for aborted runs, whose
    // terminal `complete` (aborted: true) was already sent by abort-session.
    const runSession = activeCodexSessions.get(sessionKey() || '');
    const runAborted = runSession?.status === 'aborted' || abortController.signal.aborted;
    if (!runAborted) {
      sendMessage(ws, createCompleteMessage({
        provider: 'codex',
        sessionId: capturedSessionId || sessionId || null,
        actualSessionId: capturedSessionId || thread.id || sessionId || null,
        exitCode: reporter.terminalFailure ? 1 : 0,
      }));
      if (!reporter.terminalFailure) {
        notifyRunStopped({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: sessionId || capturedSessionId || null,
          sessionName: sessionSummary,
          stopReason: 'completed'
        });
      }
    }

  } catch (error) {
    const session = activeCodexSessions.get(sessionKey() || '');
    const runError = error instanceof Error ? error : new Error(String(error));
    const wasAborted =
      session?.status === 'aborted' ||
      runError.name === 'AbortError' ||
      runError.message.toLowerCase().includes('aborted');

    if (!wasAborted) {
      await reportRunError(error, { ws, context, reporter, sessionId, capturedSessionId, sessionSummary });
    }

  } finally {
    // Update session status
    if (sessionKey()) {
      const session = activeCodexSessions.get(sessionKey() || '');
      if (session) {
        session.status = session.status === 'aborted' ? 'aborted' : 'completed';
      }
    }
  }
}

/** Shows a run that threw: the error (unless the stream already did), the failed `complete`, and the failure notification. */
async function reportRunError(
  error: unknown,
  run: {
    ws: ProviderRuntimeWriter;
    context: ProviderRuntimeContext;
    reporter: ReturnType<typeof createCodexRunReporter>;
    sessionId: string | undefined;
    capturedSessionId: any;
    sessionSummary: any;
  },
) {
  const { ws, context, reporter, sessionId, capturedSessionId, sessionSummary } = run;
  const runError = error instanceof Error ? error : new Error(String(error));
  console.error('[Codex] Error:', error);

  if (!reporter.errorSurfaced) {
    // Check if the Codex CLI is available for a clearer error message
    const installed = await context.isProviderInstalled();
    const errorContent = !installed
      ? 'Codex CLI is not configured. Please set up authentication first.'
      : runError.message;

    sendMessage(ws, createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'codex' }));
  }
  sendMessage(ws, createCompleteMessage({
    provider: 'codex',
    sessionId: capturedSessionId || sessionId || null,
    exitCode: 1,
  }));
  if (!reporter.terminalFailure) {
    notifyRunFailed({
      userId: ws?.userId || null,
      provider: 'codex',
      sessionId: sessionId || capturedSessionId || null,
      sessionName: sessionSummary,
      error
    });
  }
}

/** App-server statuses are camelCase; the SDK's (and the client's) are snake_case. */
function toSdkStatus(status: unknown): string | undefined {
  switch (status) {
    case 'inProgress':
      return 'in_progress';
    case 'declined':
      // A declined command or patch never ran; the client draws it as failed.
      return 'failed';
    default:
      return typeof status === 'string' ? status : undefined;
  }
}

function joinTextParts(parts: unknown): string {
  return Array.isArray(parts) ? parts.filter((part) => typeof part === 'string' && part.trim()).join('\n\n') : '';
}

/**
 * Maps an app-server `ThreadItem` onto the item shape `codex exec` emits, so
 * one event path (transformCodexEvent → normalizeMessage) serves both
 * transports and the client sees no difference. Returns null for items the
 * transcript does not draw live: user messages (the client shows its own,
 * steered ones included), hook prompts, compaction markers, empty reasoning.
 */
function toSdkThreadItem(item: AnyRecord | null | undefined): AnyRecord | null {
  if (!item || typeof item.type !== 'string') {
    return null;
  }

  switch (item.type) {
    case 'userMessage':
    case 'hookPrompt':
    case 'contextCompaction':
      return null;

    case 'agentMessage':
      return { id: item.id, type: 'agent_message', text: item.text ?? '' };

    case 'plan':
      // Plan mode's proposed plan: the client turns this tag into a plan card.
      return { id: item.id, type: 'agent_message', text: `<proposed_plan>\n${item.text ?? ''}\n</proposed_plan>` };

    case 'reasoning': {
      const text = joinTextParts(item.summary) || joinTextParts(item.content);
      return text ? { id: item.id, type: 'reasoning', text } : null;
    }

    case 'commandExecution':
      return {
        id: item.id,
        type: 'command_execution',
        command: item.command,
        aggregated_output: item.aggregatedOutput ?? '',
        exit_code: item.exitCode ?? undefined,
        status: toSdkStatus(item.status),
      };

    case 'fileChange':
      return {
        id: item.id,
        type: 'file_change',
        changes: (Array.isArray(item.changes) ? item.changes : []).map((change: AnyRecord) => ({
          path: change?.path,
          kind: change?.kind?.type ?? 'update',
        })),
        status: toSdkStatus(item.status),
      };

    case 'mcpToolCall':
      return {
        id: item.id,
        type: 'mcp_tool_call',
        server: item.server,
        tool: item.tool,
        arguments: item.arguments,
        result: item.result
          ? { content: item.result.content, structured_content: item.result.structuredContent }
          : undefined,
        error: item.error ?? undefined,
        status: toSdkStatus(item.status),
      };

    case 'webSearch':
      return { id: item.id, type: 'web_search', query: item.query ?? '' };

    default: {
      // Anything newer (sub-agent calls, image views, …) is passed through
      // whole; the client draws it as a generic tool row, as it did before.
      return { ...item };
    }
  }
}

/** The SDK-shaped `turn.completed` usage, built from the thread's last token report. */
function toSdkTurnUsage(tokenUsage: AnyRecord | null) {
  const last = tokenUsage?.last;
  if (!last) {
    return {};
  }
  return {
    usage: {
      input_tokens: readUsageNumber(last.inputTokens),
      cached_input_tokens: readUsageNumber(last.cachedInputTokens),
      output_tokens: readUsageNumber(last.outputTokens),
      reasoning_output_tokens: readUsageNumber(last.reasoningOutputTokens),
    },
    // The context in use is what the last model call read and wrote, which is
    // also what the Codex terminal shows as context used.
    info: {
      total_token_usage: {
        input_tokens: readUsageNumber(last.inputTokens),
        output_tokens: readUsageNumber(last.outputTokens),
        total_tokens: readUsageNumber(last.totalTokens),
      },
      model_context_window: tokenUsage?.modelContextWindow ?? undefined,
    },
  };
}

/** Turn input in app-server form: the same items the SDK built, with app-server field names. */
function toAppServerInput(command: string, images: unknown, files: unknown, workingDirectory: string) {
  const input = buildTurnInput(command, images, files, workingDirectory);
  const items = typeof input === 'string' ? [{ type: 'text' as const, text: input }] : input;
  return items.map((item) => (item.type === 'text'
    ? { type: 'text', text: item.text, text_elements: [] }
    : { type: 'localImage', path: item.path }));
}

type CodexApprovalAnswer = 'allow' | 'allow_session' | 'deny' | 'cancel';

type PendingCodexApproval = {
  answer: (decision: ProviderPermissionDecision) => void;
  /** Ends the prompt without an answer: the turn ended, or the server withdrew it. */
  withdraw: (reason: string) => void;
  sessionId: string | null;
  runId: string;
  rpcRequestId: number | string;
  toolName: string;
  input: unknown;
  receivedAt: Date;
};

const pendingCodexApprovals = new Map<string, PendingCodexApproval>();

function resolveCodexApproval(requestId: string, decision: ProviderPermissionDecision) {
  pendingCodexApprovals.get(requestId)?.answer(decision);
}

function listPendingCodexApprovals(sessionId: string) {
  return [...pendingCodexApprovals.entries()]
    .filter(([, entry]) => entry.sessionId === sessionId)
    .map(([requestId, entry]) => ({
      requestId,
      toolName: entry.toolName,
      input: entry.input,
      context: { provider: 'codex' },
      sessionId,
      receivedAt: entry.receivedAt,
    }));
}

/**
 * Runs one turn over `codex app-server`.
 *
 * The child lives exactly as long as the turn: `thread/start` (or
 * `thread/resume`) → `turn/start` → notifications until `turn/completed`.
 * While it runs, "Send now" is `turn/steer` against that turn and Stop is
 * `turn/interrupt`.
 */
async function queryCodexAppServer(
  command: string,
  options: AnyRecord = {},
  ws: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
) {
  const { sessionId, sessionSummary, images, files } = options;
  const runId = crypto.randomUUID();
  const abortController = new AbortController();
  let capturedSessionId: string | null = null;
  const sessionKey = () => sessionId || capturedSessionId || null;
  const reporter = createCodexRunReporter({
    ws,
    context,
    sessionSummary,
    messageSessionId: () => capturedSessionId || sessionId || null,
    appSessionId: () => sessionId || capturedSessionId || null,
  });

  let connection: CodexAppServerConnection | null = null;
  let threadId: string | null = null;
  let turnId: string | null = null;
  let turnOpen = false;
  let lastTokenUsage: AnyRecord | null = null;
  // Command rows are refreshed from their output deltas, at most every
  // COMMAND_OUTPUT_FLUSH_MS, until the command completes.
  const runningCommands = new Map<string, { item: AnyRecord; output: string; timer: NodeJS.Timeout | null }>();
  const fileChanges = new Map<string, AnyRecord[]>();

  let settleTurn: (outcome: { status: string; reason?: string }) => void = () => {};
  const turnEnded = new Promise<{ status: string; reason?: string }>((resolve) => {
    settleTurn = (outcome) => {
      turnOpen = false;
      resolve(outcome);
    };
  });

  const session: ActiveCodexSession = {
    status: 'running',
    abortController,
    startedAt: new Date().toISOString(),
    steer: async (text, steerImages, steerFiles) => {
      if (!connection || !threadId || !turnId || !turnOpen || session.status !== 'running') {
        return false;
      }
      try {
        await connection.request('turn/steer', {
          threadId,
          expectedTurnId: turnId,
          input: toAppServerInput(text, steerImages, steerFiles, workingDirectory),
        });
        return true;
      } catch (error) {
        // Most often the turn ended between the click and the request; the
        // client queues the message for the next turn instead.
        console.warn('[Codex] turn/steer refused:', error instanceof Error ? error.message : error);
        return false;
      }
    },
  };
  // The newest run owns the key; an older run winding down must not touch it.
  const registerSession = () => {
    const key = sessionKey();
    if (key) {
      activeCodexSessions.set(key, session);
    }
  };

  const withdrawApprovals = (reason: string) => {
    for (const entry of [...pendingCodexApprovals.values()]) {
      if (entry.runId === runId) {
        entry.withdraw(reason);
      }
    }
  };

  // Asks the user through the same prompt Claude's tool approvals use.
  const askUser = (toolName: string, input: AnyRecord, rpcRequestId: number | string) =>
    new Promise<CodexApprovalAnswer>((resolve) => {
      const requestId = crypto.randomUUID();
      const messageSessionId = capturedSessionId || sessionId || null;
      let settled = false;
      const finish = (answer: CodexApprovalAnswer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pendingCodexApprovals.delete(requestId);
        resolve(answer);
      };
      const timer = setTimeout(() => {
        sendMessage(ws, createNormalizedMessage({ kind: 'permission_cancelled', requestId, reason: 'timeout', sessionId: messageSessionId, provider: 'codex' }));
        finish('deny');
      }, CODEX_APPROVAL_TIMEOUT_MS);
      timer.unref?.();

      pendingCodexApprovals.set(requestId, {
        sessionId: sessionId || capturedSessionId || null,
        runId,
        rpcRequestId,
        toolName,
        input,
        receivedAt: new Date(),
        answer: (decision) => {
          if (settled) return;
          // Retracts the prompt in every tab and in the replay buffer.
          sendMessage(ws, createNormalizedMessage({ kind: 'permission_resolved', requestId, sessionId: messageSessionId, provider: 'codex' }));
          if (!decision.allow) {
            finish('deny');
          } else {
            // "Allow & remember" means: do not ask again in this chat. Codex
            // keeps that grant itself for the rest of the session.
            finish(decision.rememberEntry ? 'allow_session' : 'allow');
          }
        },
        withdraw: (reason) => {
          if (settled) return;
          sendMessage(ws, createNormalizedMessage({ kind: 'permission_cancelled', requestId, reason, sessionId: messageSessionId, provider: 'codex' }));
          finish('cancel');
        },
      });

      sendMessage(ws, createNormalizedMessage({
        kind: 'permission_request',
        requestId,
        toolName,
        input,
        context: { provider: 'codex' },
        sessionId: messageSessionId,
        provider: 'codex',
      }));
      notifyCodexUser({
        userId: ws?.userId || null,
        event: createCodexNotificationEvent({
          provider: 'codex',
          sessionId: sessionId || capturedSessionId || null,
          kind: 'action_required',
          code: 'permission.required',
          meta: { toolName, sessionName: sessionSummary },
          severity: 'warning',
          requiresUserAction: true,
          dedupeKey: `codex:permission:${sessionId || capturedSessionId || 'none'}:${requestId}`
        }),
      });
    });

  const answerServerRequest = async (method: string, params: AnyRecord, rpcRequestId: number | string) => {
    switch (method) {
      case 'item/commandExecution/requestApproval': {
        const answer = await askUser('Bash', {
          command: params.command ?? '',
          ...(params.cwd ? { cwd: params.cwd } : {}),
          ...(params.reason ? { reason: params.reason } : {}),
        }, rpcRequestId);
        const decision = { allow: 'accept', allow_session: 'acceptForSession', deny: 'decline', cancel: 'cancel' }[answer];
        return { decision };
      }
      case 'item/fileChange/requestApproval': {
        const changes = fileChanges.get(String(params.itemId)) ?? [];
        const answer = await askUser('Edit', {
          ...(changes.length === 1 ? { file_path: changes[0].path } : {}),
          files: changes.map((change) => change.path),
          ...(params.reason ? { reason: params.reason } : {}),
          ...(params.grantRoot ? { grant_root: params.grantRoot } : {}),
        }, rpcRequestId);
        const decision = { allow: 'accept', allow_session: 'acceptForSession', deny: 'decline', cancel: 'cancel' }[answer];
        return { decision };
      }
      case 'item/permissions/requestApproval': {
        const requested = (params.permissions || {}) as AnyRecord;
        const answer = await askUser('Permissions', {
          ...(params.reason ? { reason: params.reason } : {}),
          permissions: requested,
        }, rpcRequestId);
        if (answer === 'allow' || answer === 'allow_session') {
          const granted: AnyRecord = {};
          if (requested.network) granted.network = requested.network;
          if (requested.fileSystem) granted.fileSystem = requested.fileSystem;
          return { permissions: granted, scope: answer === 'allow_session' ? 'session' : 'turn' };
        }
        return { permissions: {}, scope: 'turn' };
      }
      case 'item/tool/requestUserInput':
        // Codex's question tool (plan mode, experimental) has no prompt here
        // yet; no answers lets the model carry on without them.
        return { answers: {} };
      case 'mcpServer/elicitation/request':
        return { action: 'decline', content: null, _meta: null };
      default:
        throw new Error(`${method} is not supported by CloudCLI`);
    }
  };

  const flushCommand = (itemId: string) => {
    const running = runningCommands.get(itemId);
    if (!running) return;
    running.timer = null;
    reporter.forward({ type: 'item.updated', item: { ...running.item, aggregated_output: running.output } });
  };

  const handleNotification = (method: string, params: AnyRecord) => {
    // Sub-agents run as threads of their own on the same connection; only
    // this run's thread is drawn, as `codex exec` did.
    if (threadId && typeof params.threadId === 'string' && params.threadId !== threadId) {
      return;
    }
    if (turnId && typeof params.turnId === 'string' && params.turnId !== turnId) {
      return;
    }

    switch (method) {
      case 'turn/started':
        reporter.forward({ type: 'turn.started' });
        return;

      case 'item/started':
      case 'item/completed': {
        const item = toSdkThreadItem(params.item as AnyRecord);
        if (!item) return;
        if (item.type === 'file_change') {
          fileChanges.set(String(item.id), item.changes);
        }
        if (item.type === 'command_execution') {
          const running = runningCommands.get(String(item.id));
          if (method === 'item/started') {
            runningCommands.set(String(item.id), { item, output: item.aggregated_output || '', timer: null });
          } else if (running) {
            if (running.timer) clearTimeout(running.timer);
            runningCommands.delete(String(item.id));
          }
        }
        reporter.forward({ type: method === 'item/started' ? 'item.started' : 'item.completed', item });
        return;
      }

      case 'item/commandExecution/outputDelta': {
        const running = runningCommands.get(String(params.itemId));
        if (!running || typeof params.delta !== 'string') return;
        running.output += params.delta;
        if (!running.timer) {
          running.timer = setTimeout(() => flushCommand(String(params.itemId)), COMMAND_OUTPUT_FLUSH_MS);
          running.timer.unref?.();
        }
        return;
      }

      case 'turn/plan/updated': {
        const plan = Array.isArray(params.plan) ? params.plan : [];
        reporter.forward({
          type: 'item.updated',
          item: {
            id: `plan_${params.turnId || turnId || 'turn'}`,
            type: 'todo_list',
            items: plan.map((step: AnyRecord) => ({ text: String(step?.step ?? ''), completed: step?.status === 'completed' })),
          },
        });
        return;
      }

      case 'thread/tokenUsage/updated':
        lastTokenUsage = (params.tokenUsage as AnyRecord) || null;
        return;

      case 'error': {
        // A retried error is followed by the retry; a final one by the
        // failed `turn/completed`, which is what the user sees.
        if (!params.willRetry) {
          reporter.forward({ type: 'error', message: (params.error as AnyRecord)?.message });
        }
        return;
      }

      case 'serverRequest/resolved': {
        // The server withdrew a prompt it had sent (the turn moved on).
        for (const entry of [...pendingCodexApprovals.values()]) {
          if (entry.runId === runId && entry.rpcRequestId === params.requestId) {
            entry.withdraw('cancelled');
          }
        }
        return;
      }

      case 'turn/completed': {
        const turn = (params.turn || {}) as AnyRecord;
        for (const id of [...runningCommands.keys()]) {
          const running = runningCommands.get(id);
          if (running?.timer) clearTimeout(running.timer);
          runningCommands.delete(id);
        }
        if (turn.status === 'failed') {
          reporter.forward({ type: 'turn.failed', error: { message: (turn.error as AnyRecord)?.message || 'Turn failed' } });
        } else if (turn.status === 'completed') {
          reporter.forward({ type: 'turn.completed', ...toSdkTurnUsage(lastTokenUsage) });
        }
        settleTurn({ status: String(turn.status || 'completed') });
        return;
      }

      default:
        return;
    }
  };

  const onAbort = () => {
    withdrawApprovals('cancelled');
    if (connection && threadId && turnId && turnOpen) {
      connection.request('turn/interrupt', { threadId, turnId }).catch(() => {});
      const grace = setTimeout(() => settleTurn({ status: 'interrupted' }), INTERRUPT_GRACE_MS);
      grace.unref?.();
    } else {
      settleTurn({ status: 'interrupted' });
    }
  };

  let workingDirectory = process.cwd();
  registerSession();

  try {
    const settings = await resolveCodexRunSettings(options, context);
    workingDirectory = settings.workingDirectory;
    capturedSessionId = settings.providerSessionId;
    registerSession();

    connection = await openCodexAppServer({ cwd: workingDirectory, spawnChild: context.spawnCodexAppServer });
    connection.onNotification(handleNotification);
    connection.onServerRequest(answerServerRequest);
    connection.onExit((reason) => settleTurn({ status: 'exited', reason }));
    abortController.signal.addEventListener('abort', onAbort, { once: true });
    if (abortController.signal.aborted) {
      return;
    }

    const threadSettings = {
      ...(settings.resolvedModel ? { model: settings.resolvedModel } : {}),
      cwd: workingDirectory,
      approvalPolicy: settings.approvalPolicy,
      sandbox: settings.sandboxMode,
    };
    const opened = (settings.providerSessionId
      ? await connection.request('thread/resume', {
        threadId: settings.providerSessionId,
        ...threadSettings,
        // The transcript is read from disk by the history API, not from here.
        excludeTurns: true,
      }, THREAD_RESUME_TIMEOUT_MS)
      : await connection.request('thread/start', threadSettings)) as AnyRecord;
    threadId = String(opened?.thread?.id || settings.providerSessionId || '');
    if (!threadId) {
      throw new Error('Codex did not report a thread id.');
    }

    if (!capturedSessionId) {
      capturedSessionId = threadId;
      registerSession();
      if (ws.setSessionId && typeof ws.setSessionId === 'function') {
        ws.setSessionId(capturedSessionId);
      }
      sendMessage(ws, createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'codex' }));
    }
    if (abortController.signal.aborted) {
      return;
    }

    turnOpen = true;
    const started = await connection.request('turn/start', {
      threadId,
      input: toAppServerInput(command, images, files, workingDirectory),
      ...(settings.resolvedEffort ? { effort: settings.resolvedEffort } : {}),
    }) as AnyRecord;
    turnId = String(started?.turn?.id || '') || null;
    if (abortController.signal.aborted) {
      // Stop arrived while turn/start was in flight, before there was a turn
      // to interrupt.
      onAbort();
    }

    const outcome = await turnEnded;
    if (session.status === 'aborted' || abortController.signal.aborted) {
      // abort-session already sent the terminal `complete` (aborted: true).
      return;
    }
    if (outcome.status === 'exited') {
      throw new Error(`${outcome.reason}${connection.lastStderrLine() ? ` — ${connection.lastStderrLine()}` : ''}`);
    }

    sendMessage(ws, createCompleteMessage({
      provider: 'codex',
      sessionId: capturedSessionId || sessionId || null,
      actualSessionId: capturedSessionId || threadId || sessionId || null,
      exitCode: reporter.terminalFailure ? 1 : 0,
    }));
    if (!reporter.terminalFailure) {
      notifyRunStopped({
        userId: ws?.userId || null,
        provider: 'codex',
        sessionId: sessionId || capturedSessionId || null,
        sessionName: sessionSummary,
        stopReason: 'completed'
      });
    }
  } catch (error) {
    if (session.status !== 'aborted' && !abortController.signal.aborted) {
      await reportRunError(error, { ws, context, reporter, sessionId, capturedSessionId, sessionSummary });
    }
  } finally {
    turnOpen = false;
    abortController.signal.removeEventListener('abort', onAbort);
    withdrawApprovals('cancelled');
    for (const running of runningCommands.values()) {
      if (running.timer) clearTimeout(running.timer);
    }
    connection?.close();
    if (session.status === 'running') {
      session.status = 'completed';
    }
  }
}

/**
 * Execute a Codex query with streaming
 * @param {string} command - The prompt to send
 * @param {object} options - Options including cwd, sessionId, model, permissionMode
 * @param {WebSocket|object} ws - WebSocket connection or response writer
 */
async function queryCodex(
  command: string,
  options: AnyRecord = {},
  ws: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
) {
  if (process.env.CLOUDCLI_CODEX_TRANSPORT === 'exec') {
    return queryCodexExec(command, options, ws, context);
  }
  return queryCodexAppServer(command, options, ws, context);
}

/**
 * Abort an active Codex session
 * @param {string} sessionId - Session ID to abort
 * @returns {boolean} - Whether abort was successful
 */
function abortCodexSession(sessionId: string) {
  const session = activeCodexSessions.get(sessionId);

  if (!session) {
    return false;
  }

  session.status = 'aborted';
  try {
    session.abortController?.abort();
  } catch (error) {
    console.warn(`[Codex] Failed to abort session ${sessionId}:`, error);
  }

  return true;
}

/**
 * Hands a running turn another user message ("Send now"); Codex takes it in
 * at its next step, as its own terminal does.
 * @returns False when no live turn can take it; the caller queues it instead
 */
async function injectCodexMessage(
  sessionId: string,
  text: string,
  attachments: { images?: unknown[]; files?: unknown[] } = {},
) {
  const session = activeCodexSessions.get(sessionId);
  if (!session?.steer || session.status !== 'running') {
    return false;
  }
  return session.steer(text, attachments.images ?? [], attachments.files ?? []);
}

/** Used by the providers module's CodexProvider to run, steer and abort turns. */
export const codexRuntime = {
  run: queryCodex,
  abort: abortCodexSession,
  inject: injectCodexMessage,
  permissions: {
    resolve: resolveCodexApproval,
    listPending: listPendingCodexApprovals,
  },
};

/** The SDK (`codex exec`) transport on its own, for its tests. */
export { queryCodexExec };

/**
 * Helper to send message via WebSocket or writer
 * @param {WebSocket|object} ws - WebSocket or response writer
 * @param {object} data - Data to send
 */
function sendMessage(ws: ProviderRuntimeWriter, data: unknown) {
  try {
    if (ws.isWebSocketWriter) {
      // The gateway writer handles stringification
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      // Raw WebSocket - stringify here
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[Codex] Error sending message:', error);
  }
}

// Clean up old completed sessions periodically
const completedSessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status !== 'running') {
      const startedAt = new Date(session.startedAt).getTime();
      if (now - startedAt > maxAge) {
        activeCodexSessions.delete(id);
      }
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

// Runtime cleanup should not keep focused tests or one-off scripts alive after
// their provider work has completed.
completedSessionCleanupTimer.unref?.();
