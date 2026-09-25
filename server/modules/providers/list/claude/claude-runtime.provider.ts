/**
 * Claude SDK Integration
 *
 * This module provides SDK-based integration with Claude using the @anthropic-ai/claude-agent-sdk.
 * It mirrors the interface of claude-cli.js but uses the SDK internally for better performance
 * and maintainability.
 *
 * Key features:
 * - Direct SDK integration without child processes
 * - Session management with abort capability
 * - Options mapping between CLI and SDK formats
 * - WebSocket message streaming
 */

import crypto from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import type { AnyRecord, BackgroundTaskSummary, ProviderRuntimeContext, ProviderRuntimeWriter, ProviderPermissionDecision, RealtimeClientConnection } from '@/shared/index.js';
import {
  appendFilesInputTag,
  buildClaudeUserContent,
  normalizeImageDescriptors,
  resolveClaudeCodeExecutablePath,
  createCompleteMessage,
  createNormalizedMessage
} from '@/shared/index.js';
import {
  CLAUDE_PREDEFINED_MODELS,
  CLAUDE_ULTRACODE_EFFORT
} from '@/modules/providers/list/claude/claude-models.provider.js';
import {
  createNotificationEvent as createUntypedNotificationEvent,
  notifyBackgroundWorkCompleted,
  notifyRunFailed,
  notifyRunStopped,
  notifyUserIfEnabled as notifyUserIfEnabledUntyped
} from '@/modules/notifications/index.js';
import { sessionHistoryCache } from '@/modules/providers/services/session-history-cache.service.js';

import { createClaudeInputQueue } from './claude-input-queue.js';

// The notification module is JavaScript; its inferred null-only defaults do
// not describe the session IDs and event payloads accepted at runtime.
const createNotificationEvent = createUntypedNotificationEvent as unknown as (input: AnyRecord) => AnyRecord;
const notifyUserIfEnabled = notifyUserIfEnabledUntyped as (input: { userId: string | number | null; event: AnyRecord }) => void;

type ClaudeQuery = ReturnType<NonNullable<ProviderRuntimeContext['createQuery']>>;
type SessionWriter = ProviderRuntimeWriter & { updateWebSocket?(socket: RealtimeClientConnection): void };
type LiveSession = {
  instance: ClaudeQuery;
  startTime: number;
  status: 'active' | 'aborted';
  writer: SessionWriter | null;
  releaseInput: (() => void) | null;
  closeSubmissions?: () => void;
  submit?: (command: string, options: AnyRecord, writer: ProviderRuntimeWriter) => Promise<unknown>;
};

const activeSessions = new Map<string, LiveSession>();
// Reserve the app session before asynchronous setup, including aborts during it.
const startingSessions = new Map<string, { aborted: boolean }>();
// Outstanding background tasks per live session, keyed like activeSessions. An
// entry lives exactly as long as the map entry it shadows: cleared when the
// session is removed, and reset when a newer run takes the key over.
const backgroundWork = createBackgroundWorkTracker();
const pendingToolApprovals = new Map<string, ((decision: AnyRecord) => void) & AnyRecord>();
// Sessions cancelled via abort-session. The abort handler already sent the
// terminal `complete` (aborted: true) to the client, so the run loop must not
// emit a second one when its generator winds down.
const abortedInstances = new WeakSet<ClaudeQuery>();
// Query instances interrupted because a newer run took over their session id
// (see addSession). Their run loops must stay silent on wind-down: the map
// entry, the abort flag, and all client-facing events belong to the new run.
const supersededInstances = new WeakSet();

const TOOL_APPROVAL_TIMEOUT_MS = parseInt(process.env.CLAUDE_TOOL_APPROVAL_TIMEOUT_MS || '', 10) || 55000;

// Reclaim an idle conversation after 30 minutes, but never while it owns work.
// Closing stdin is a process shutdown, not a turn-completion signal.
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
// Fallback for SDK/tool versions without lifecycle events. Silent deferred work
// beyond this lease cannot be distinguished from finished work; tracked tasks
// remain protected independently, with no time limit.
const UNTRACKED_WORK_CEILING_MS = 24 * 60 * 60 * 1000;

const TOOLS_REQUIRING_INTERACTION = new Set(['AskUserQuestion', 'ExitPlanMode']);

// Ultracode is a session-scoped setting rather than an SDK effort level: it pairs xhigh
// effort with standing dynamic-workflow orchestration, and the CLI only honours it when
// Workflows are enabled. The catalog offers it as an effort choice for the picker, so the
// selection is translated back into the two options the SDK actually understands here.
const ULTRACODE_SDK_EFFORT = 'xhigh';

function resolveClaudeEffort(model: string, effort: string | undefined, modelsDefinition: AnyRecord = CLAUDE_PREDEFINED_MODELS) {
  const selectedModel = modelsDefinition?.OPTIONS?.find((option: AnyRecord) => option.value === model) || null;
  const allowedEfforts = selectedModel?.effort?.values
    ?.map((value: AnyRecord) => value.value) || [];
  return typeof effort === 'string' && effort !== 'default' && allowedEfforts.includes(effort)
    ? effort
    : undefined;
}

/**
 * Writes the resolved effort choice onto the SDK options, expanding `ultracode` into the
 * xhigh effort level plus the session-scoped settings it requires.
 * @param {Object} sdkOptions - SDK options being built
 * @param {string|undefined} resolvedEffort - Catalog-validated effort selection
 */
function applyClaudeEffort(sdkOptions: AnyRecord, resolvedEffort: string | undefined) {
  if (!resolvedEffort) {
    return;
  }

  if (resolvedEffort !== CLAUDE_ULTRACODE_EFFORT) {
    sdkOptions.effort = resolvedEffort;
    return;
  }

  sdkOptions.effort = ULTRACODE_SDK_EFFORT;
  sdkOptions.settings = {
    ...(sdkOptions.settings || {}),
    ultracode: true,
    enableWorkflows: true
  };
}

function createRequestId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function waitForToolApproval(requestId: string, options: AnyRecord = {}) {
  const { timeoutMs = TOOL_APPROVAL_TIMEOUT_MS, signal, onCancel, metadata } = options;

  return new Promise<AnyRecord | null>(resolve => {
    let settled = false;

    const finalize = (decision: AnyRecord | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(decision);
    };

    let timeout: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      pendingToolApprovals.delete(requestId);
      if (timeout) clearTimeout(timeout);
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
    };

    // timeoutMs 0 = wait indefinitely (interactive tools)
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        onCancel?.('timeout');
        finalize(null);
      }, timeoutMs);
    }

    const abortHandler = () => {
      onCancel?.('cancelled');
      finalize({ cancelled: true });
    };

    if (signal) {
      if (signal.aborted) {
        onCancel?.('cancelled');
        finalize({ cancelled: true });
        return;
      }
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    const resolver = (decision: AnyRecord) => {
      finalize(decision);
    };
    // Attach metadata for getPendingApprovalsForSession lookup
    if (metadata) {
      Object.assign(resolver, metadata);
    }
    pendingToolApprovals.set(requestId, resolver);
  });
}

/** Used by the providers permission gateway to deliver a user decision. */
export function resolveToolApproval(requestId: string, decision: ProviderPermissionDecision) {
  const resolver = pendingToolApprovals.get(requestId);
  if (resolver) {
    resolver(decision);
  }
}

// Match stored permission entries against a tool + input combo.
// This only supports exact tool names and the Bash(command:*) shorthand
// used by the UI; it intentionally does not implement full glob semantics,
// introduced to stay consistent with the UI's "Allow rule" format.
function matchesToolPermission(entry: string, toolName: string, input: AnyRecord | string) {
  if (!entry || !toolName) {
    return false;
  }

  if (entry === toolName) {
    return true;
  }

  const bashMatch = entry.match(/^Bash\((.+):\*\)$/);
  if (toolName === 'Bash' && bashMatch) {
    const allowedPrefix = bashMatch[1];
    let command = '';

    if (typeof input === 'string') {
      command = input.trim();
    } else if (input && typeof input === 'object' && typeof input.command === 'string') {
      command = input.command.trim();
    }

    if (!command) {
      return false;
    }

    return command.startsWith(allowedPrefix);
  }

  return false;
}

function mapCliOptionsToSDK(options: AnyRecord = {}) {
  const { providerSessionId, cwd, toolsSettings, permissionMode, effort, resumeAnchorId, resumeFromScratch } = options;

  const sdkOptions: AnyRecord = {};

  // Forward all host env vars (e.g. ANTHROPIC_BASE_URL) to the subprocess.
  // Since SDK 0.2.113, options.env replaces process.env instead of overlaying it.
  sdkOptions.env = { ...process.env };

  // Resolve the executable eagerly on Windows because the SDK uses raw child_process.spawn,
  // which does not reliably follow npm's shell wrappers like cross-spawn does.
  // When nothing resolves the option stays unset on purpose: the SDK then falls back to the
  // binary it ships, which beats handing it a bare `claude` that raw spawn can never launch.
  const claudeExecutablePath = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
  if (claudeExecutablePath) {
    sdkOptions.pathToClaudeCodeExecutable = claudeExecutablePath;
  }

  if (cwd) {
    sdkOptions.cwd = cwd;
  }

  if (permissionMode && permissionMode !== 'default') {
    sdkOptions.permissionMode = permissionMode;
  }

  const settings = toolsSettings || {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false
  };

  if (settings.skipPermissions && permissionMode !== 'plan') {
    sdkOptions.permissionMode = 'bypassPermissions';
  }

  let allowedTools = [...(settings.allowedTools || [])];

  if (permissionMode === 'plan') {
    const planModeTools = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch'];
    for (const tool of planModeTools) {
      if (!allowedTools.includes(tool)) {
        allowedTools.push(tool);
      }
    }
  }

  sdkOptions.allowedTools = allowedTools;

  // Use the tools preset to make all default built-in tools available (including AskUserQuestion).
  // This was introduced in SDK 0.1.57. Omitting this preserves existing behavior (all tools available),
  // but being explicit ensures forward compatibility and clarity.
  sdkOptions.tools = { type: 'preset', preset: 'claude_code' };

  sdkOptions.disallowedTools = settings.disallowedTools || [];

  sdkOptions.model = options.model || CLAUDE_PREDEFINED_MODELS.DEFAULT;

  applyClaudeEffort(sdkOptions, resolveClaudeEffort(
    sdkOptions.model,
    effort,
    options.effortModels || CLAUDE_PREDEFINED_MODELS,
  ));

  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'claude_code'
  };

  sdkOptions.settingSources = ['project', 'user', 'local'];

  // The SDK resumes with the provider-native session id, never the app id.
  // `resumeFromScratch` is set when the very first prompt of a conversation was
  // edited: there is nothing before it to resume through, so the turn has to
  // start the conversation over instead.
  if (providerSessionId && !resumeFromScratch) {
    sdkOptions.resume = providerSessionId;

    // Editing an already-sent message re-runs the conversation truncated just
    // before it. `resumeSessionAt` is inclusive of the uuid it names, so the
    // caller resolves the last row to KEEP and passes that — never the edited
    // turn itself, which would leave the original prompt in context.
    if (resumeAnchorId) {
      sdkOptions.resumeSessionAt = resumeAnchorId;
    }
  }

  return sdkOptions;
}

/**
 * Adds a session to the active sessions map
 * @param {string} sessionId - Session identifier
 * @param {Object} queryInstance - SDK query instance
 * @param {Object} writer - WebSocket writer for reconnect support
 * @param {Function} releaseInput - Closes the held stdin stream so the CLI can exit
 */
function addSession(sessionId: string, queryInstance: ClaudeQuery, writer: ProviderRuntimeWriter | null = null, releaseInput: (() => void) | null = null) {
  const existing = activeSessions.get(sessionId);
  // A different live instance under the same key means an earlier run was
  // superseded without being stopped (e.g. an abort that raced run setup and
  // found nothing to interrupt). Overwriting it here would strand its
  // generator forever — this map entry is the only handle for interrupting
  // it. Stop it directly rather than via abortClaudeSDKSession, whose
  // aborted-instance flag would be consumed by the new run
  // and suppress its terminal `complete`.
  const superseding = Boolean(
    existing && existing.status === 'active' && existing.instance && existing.instance !== queryInstance
  );
  if (superseding && existing) {
    supersededInstances.add(existing.instance);
    Promise.resolve()
      .then(() => existing.instance.interrupt())
      .catch((error) => {
        console.error(`Error interrupting superseded run for session ${sessionId}:`, error?.message || error);
      });
    existing.releaseInput?.();
    // Whatever the superseded process had outstanding dies with it and will
    // never report, so the new run starts from an empty task set.
    backgroundWork.clear(sessionId);
  }
  const carried = superseding ? null : existing;
  activeSessions.set(sessionId, {
    instance: queryInstance,
    startTime: carried?.startTime || Date.now(),
    status: 'active',
    writer,
    // Re-registered mid-run once the provider session id lands; keep the closer.
    releaseInput: releaseInput || carried?.releaseInput || null
  });
  // The history reader reports a background agent as running or stopped by
  // whether this entry exists, and the cached history does not see this map.
  sessionHistoryCache.invalidate(sessionId);
}

/**
 * Removes a session from the active sessions map
 * @param {string} sessionId - Session identifier
 */
function removeSession(sessionId: string) {
  activeSessions.delete(sessionId);
  // No process, no background work: anything still tracked was killed with it.
  backgroundWork.clear(sessionId);
  // See addSession: a page cached while the process was up still says
  // `running` for any agent that never reported back.
  sessionHistoryCache.invalidate(sessionId);
}

/**
 * Gets a session from the active sessions map
 * @param {string} sessionId - Session identifier
 * @returns {Object|undefined} Session data or undefined
 */
function getSession(sessionId: string | null) {
  return sessionId ? activeSessions.get(sessionId) : undefined;
}

/**
 * Gets all active session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getAllSessions() {
  return Array.from(activeSessions.keys());
}

/**
 * Transforms SDK messages to WebSocket format expected by frontend
 * @param {Object} sdkMessage - SDK message object
 * @returns {Object} Transformed message ready for WebSocket
 */
function transformMessage(sdkMessage: AnyRecord) {
  // Extract parent_tool_use_id for subagent tool grouping
  if (sdkMessage.parent_tool_use_id) {
    return {
      ...sdkMessage,
      parentToolUseId: sdkMessage.parent_tool_use_id
    };
  }
  return sdkMessage;
}

/**
 * True for the user bubble the SDK echoes for a subagent's own prompt.
 *
 * Subagent traffic carries `parent_tool_use_id`, so this echo lands in the main
 * thread and stacks a second copy of the prompt right below the Agent tool card
 * that already displays it. It also disappears on reload, because the transcript
 * keeps that turn in the subagent's sidechain rather than the session file.
 * @param {Object} message - Normalized message about to be sent to the client
 * @returns {boolean}
 */
export function isSubagentPromptEcho(message: AnyRecord) {
  return Boolean(message?.parentToolUseId) && message.role === 'user' && message.kind === 'text';
}

function readNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * @typedef {Object} TokenBudget
 * @property {number} used
 * @property {number} total
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} [cacheReadTokens]
 * @property {number} [cacheCreationTokens]
 * @property {number} [cacheTokens]
 * @property {{ input: number, output: number }} breakdown
 */

/**
 * Builds a context-window budget from an Anthropic-shaped usage payload.
 *
 * `input_tokens + cache_read + cache_creation` is one request's whole prompt,
 * which is exactly what the context window holds at that moment.
 * @param {Object} messageUsage - Anthropic usage payload
 * @returns {TokenBudget} Token budget object
 */
function buildTokenBudget(messageUsage: AnyRecord) {
  const directInputTokens = readNumber(messageUsage.input_tokens ?? messageUsage.inputTokens);
  const cacheCreationTokens = readNumber(messageUsage.cache_creation_input_tokens ?? messageUsage.cacheCreationInputTokens ?? messageUsage.cacheCreationTokens);
  const cacheReadTokens = readNumber(messageUsage.cache_read_input_tokens ?? messageUsage.cacheReadInputTokens ?? messageUsage.cacheReadTokens);
  const cacheTokens = cacheCreationTokens + cacheReadTokens;
  const inputTokens = directInputTokens + cacheTokens;
  const outputTokens = readNumber(messageUsage.output_tokens ?? messageUsage.outputTokens);
  const contextWindow = parseInt(process.env.CONTEXT_WINDOW || '', 10) || 160000;

  return {
    used: inputTokens + outputTokens,
    total: contextWindow,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheTokens,
    breakdown: {
      input: inputTokens,
      output: outputTokens,
    },
  };
}

/**
 * Extracts the session's context-window usage from an SDK stream message.
 *
 * Only assistant messages describe the context window: each one reports the
 * prompt its own request carried. The turn-ending `result` is deliberately not
 * a source here — see `extractCumulativeTokenBudget`.
 * @param {Object} sdkMessage - SDK stream message
 * @returns {TokenBudget|null} Token budget object or null
 */
export function extractTokenBudget(sdkMessage: AnyRecord) {
  if (!sdkMessage || typeof sdkMessage !== 'object') {
    return null;
  }

  // Subagent traffic (parent_tool_use_id set) reports the subagent's own
  // context window, not this session's — surfacing it makes the counter drop
  // to the subagent's number and bounce back on the next main-thread event.
  if (sdkMessage.parent_tool_use_id) {
    return null;
  }

  // Only assistant messages carry Anthropic-shaped usage. System
  // task_progress/task_notification events have a top-level `usage` too, but
  // shaped {total_tokens, tool_uses, duration_ms} — reading Anthropic keys
  // off it yields an all-zero budget that flashes "0" in the composer.
  if (sdkMessage.type !== 'assistant') {
    return null;
  }

  const messageUsage = sdkMessage.message?.usage;
  if (!messageUsage || typeof messageUsage !== 'object') {
    return null;
  }

  return buildTokenBudget(messageUsage);
}

/**
 * Last-resort budget read from a turn's `result` message.
 *
 * `result.usage` and `result.modelUsage` are the turn's *bill*: every request
 * the turn made, summed, including each subagent's. A turn that made four
 * requests therefore reports roughly four times the context the conversation
 * actually holds, so publishing it made the counter leap at the end of a turn
 * and fall back on the next assistant message — worst with subagents running,
 * whose requests inflate the sum without ever entering this session's context.
 *
 * It is still the only usage an SDK build that reports none per assistant
 * message ever emits, so it stays available for the caller to use when a turn
 * produced no assistant budget at all.
 * @param {Object} sdkMessage - SDK stream message
 * @returns {TokenBudget|null} Token budget object or null
 */
export function extractCumulativeTokenBudget(sdkMessage: AnyRecord) {
  if (!sdkMessage || typeof sdkMessage !== 'object' || sdkMessage.type !== 'result') {
    return null;
  }

  if (sdkMessage.usage && typeof sdkMessage.usage === 'object') {
    return buildTokenBudget(sdkMessage.usage);
  }

  if (!sdkMessage.modelUsage || typeof sdkMessage.modelUsage !== 'object') {
    return null;
  }

  // Fallback for older SDK messages with only modelUsage
  const modelKey = Object.keys(sdkMessage.modelUsage)[0];
  const modelData = sdkMessage.modelUsage[modelKey];

  if (!modelData || typeof modelData !== 'object') {
    return null;
  }

  const inputTokens = readNumber(modelData.cumulativeInputTokens ?? modelData.inputTokens);
  const outputTokens = readNumber(modelData.cumulativeOutputTokens ?? modelData.outputTokens);
  const totalUsed = inputTokens + outputTokens;
  const contextWindow = parseInt(process.env.CONTEXT_WINDOW || '', 10) || 160000;

  return {
    used: totalUsed,
    total: contextWindow,
    inputTokens,
    outputTokens,
    breakdown: {
      input: inputTokens,
      output: outputTokens,
    },
  };
}

// Tool calls that leave work running past the end of a turn. Bash and Agent only
// count when they are backgrounded; the rest defer or watch work by nature.
// Workflow belongs here rather than in a branch of its own: its input schema has
// no foreground option at all, so every call returns a task id immediately and
// reports back in a later turn.
const DEFERRED_WORK_TOOLS = new Set(['Monitor', 'ScheduleWakeup', 'CronCreate', 'TaskCreate', 'Workflow']);

/**
 * Detects tool calls that keep working after the turn's `result` arrives.
 *
 * Only turns that start background work need their CLI process held open; every
 * other turn can let it exit immediately, as it did before the hold existed.
 *
 * Used by the providers module's tests, which pin the tool matching directly:
 * the alternative is driving a whole SDK run to observe whether stdin was held,
 * and the cost of getting this wrong is silently killed background work.
 *
 * @param {Object} sdkMessage - SDK stream message
 * @returns {boolean} True when the message launches work that outlives the turn
 */
export function startsBackgroundWork(sdkMessage: AnyRecord) {
  const content = sdkMessage?.message?.content;
  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((block: AnyRecord) => {
    if (block?.type !== 'tool_use') {
      return false;
    }
    if (block.name === 'Bash') {
      return block.input?.run_in_background === true;
    }
    // A backgrounded subagent outlives the turn exactly like a backgrounded
    // Bash does, so the process has to be held open for it to report back.
    // Agents background by default — `run_in_background` is optional and only
    // an explicit `false` opts out — hence `!== false` rather than `=== true`.
    // A foreground agent must stay out of DEFERRED_WORK_TOOLS: it never pushes
    // a follow-up turn, so it would pin the process for the full ceiling.
    if (block.name === 'Agent') {
      return block.input?.run_in_background !== false;
    }
    return DEFERRED_WORK_TOOLS.has(block.name);
  });
}

// `task_updated` patch statuses after which a task is gone for good. `pending`,
// `running` and `paused` are still outstanding; `killed` is what the CLI
// writes when it stops a task itself (the task notification spells it
// `stopped`).
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'killed']);

/**
 * Tracks the background tasks each live session still has outstanding, folded
 * from the `system` task events the SDK stream already carries.
 *
 * `startsBackgroundWork` above only knows that a turn *launched* something
 * lasting; this knows what is still running and which task ids it answers to,
 * which is what the running-sessions list and a stop request need once the
 * turn's `result` has gone out and nothing else remembers the session is busy.
 *
 * Verified against a real query (SDK 0.3.165): `task_started` carries
 * `task_id`, `tool_use_id`, `task_type` and `description` for every agent,
 * workflow and backgrounded command (a foreground Bash emits nothing);
 * `task_notification` settles a task with any status; `task_updated` carries
 * only `task_id` and a patch, and is terminal when the patch's `status` is.
 * Housekeeping tasks the CLI starts on its own have no `tool_use_id` and are
 * not tracked — nothing in the transcript could show them.
 *
 * Exported so the folding can be driven with the four event shapes directly;
 * the runtime keeps one instance keyed like `activeSessions`.
 *
 * @returns {{
 *   apply: (sessionKey: string, message: Object) => void,
 *   hasOutstanding: (sessionKey: string) => boolean,
 *   has: (sessionKey: string, taskId: string) => boolean,
 *   clear: (sessionKey: string) => void,
 *   list: () => Array<{ sessionId: string, tasks: Array<import('@/shared/types.js').BackgroundTaskSummary> }>
 * }}
 */
export function createBackgroundWorkTracker() {
  /** @type {Map<string, Map<string, import('@/shared/types.js').BackgroundTaskSummary>>} */
  const sessions = new Map<string, Map<string, BackgroundTaskSummary>>();
  /**
   * Tool-use ids the session's own turns issued. A task started for a call an
   * agent made inside its own transcript — a workflow agent's backgrounded
   * command, say — reaches this stream too, and nothing in the parent
   * transcript could show it; it is kept for stopping but flagged `nested`.
   * @type {Map<string, Set<string>>}
   */
  const ownToolUseIds = new Map<string, Set<string>>();

  const remove = (sessionKey: string, taskId: string) => {
    const tasks = sessions.get(sessionKey);
    if (!tasks) {
      return;
    }
    tasks.delete(taskId);
    if (tasks.size === 0) {
      sessions.delete(sessionKey);
    }
  };

  return {
    apply(sessionKey: string, message: AnyRecord) {
      if (message?.type === 'assistant' && !message.parent_tool_use_id) {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'tool_use' && typeof block.id === 'string') {
              let ids = ownToolUseIds.get(sessionKey);
              if (!ids) {
                ids = new Set();
                ownToolUseIds.set(sessionKey, ids);
              }
              ids.add(block.id);
            }
          }
        }
        return;
      }
      if (message?.type !== 'system' || typeof message.task_id !== 'string') {
        return;
      }
      switch (message.subtype) {
        case 'task_started': {
          if (typeof message.tool_use_id !== 'string') {
            return;
          }
          const task: BackgroundTaskSummary = {
            taskId: message.task_id,
            toolUseId: message.tool_use_id,
            taskType: message.task_type,
            description: message.description,
            startedAt: Date.now()
          };
          if (typeof message.workflow_name === 'string') {
            task.workflowName = message.workflow_name;
          }
          if (!ownToolUseIds.get(sessionKey)?.has(message.tool_use_id)) {
            task.nested = true;
          }
          let tasks = sessions.get(sessionKey);
          if (!tasks) {
            tasks = new Map();
            sessions.set(sessionKey, tasks);
          }
          tasks.set(task.taskId, task);
          return;
        }
        case 'task_notification':
          remove(sessionKey, message.task_id);
          return;
        case 'task_updated':
          if (TERMINAL_TASK_STATUSES.has(message.patch?.status)) {
            remove(sessionKey, message.task_id);
          }
          return;
        default:
      }
    },

    hasOutstanding(sessionKey: string) {
      return sessions.has(sessionKey);
    },

    has(sessionKey: string, taskId: string) {
      return Boolean(sessions.get(sessionKey)?.has(taskId));
    },

    clear(sessionKey: string) {
      sessions.delete(sessionKey);
      ownToolUseIds.delete(sessionKey);
    },

    list() {
      return Array.from(sessions, ([sessionId, tasks]) => ({
        sessionId,
        tasks: Array.from(tasks.values())
      }));
    }
  };
}

/**
 * Builds the SDK user messages for one turn.
 *
 * Always returns SDKUserMessage records rather than a bare string: a string
 * prompt makes the SDK flag the query as single-turn and close stdin the moment
 * the turn's `result` arrives, which kills the CLI's background tasks. Plain
 * text turns carry string content; turns with image attachments carry the
 * prompt text plus one base64 `image` block per attachment (read from the
 * global `~/.cloudcli/assets` folder).
 *
 * @param {string} command - User prompt
 * @param {Array} images - Image descriptors ({ path, name?, mimeType? })
 * @param {Array} files - Non-image attachment descriptors
 * @param {string} cwd - Project working directory attachment paths resolve against
 * @returns {Promise<Array<Object>>} SDKUserMessage records for the turn
 */
async function buildPromptMessages(command: string, images: AnyRecord[], files: AnyRecord[], cwd: string): Promise<SDKUserMessage[]> {
  const promptWithFiles = appendFilesInputTag(command, files);
  const content = normalizeImageDescriptors(images).length === 0
    ? promptWithFiles
    : await buildClaudeUserContent(promptWithFiles, images, cwd);

  return [{
    type: 'user' as const,
    uuid: crypto.randomUUID(),
    session_id: '',
    message: {
      role: 'user' as const,
      content: content as SDKUserMessage['message']['content']
    },
    parent_tool_use_id: null,
    timestamp: new Date().toISOString()
  }];
}

/**
 * Loads MCP server configurations from ~/.claude.json
 * @param {string} cwd - Current working directory for project-specific configs
 * @returns {Object|null} MCP servers object or null if none found
 */
async function loadMcpConfig(cwd: string) {
  try {
    const claudeConfigPath = path.join(os.homedir(), '.claude.json');

    // Check if config file exists
    try {
      await fs.access(claudeConfigPath);
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught));
      // File doesn't exist, return null
      // No config file
      return null;
    }

    // Read and parse config file
    let claudeConfig;
    try {
      const configContent = await fs.readFile(claudeConfigPath, 'utf8');
      claudeConfig = JSON.parse(configContent);
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught));
      console.error('Failed to parse ~/.claude.json:', error.message);
      return null;
    }

    // Extract MCP servers (merge global and project-specific)
    let mcpServers: AnyRecord = {};

    // Add global MCP servers
    if (claudeConfig.mcpServers && typeof claudeConfig.mcpServers === 'object') {
      mcpServers = { ...claudeConfig.mcpServers };
      // Global MCP servers loaded
    }

    // Add/override with project-specific MCP servers
    if (claudeConfig.claudeProjects && cwd) {
      const projectConfig = claudeConfig.claudeProjects[cwd];
      if (projectConfig && projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object') {
        mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
        // Project MCP servers merged
      }
    }

    // Return null if no servers found
    if (Object.keys(mcpServers).length === 0) {
      return null;
    }
    return mcpServers;
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    console.error('Error loading MCP config:', error.message);
    return null;
  }
}

/**
 * Used by the provider registry to submit a turn to a persistent SDK session.
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @param {Object} context - Provider-scoped model, session, and auth lookups
 * @returns {Promise<void>}
 */
export async function queryClaudeSDK(command: string, options: AnyRecord, ws: ProviderRuntimeWriter, context: ProviderRuntimeContext) {
  const { sessionId } = options;
  let sessionSummary = options.sessionSummary;
  // Callers pass the stable app session id; the SDK only understands the
  // provider-native id recorded on the session row.
  const providerSessionId = context.resolveProviderSessionId(sessionId);
  // Provider-native id as the SDK reports it (starts as the resume id, or is
  // captured from the stream for brand-new sessions).
  let capturedSessionId = providerSessionId;
  let sessionCreatedSent = false;
  // Process-map key: the app session id when the caller supplied one, else
  // the provider-native id once captured (legacy/direct API callers).
  const sessionKey = (): string => sessionId || capturedSessionId || '';
  const existing = getSession(sessionKey());
  if (existing?.submit) {
    return existing.submit(command, options, ws);
  }

  if (startingSessions.has(sessionKey())) {
    ws.send(createNormalizedMessage({ kind: 'error', content: 'This Claude session is still starting. Retry the message.', sessionId: providerSessionId || sessionId || null, provider: 'claude' }));
    ws.send(createCompleteMessage({ provider: 'claude', sessionId: providerSessionId || sessionId || null, exitCode: 1 }));
    return;
  }
  const startupKey = sessionKey();
  const startup = { aborted: false };
  if (startupKey) startingSessions.set(startupKey, startup);

  const emitNotification = (event: Parameters<typeof notifyUserIfEnabled>[0]['event']) => {
    notifyUserIfEnabled({
      userId: ws?.userId || null,
      event
    });
  };

  // Closes the held stdin stream so the CLI can wind down. Replaced once the
  // stream exists; the finally block calls it no matter how the run ends.
  let releasePromptStream = () => {};
  let idleReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingPromptId: string | undefined;
  let resolveSubmittedTurn: (() => void) | undefined;
  let supportsPromptCorrelation = false;
  let closing = false;
  let finishProcess: () => void = () => {};
  const processClosed = new Promise<void>((resolve) => { finishProcess = resolve; });
  let automaticTurnPending = false;
  let untrackedWorkPending = false;
  let untrackedWorkTimer: ReturnType<typeof setTimeout> | null = null;
  // The client is told the turn is over as soon as `result` lands, even though
  // the process lingers, so the UI never waits out the idle hold.
  let turnCompleteSent = false;
  // Set when a turn starts background work, cleared when the next `result`
  // arrives — only turns with work still outstanding hold their process open.
  let backgroundWorkPending = false;
  // Set when the stream reports a task starting during this turn. Task events
  // are the exact word on what is still running, so when the turn produced
  // any, the tracker decides the hold; `startsBackgroundWork` is the fallback
  // for tools that emit none (Monitor, ScheduleWakeup, CronCreate, TaskCreate)
  // and for an SDK that does not report tasks at all.
  let sawTaskEventThisTurn = false;
  // True while the process is being held open for background work, so a later
  // `result` can be recognised as that work reporting back.
  let heldForBackgroundWork = false;
  // Set once a turn publishes a budget read from an assistant message, so the
  // turn-ending `result` is only mined for usage when nothing better arrived.
  let assistantBudgetSent = false;

  const cancelIdleRelease = () => {
    if (idleReleaseTimer) clearTimeout(idleReleaseTimer);
    idleReleaseTimer = null;
  };
  const scheduleRelease = () => {
    cancelIdleRelease();
    if (!turnCompleteSent || backgroundWork.hasOutstanding(sessionKey()) || untrackedWorkPending || automaticTurnPending) return;
    idleReleaseTimer = setTimeout(() => {
      idleReleaseTimer = null;
      closing = true;
      releasePromptStream();
    }, SESSION_IDLE_TIMEOUT_MS);
    idleReleaseTimer.unref?.();
  };

  /** Renew the fallback lease without imposing a deadline on tracked tasks. */
  const renewUntrackedWork = () => {
    if (untrackedWorkTimer) clearTimeout(untrackedWorkTimer);
    untrackedWorkPending = true;
    untrackedWorkTimer = setTimeout(() => {
      untrackedWorkTimer = null;
      untrackedWorkPending = false;
      console.warn('[Claude SDK] Untracked background work lease expired for session:', sessionKey());
      try {
        ws.send(createNormalizedMessage({ kind: 'status', text: 'Background work without task events has been silent for 24 hours. This session can now expire when idle.', sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
      } catch (error) {
        console.warn('[Claude SDK] Unable to report background lease expiry:', error);
      }
      scheduleRelease();
    }, UNTRACKED_WORK_CEILING_MS);
    untrackedWorkTimer.unref?.();
  };

  // Hoisted above the try so the catch's cleanup can tell whether this run
  // still owns the activeSessions entry (or was superseded by a newer run).
  let queryInstance: ClaudeQuery | null = null;

  try {
    const resolvedModel = await context.resolveResumeModel(sessionId, options.model);
    let effortModels: AnyRecord = CLAUDE_PREDEFINED_MODELS;
    try {
      effortModels = await context.getProviderModels();
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught));
      console.warn('[Claude SDK] Unable to load provider models for effort validation:', error);
    }

    const sdkOptions = mapCliOptionsToSDK({
      ...options,
      providerSessionId,
      model: resolvedModel || options.model,
      effortModels,
    });

    const mcpServers = await loadMcpConfig(options.cwd);
    if (mcpServers) {
      sdkOptions.mcpServers = mcpServers;
    }

    // Every turn uses streaming input so stdin stays open past the turn's
    // `result`. The message list is reusable, but each query attempt needs its
    // own stream because an async generator cannot be replayed once consumed.
    const promptMessages = await buildPromptMessages(command, options.images, options.files, options.cwd);

    sdkOptions.hooks = {
      Notification: [{
        matcher: '',
        hooks: [async (input: AnyRecord) => {
          const message = typeof input?.message === 'string' ? input.message : 'Claude requires your attention.';
          // Notifications are app-facing, so they carry the app session id.
          emitNotification(createNotificationEvent({
            provider: 'claude',
            sessionId: sessionId || capturedSessionId || null,
            kind: 'action_required',
            code: 'agent.notification',
            meta: { message, sessionName: sessionSummary },
            severity: 'warning',
            requiresUserAction: true,
            dedupeKey: `claude:hook:notification:${sessionId || capturedSessionId || 'none'}:${message}`
          }));
          return {};
        }]
      }]
    };

    // Caveat: in 'auto' and 'bypassPermissions' modes the SDK resolves approval
    // at the permission-mode step and skips this callback, so interactive tools
    // (AskUserQuestion, ExitPlanMode) won't reach the UI — the classifier/bypass
    // auto-approves them and the model acts on a generated answer. Move these
    // tools to a PreToolUse hook (runs before the mode check) if we need them
    // to work in those modes.
    // Track only permission changes actually accepted by this process. A new
    // client-side grant still needs a restart; a remembered decision does not.
    const liveToolsSettings = {
      allowedTools: [...(options.toolsSettings?.allowedTools ?? [])] as string[],
      disallowedTools: [...(options.toolsSettings?.disallowedTools ?? [])] as string[],
      skipPermissions: options.toolsSettings?.skipPermissions ?? false,
    };
    sdkOptions.canUseTool = async (toolName: string, input: AnyRecord, context: AnyRecord) => {
      cancelIdleRelease();
      if (turnCompleteSent) automaticTurnPending = true;
      const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);

      if (!requiresInteraction) {
        if (sdkOptions.permissionMode === 'bypassPermissions') {
          return { behavior: 'allow', updatedInput: input };
        }

        const isDisallowed = (sdkOptions.disallowedTools || []).some((entry: string) =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isDisallowed) {
          return { behavior: 'deny', message: 'Tool disallowed by settings' };
        }

        const isAllowed = (sdkOptions.allowedTools || []).some((entry: string) =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isAllowed) {
          return { behavior: 'allow', updatedInput: input };
        }
      }

      const requestId = createRequestId();
      ws.send(createNormalizedMessage({ kind: 'permission_request', requestId, toolName, input, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
      emitNotification(createNotificationEvent({
        provider: 'claude',
        sessionId: sessionId || capturedSessionId || null,
        kind: 'action_required',
        code: 'permission.required',
        meta: { toolName, sessionName: sessionSummary },
        severity: 'warning',
        requiresUserAction: true,
        dedupeKey: `claude:permission:${sessionId || capturedSessionId || 'none'}:${requestId}`
      }));

      const decision = await waitForToolApproval(requestId, {
        timeoutMs: requiresInteraction ? 0 : undefined,
        signal: context?.signal,
        metadata: {
          // Keyed by the app session id so `chat.subscribe` can look pending
          // approvals up directly; provider id only for legacy callers.
          _sessionId: sessionId || capturedSessionId || null,
          _toolName: toolName,
          _input: input,
          _receivedAt: new Date(),
        },
        onCancel: (reason: string) => {
          ws.send(createNormalizedMessage({ kind: 'permission_cancelled', requestId, reason, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        }
      });
      if (!decision) {
        return { behavior: 'deny', message: 'Permission request timed out' };
      }

      if (decision.cancelled) {
        return { behavior: 'deny', message: 'Permission request cancelled' };
      }

      // A client answered. Announce it on the run stream so the replay buffer
      // and every other attached tab drop the prompt — resolving happens over
      // the inbound socket only, so without this a mid-run page refresh
      // replays the `permission_request` with nothing to retract it and the
      // already-answered prompt resurrects.
      ws.send(createNormalizedMessage({ kind: 'permission_resolved', requestId, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));

      if (decision.allow) {
        if (decision.rememberEntry && typeof decision.rememberEntry === 'string') {
          if (!liveToolsSettings.allowedTools.includes(decision.rememberEntry)) {
            liveToolsSettings.allowedTools.push(decision.rememberEntry);
          }
          liveToolsSettings.disallowedTools = liveToolsSettings.disallowedTools.filter((entry) => entry !== decision.rememberEntry);
          if (!sdkOptions.allowedTools.includes(decision.rememberEntry)) {
            sdkOptions.allowedTools.push(decision.rememberEntry);
          }
          if (Array.isArray(sdkOptions.disallowedTools)) {
            sdkOptions.disallowedTools = sdkOptions.disallowedTools.filter((entry: string) => entry !== decision.rememberEntry);
          }
        }
        return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
      }

      return { behavior: 'deny', message: decision.message ?? 'User denied tool use' };
    };

    // The SDK's own `query`, unless the caller supplies one (tests script the
    // stream to drive the hold logic below without a CLI process).
    const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = context.createQuery
      ?? ((input) => query({ prompt: input.prompt as AsyncIterable<SDKUserMessage>, options: input.options as Options }));
    if (startup.aborted) return;
    pendingPromptId = promptMessages[0].uuid;
    let heldPrompt = createClaudeInputQueue(promptMessages);
    releasePromptStream = heldPrompt.release;
    try {
      queryInstance = createQuery({
        prompt: heldPrompt.stream,
        options: sdkOptions
      });
    } catch (caught) {
      const hookError = caught instanceof Error ? caught : new Error(String(caught));
      // Older/newer SDK versions may not accept hook shapes yet.
      // Keep notification behavior operational via runtime events even if hook registration fails.
      console.warn('Failed to initialize Claude query with hooks, retrying without hooks:', hookError?.message || hookError);
      delete sdkOptions.hooks;
      // Discard the abandoned stream and build a fresh one for the retry.
      heldPrompt.release();
      heldPrompt = createClaudeInputQueue(promptMessages);
      releasePromptStream = heldPrompt.release;
      queryInstance = createQuery({
        prompt: heldPrompt.stream,
        options: sdkOptions
      });
    }

    /** Compare startup settings plus permissions remembered by the live process. */
    const settingsKey = (input: AnyRecord) => JSON.stringify({
      cwd: input.cwd, model: input.model ?? null, effort: input.effort ?? null,
      permissionMode: input.permissionMode ?? 'default',
      toolsSettings: {
        allowedTools: [...new Set(input.toolsSettings?.allowedTools ?? [])].sort(),
        disallowedTools: [...new Set(input.toolsSettings?.disallowedTools ?? [])].sort(),
        skipPermissions: input.toolsSettings?.skipPermissions ?? false,
      },
    });
    const registerSession = () => {
      if (!sessionKey() || !queryInstance) return;
      addSession(sessionKey(), queryInstance, ws, () => {
        closing = true;
        releasePromptStream();
      });
      const session = getSession(sessionKey())!;
      session.closeSubmissions = () => { closing = true; cancelIdleRelease(); };
      session.submit = async (nextCommand: string, nextOptions: AnyRecord, nextWriter: ProviderRuntimeWriter) => {
        const refuse = (content: string) => {
          nextWriter.send(createNormalizedMessage({ kind: 'error', content, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
          nextWriter.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 1 }));
        };
        if (closing || heldPrompt.closed) return refuse('The Claude session is closing. Retry the message.');
        if (!turnCompleteSent) return refuse('This Claude session already has a turn in progress.');
        const requiresRestart = nextOptions.resumeAnchorId || nextOptions.resumeFromScratch
          || settingsKey(nextOptions) !== settingsKey({ ...options, toolsSettings: liveToolsSettings }) || !supportsPromptCorrelation;
        if (requiresRestart) {
          if (backgroundWork.hasOutstanding(sessionKey()) || untrackedWorkPending || automaticTurnPending) {
            return refuse('Stop background work before changing session settings, editing an earlier message, or continuing with a CLI that cannot correlate turns. Background work has been preserved.');
          }
          closing = true;
          cancelIdleRelease();
          releasePromptStream();
          await processClosed;
          return queryClaudeSDK(nextCommand, nextOptions, nextWriter, context);
        }
        // Reserve before attachment I/O so a second sender cannot enter or the
        // idle timer close stdin while a prompt is being prepared.
        turnCompleteSent = false;
        cancelIdleRelease();
        try {
          const messages = await buildPromptMessages(nextCommand, nextOptions.images, nextOptions.files, nextOptions.cwd);
          if (closing || heldPrompt.closed) {
            turnCompleteSent = true;
            return refuse('The Claude session closed while preparing the message. Retry it.');
          }
          ws = nextWriter;
          session.writer = nextWriter;
          sessionSummary = nextOptions.sessionSummary;
          assistantBudgetSent = false;
          pendingPromptId = messages[0].uuid;
          if (capturedSessionId) nextWriter.setSessionId?.(capturedSessionId);
          const done = new Promise<void>((resolve) => { resolveSubmittedTurn = resolve; });
          heldPrompt.push(messages);
          return done;
        } catch (error) {
          turnCompleteSent = true;
          scheduleRelease();
          refuse(error instanceof Error ? error.message : String(error));
        }
      };
    };
    registerSession();
    if (startupKey) startingSessions.delete(startupKey);

    // Process streaming messages
    console.log('Starting async generator loop for session:', capturedSessionId || 'NEW');
    for await (const rawMessage of queryInstance) {
      if (abortedInstances.has(queryInstance)) continue;
      const message = rawMessage as AnyRecord;
      // Capture session ID from first message
      if (message.session_id && !capturedSessionId) {

        capturedSessionId = message.session_id;
        registerSession();

        // Set session ID on writer
        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(message.session_id);
        }

        // Send session-created event only once for sessions with nothing to resume
        if (!providerSessionId && !sessionCreatedSent) {
          sessionCreatedSent = true;
          ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'claude' }));
        }
      } else {
        // session_id already captured
      }

      // Transform and normalize message via adapter
      const transformedMessage = transformMessage(message);
      const sid = capturedSessionId || sessionId || null;

      // Use adapter to normalize SDK events into NormalizedMessage[]
      const normalized = context.normalizeMessage(transformedMessage, sid);
      for (const msg of normalized) {
        // Preserve parentToolUseId from SDK wrapper for subagent tool grouping
        if (transformedMessage.parentToolUseId && !msg.parentToolUseId) {
          msg.parentToolUseId = transformedMessage.parentToolUseId;
        }
        if (isSubagentPromptEcho(msg)) {
          continue;
        }
        ws.send(msg);
      }

      // Extract and send token budget updates from assistant usage payloads,
      // falling back to the turn's cumulative bill only for SDK builds that
      // report no per-assistant usage at all.
      const tokenBudgetData = extractTokenBudget(message)
        || (assistantBudgetSent ? null : extractCumulativeTokenBudget(message));
      if (tokenBudgetData) {
        if (message.type === 'assistant') {
          assistantBudgetSent = true;
        }
        ws.send(createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget: tokenBudgetData, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
      }

      if (startsBackgroundWork(message)) {
        backgroundWorkPending = true;
      }
      if (message.type === 'system' && message.subtype === 'task_started') {
        cancelIdleRelease();
        sawTaskEventThisTurn = true;
      }
      if (message.type === 'system' && message.subtype === 'task_notification' && message.status !== 'stopped') {
        automaticTurnPending = true;
        cancelIdleRelease();
      }
      if (message.type === 'assistant' && turnCompleteSent) {
        // A spontaneous follow-up is evidence that deferred work is still alive.
        if (untrackedWorkPending) renewUntrackedWork();
        automaticTurnPending = true;
        cancelIdleRelease();
      }
      backgroundWork.apply(sessionKey(), message);

      // Stopped tasks produce no automatic follow-up result. Once the last
      // task stops, an otherwise idle conversation can start its idle timeout.
      if (
        heldForBackgroundWork
        && message.type === 'system'
        && message.subtype === 'task_notification'
        && message.status === 'stopped'
        && !backgroundWork.hasOutstanding(sessionKey())
      ) {
        heldForBackgroundWork = false;
        scheduleRelease();
      }

      if (message.type === 'result') {
        automaticTurnPending = false;
        const answeredPromptIds = [message.user_message_uuid, ...(Array.isArray(message.user_message_uuids) ? message.user_message_uuids : [])];
        const answersPendingPrompt = Boolean(pendingPromptId && answeredPromptIds.includes(pendingPromptId));
        // The initial turn may run on an older CLI. Reuse requires the echo:
        // an automatic task-result turn must never complete a newer user send.
        const isInitialLegacyResult = !turnCompleteSent && !resolveSubmittedTurn && !supportsPromptCorrelation;
        if (answersPendingPrompt) supportsPromptCorrelation = true;
        // The turn is done as far as the client is concerned.
        const abortPending = Boolean(queryInstance && abortedInstances.has(queryInstance));
        const stillOutstanding = backgroundWork.hasOutstanding(sessionKey());
        if (!turnCompleteSent && !abortPending && (answersPendingPrompt || isInitialLegacyResult)) {
          turnCompleteSent = true;
          pendingPromptId = undefined;
          const settleTurn = resolveSubmittedTurn;
          resolveSubmittedTurn = undefined;
          ws.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 0 }));
          notifyRunStopped({
            userId: ws?.userId || null,
            provider: 'claude',
            sessionId: sessionId || capturedSessionId || null,
            sessionName: sessionSummary,
            stopReason: 'completed'
          });
          settleTurn?.();
        } else if (heldForBackgroundWork && !abortPending && !stillOutstanding) {
          // A result after the turn already reported complete means the work we
          // held the process open for has finished and pushed a follow-up turn
          // — the last of it, when nothing else is still running.
          notifyBackgroundWorkCompleted({
            userId: ws?.userId || null,
            provider: 'claude',
            sessionId: sessionId || capturedSessionId || null,
            sessionName: sessionSummary
          });
        }
        // Task events are authoritative when available; deferred tools that
        // never report tasks retain the conservative launch-based fallback.
        const holdForTurn = sawTaskEventThisTurn ? stillOutstanding : backgroundWorkPending || stillOutstanding;
        // Unrelated results do not prove unknown work finished. Bound the
        // fallback hold, renewing it when deferred work launches or reports back.
        if (backgroundWorkPending && !sawTaskEventThisTurn) renewUntrackedWork();
        backgroundWorkPending = false;
        sawTaskEventThisTurn = false;
        heldForBackgroundWork = holdForTurn;
        scheduleRelease();
      } else if (idleReleaseTimer) {
        // Background activity after the turn — push the countdown back out.
        scheduleRelease();
      }
    }

    // Clean up session on completion — only while this run still owns the map
    // entry. A superseding run may have replaced it, and deleting here would
    // strand that run.
    if (sessionKey() && getSession(sessionKey())?.instance === queryInstance) {
      removeSession(sessionKey());
    }

    // A superseded run winds down silently: the map entry, the abort flag,
    // and all client-facing events belong to the run that replaced it.
    const superseded = Boolean(queryInstance && supersededInstances.has(queryInstance));

    // Send the terminal completion event — skipped for aborted runs, whose
    // terminal `complete` (aborted: true) was already sent by abort-session, and
    // for runs that already reported completion when their `result` arrived.
    const wasAborted = !superseded && queryInstance ? abortedInstances.delete(queryInstance) : false;
    if (!turnCompleteSent && !superseded) {
      turnCompleteSent = true;
      if (!wasAborted) {
        ws.send(createNormalizedMessage({ kind: 'error', content: 'Claude exited before completing the turn.', sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        ws.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 1 }));
      }
      notifyRunStopped({
        userId: ws?.userId || null,
        provider: 'claude',
        sessionId: sessionId || capturedSessionId || null,
        sessionName: sessionSummary,
        stopReason: wasAborted ? 'aborted' : 'completed'
      });
    }
    // Complete

  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    if (startup.aborted) return;

    // Clean up session on error — only while this run still owns the map entry
    // (a superseding run may have replaced it).
    if (sessionKey() && getSession(sessionKey())?.instance === queryInstance) {
      removeSession(sessionKey());
    }

    if (queryInstance && supersededInstances.has(queryInstance)) {
      // Interrupted because a newer run took over this session id; that run
      // owns the abort flag and all further client-facing events.
      return;
    }

    const wasAborted = queryInstance ? abortedInstances.delete(queryInstance) : false;
    if (wasAborted) {
      // The abort already produced the terminal complete; a generator throw
      // caused by interrupt() is expected noise, not a user-facing error.
      return;
    }

    console.error('SDK query error:', error);

    // Check if Claude CLI is installed for a clearer error message
    const installed = await context.isProviderInstalled();
    const errorContent = !installed
      ? 'Claude Code is not installed. Please install it first: https://docs.anthropic.com/en/docs/claude-code'
      : error.message;

    // Send error to WebSocket, then the terminal complete. A run that already
    // reported completion and then failed during its post-turn hold still
    // surfaces the error, but must not emit a second terminal complete.
    ws.send(createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
    if (!turnCompleteSent) {
      ws.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 1 }));
    }
    notifyRunFailed({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: sessionId || capturedSessionId || null,
      sessionName: sessionSummary,
      error
    });
  } finally {
    // Always close stdin — otherwise an aborted or failed run leaves the CLI
    // process (and its MCP servers) alive until the server exits.
    if (idleReleaseTimer) {
      clearTimeout(idleReleaseTimer);
      idleReleaseTimer = null;
    }
    if (untrackedWorkTimer) {
      clearTimeout(untrackedWorkTimer);
      untrackedWorkTimer = null;
    }
    closing = true;
    releasePromptStream();
    try { queryInstance?.close?.(); } catch (error) { console.warn('Error closing Claude query:', error); }
    if (!queryInstance || !supersededInstances.has(queryInstance)) {
      for (const resolver of pendingToolApprovals.values()) {
        if (resolver._sessionId === sessionKey()) resolver({ cancelled: true });
      }
    }
    resolveSubmittedTurn?.();
    if (startingSessions.get(startupKey) === startup) startingSessions.delete(startupKey);
    finishProcess();
  }
}

/**
 * Aborts an active SDK session
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session was aborted, false if not found
 */
export async function abortClaudeSDKSession(sessionId: string) {
  const session = getSession(sessionId);

  if (!session) {
    const starting = startingSessions.get(sessionId);
    if (starting) { starting.aborted = true; return true; }
    console.log(`Session ${sessionId} not found`);
    return false;
  }

  abortedInstances.add(session.instance);
  session.closeSubmissions?.();
  try {
    await session.instance.interrupt();
    return true;
  } catch (error) {
    console.error(`Error interrupting session ${sessionId}:`, error);
    return false;
  } finally {
    // Dispose even if interrupt fails: an aborted session must not retain a
    // process, MCP servers, pending permissions, or an input consumer.
    session.releaseInput?.();
    try { session.instance.close?.(); } catch (error) { console.warn('Error closing Claude query:', error); }
    session.status = 'aborted';
    if (getSession(sessionId) === session) removeSession(sessionId);
  }
}

/**
 * Sessions whose background tasks are still outstanding, with the tasks.
 *
 * A session stays here after its turn's `result` for as long as the process
 * is held open for the work — which is exactly the window in which nothing
 * else (the chat run registry marks the run completed at `result`) knows the
 * session is still busy.
 * @returns {Array<{ sessionId: string, tasks: Array<import('@/shared/types.js').BackgroundTaskSummary> }>}
 */
export function listClaudeSDKBackgroundWork() {
  return backgroundWork.list();
}

/**
 * Stops one outstanding background task through the SDK, which then emits a
 * `task_notification` with status `stopped` — the same event that drops the
 * task from the tracker and settles its card.
 * @param {string} sessionId - Session identifier
 * @param {string} taskId - The task's `task_id` as reported on `task_started`
 * @returns {Promise<boolean>} False when no live process is tracking the task
 */
export async function stopClaudeSDKTask(sessionId: string, taskId: string) {
  const session = getSession(sessionId);
  if (!session?.instance.stopTask || !backgroundWork.has(sessionId, taskId)) {
    return false;
  }
  await session.instance.stopTask(taskId);
  return true;
}

/**
 * Checks if an SDK session is currently active
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session is active
 */
export function isClaudeSDKSessionActive(sessionId: string) {
  const session = getSession(sessionId);
  return Boolean(session && session.status === 'active');
}

/**
 * When the run behind a session started, or null when no run is up.
 *
 * The history reader uses this to tell a background agent launched by the
 * live process (still able to report back) from one launched by an earlier
 * process that has since exited (never will): a launch row older than the
 * live run cannot belong to it.
 * @param {string} sessionId - Session identifier
 * @returns {number|null} Epoch milliseconds the live run started, or null
 */
export function getClaudeSDKSessionStartTime(sessionId: string) {
  const session = getSession(sessionId);
  return session && session.status === 'active' ? session.startTime : null;
}

/**
 * Gets all active SDK session IDs
 * @returns {Array<string>} Array of active session IDs
 */
export function getActiveClaudeSDKSessions() {
  return getAllSessions();
}

/**
 * Get pending tool approvals for a specific session.
 * @param {string} sessionId - The session ID
 * @returns {Array} Array of pending permission request objects
 */
export function getPendingApprovalsForSession(sessionId: string) {
  const pending = [];
  for (const [requestId, resolver] of pendingToolApprovals.entries()) {
    if (resolver._sessionId === sessionId) {
      pending.push({
        requestId,
        toolName: resolver._toolName || 'UnknownTool',
        input: resolver._input,
        context: resolver._context,
        sessionId,
        receivedAt: resolver._receivedAt || new Date(),
      });
    }
  }
  return pending;
}

/**
 * Reconnect a session's WebSocketWriter to a new raw WebSocket.
 * Called when client reconnects (e.g. page refresh) while SDK is still running.
 * @param {string} sessionId - The session ID
 * @param {Object} newRawWs - The new raw WebSocket connection
 * @returns {boolean} True if writer was successfully reconnected
 */
export function reconnectSessionWriter(sessionId: string, newRawWs: RealtimeClientConnection) {
  const session = getSession(sessionId);
  if (!session?.writer?.updateWebSocket) return false;
  session.writer.updateWebSocket(newRawWs);
  console.log(`[RECONNECT] Writer swapped for session ${sessionId}`);
  return true;
}

/** Used by the Claude provider to expose its runtime and permission gateway. */
export const claudeRuntime = {
  run: queryClaudeSDK,
  abort: abortClaudeSDKSession,
  permissions: {
    resolve: resolveToolApproval,
    listPending: getPendingApprovalsForSession,
  },
  listBackgroundWork: listClaudeSDKBackgroundWork,
  stopBackgroundTask: stopClaudeSDKTask,
};
