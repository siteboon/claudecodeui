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

import { turnDurationsDb } from '@/modules/database/index.js';
import {
  appendFilesInputTag,
  buildClaudeUserContent,
  normalizeImageDescriptors
} from '@/shared/image-attachments.js';
import {
  HeldClaudeSession,
  getHeldSession,
  holdSession,
  stableJson,
} from '@/modules/providers/list/claude/claude-held-session.js';
import {
  CLAUDE_PREDEFINED_MODELS,
  CLAUDE_ULTRACODE_EFFORT
} from '@/modules/providers/list/claude/claude-models.provider.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import {
  createNotificationEvent,
  notifyBackgroundWorkCompleted,
  notifyRunFailed,
  notifyRunStopped,
  notifyUserIfEnabled
} from '@/modules/notifications/index.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

const activeSessions = new Map();
const pendingToolApprovals = new Map();
// Sessions cancelled via abort-session. The abort handler already sent the
// terminal `complete` (aborted: true) to the client, so the run loop must not
// emit a second one when its generator winds down.
const abortedSessionIds = new Set();
// Query instances interrupted because a newer run took over their session id
// (see addSession). Their run loops must stay silent on wind-down: the map
// entry, the abort flag, and all client-facing events belong to the new run.
const supersededInstances = new WeakSet();

const TOOL_APPROVAL_TIMEOUT_MS = parseInt(process.env.CLAUDE_TOOL_APPROVAL_TIMEOUT_MS, 10) || 55000;

// How long background work is allowed to keep running after a turn ends. This drives
// two halves of the same behaviour:
//
//  1. Passed to the spawned CLI as CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, which is how
//     long it waits for still-running background *agents* before killing them.
//  2. A backstop on how long we hold the SDK's stdin open after a turn's `result`.
//     The SDK closes stdin as soon as a turn ends, and the CLI reads that EOF as
//     "print wind-down" — killing background *shells* after a short grace period,
//     which the ceiling above does not cover. Holding stdin open also lets the CLI
//     push follow-up turns (background-task completions, Monitor notifications,
//     scheduled wake-ups).
//
// The hold normally ends long before this: a turn with nothing outstanding closes
// stdin immediately, background work releases it as soon as it reports back, and a
// new turn supersedes the previous hold. This only catches background work that
// never reports at all, so an abandoned session cannot leak a CLI process forever.
const BG_WAIT_CEILING_MS = 30 * 60 * 1000;

// The hold is bounded by two independent timers, because one cannot express both
// limits. The idle timer is pushed back by every frame that arrives, so it asks
// "has anything happened lately?"; on its own it means a chatty job holds the
// process for as long as it keeps talking, with no upper bound at all. The total
// timer is armed once, when the hold starts, and is never pushed back, so it asks
// "how long has this been held?". Whichever expires first releases the hold.
//
// They are deliberately far apart. Silence is weak evidence — a build or a large
// download can legitimately say nothing for a long time — so the idle limit stays
// generous, and the total limit is what actually stops an abandoned session from
// pinning a CLI process indefinitely.
const BG_IDLE_RELEASE_MS = BG_WAIT_CEILING_MS;
const BG_TOTAL_HOLD_MS = 2 * 60 * 60 * 1000;

/**
 * The pair of timers that bound a held run, as a unit so the rule "whichever
 * expires first wins" lives in one place rather than in a closure inside the
 * run loop.
 *
 * @param {Object} options
 * @param {Function} options.onRelease - Called once, by whichever timer expires first.
 * @param {number} [options.idleMs] - Silence allowed since the last frame.
 * @param {number} [options.totalMs] - Total time allowed since the hold started.
 * @returns {{ schedule: Function, clear: Function, release: Function, isArmed: Function }}
 */
function createHoldTimers({ onRelease, idleMs = BG_IDLE_RELEASE_MS, totalMs = BG_TOTAL_HOLD_MS }) {
  let idleTimer = null;
  let totalTimer = null;

  const clear = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (totalTimer) {
      clearTimeout(totalTimer);
      totalTimer = null;
    }
  };

  // Both timers land here, so a release is idempotent and neither can fire
  // after the other has already torn the hold down. The reason is passed on
  // because "the hold ended" and "the hold ended because nothing happened for
  // half an hour" are different facts when reading a log after the event.
  const release = (reason = 'explicit') => {
    clear();
    onRelease(reason);
  };

  const schedule = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => release('idle_timeout'), idleMs);
    // Never let the hold keep the server process alive on its own.
    idleTimer.unref?.();

    // Armed once and deliberately not re-armed: pushing it back on activity
    // would collapse it into a second idle timer and restore the unbounded
    // window this pair exists to close.
    if (!totalTimer) {
      totalTimer = setTimeout(() => release('total_ceiling'), totalMs);
      totalTimer.unref?.();
    }
  };

  // Whether a hold is currently counting down. Not the same as
  // `heldForBackgroundWork`, which stays set after a timer has fired on its own
  // — asking the timers avoids re-arming a hold over an already-closed stream.
  const isArmed = () => idleTimer !== null || totalTimer !== null;

  return { schedule, clear, release, isArmed };
}

const TOOLS_REQUIRING_INTERACTION = new Set(['AskUserQuestion', 'ExitPlanMode']);

// Ultracode is a session-scoped setting rather than an SDK effort level: it pairs xhigh
// effort with standing dynamic-workflow orchestration, and the CLI only honours it when
// Workflows are enabled. The catalog offers it as an effort choice for the picker, so the
// selection is translated back into the two options the SDK actually understands here.
const ULTRACODE_SDK_EFFORT = 'xhigh';
// The SDK forwards the CLI child's stderr through an explicit callback
// (`options.stderr`). This provider never set it, so that output was dropped
// on the floor — including the one line the CLI writes when it winds itself
// down:
//
//     Background tasks still running after <N>s; terminating.
//     Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely.
//
// That message therefore never reached the service log, which is why a run
// ended by the background-wait ceiling looks, from the outside, exactly like
// a run that vanished without a trace. Wiring the callback is what turns that
// guess into a reading.
//
// The same channel also carries SDK debug output, so it is forwarded under
// three limits. None of them is cosmetic:
//
//   1. Redaction before logging — stderr can carry argv fragments and paths.
//   2. A length cap per line — one runaway line must not swamp the journal.
//   3. A rate limit per RUN — a CLI stuck in a write loop would otherwise
//      flood the log. The counters live in the run's closure and die with it;
//      a per-session map would need someone to clean it up, and that is
//      exactly the kind of bookkeeping that gets forgotten.
const CLI_STDERR_MAX_LINE_CHARS = 500;
const CLI_STDERR_MAX_LINES_PER_WINDOW = 50;
const CLI_STDERR_WINDOW_MS = 60 * 1000;
// Upper bound on a partial line held back between chunks. The SDK forwards raw
// `data` events, so a logical line can arrive in pieces; without a bound, a
// stream that never emits a newline would grow this buffer without limit.
const CLI_STDERR_MAX_PENDING_CHARS = 8 * 1024;

// Redaction runs BEFORE truncation. Truncating first can cut a secret in half
// and leave the tail in place: the pattern no longer matches, so the filter
// stops working silently on exactly the line that needed it.
const CLI_STDERR_REDACTIONS = [
  /-----BEGIN[^-]{0,40}PRIVATE KEY-----/g,
  /\b(sk|pk|ghp|gho|ghs|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{12,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
  /api\.telegram\.org\/bot[^/\s]+/g,
  /[A-Za-z0-9_-]*(TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|APIKEY)[A-Za-z0-9_-]*\s*[=:]\s*\S+/gi,
];

/**
 * Redacts well-known secret shapes from one line of CLI stderr.
 *
 * @param {string} text - Raw stderr text.
 * @returns {string} The same text with secret-shaped runs replaced.
 */
function redactCliStderr(text) {
  let out = String(text);
  for (const pattern of CLI_STDERR_REDACTIONS) {
    out = out.replace(pattern, '<redacted>');
  }
  return out;
}

/**
 * Formats one CLI stderr line for the service log: redact, then cap.
 *
 * Kept as a pure function so both halves are testable on their own. The order
 * matters and is the reason this is one function rather than two calls at the
 * call site: capping first could split a secret and leave its tail readable.
 *
 * @param {string} sessionTag - Short session identifier for correlation.
 * @param {string} line - One raw stderr line, already trimmed.
 * @returns {string} The line to hand to the logger.
 */
// A PEM block spans many lines: a header, then base64 body lines that carry
// the actual key material, then a footer. The single-line pattern above only
// ever sees the header, so redacting line by line would blank the header and
// print the key underneath it -- the worst of both worlds, because the log
// then *looks* redacted.
const PEM_BEGIN = /-----BEGIN[^-]{0,40}PRIVATE KEY-----/;
const PEM_END = /-----END[^-]{0,40}PRIVATE KEY-----/;
const PEM_PLACEHOLDER = '<redacted private key>';

/**
 * Formats stderr lines, suppressing whole PEM private-key blocks.
 *
 * Stateful by necessity: whether a base64 line is key material or ordinary
 * output cannot be decided from the line itself. The state lives per run and
 * dies with it.
 *
 * @param {() => string} sessionTag - Supplies the current session tag.
 * @returns {(line: string) => string} Formatter for one stderr line.
 */
function createCliStderrFormatter(sessionTag) {
  let insidePem = false;
  return (line) => {
    if (insidePem) {
      if (PEM_END.test(line)) {
        insidePem = false;
      }
      return formatCliStderrLine(sessionTag(), PEM_PLACEHOLDER);
    }
    if (PEM_BEGIN.test(line)) {
      // A line carrying the whole block at once closes it again immediately.
      insidePem = !PEM_END.test(line);
      return formatCliStderrLine(sessionTag(), PEM_PLACEHOLDER);
    }
    return formatCliStderrLine(sessionTag(), line);
  };
}

/**
 * Reassembles complete lines from raw stderr chunks.
 *
 * The SDK forwards the child's `stderr` `data` events verbatim — it calls
 * `options.stderr` straight from the data handler, with no line framing. A
 * logical line can therefore arrive split across two chunks, and a secret
 * split that way slips past redaction because neither half matches the
 * pattern on its own.
 *
 * Kept as a factory so the buffering is testable on its own: this is exactly
 * the kind of state that is easy to get subtly wrong and impossible to see
 * afterwards in a log that looks plausible.
 *
 * @param {(line: string) => void} emit - Receives each complete line.
 * @param {number} [maxPending] - Cap on a held-back fragment.
 * @returns {{push: (chunk: string) => void, flush: () => void}}
 */
function createCliStderrChunker(emit, maxPending = CLI_STDERR_MAX_PENDING_CHARS) {
  let pending = '';
  return {
    push(chunk) {
      pending += String(chunk ?? '');
      // A stream that never emits a newline must not grow this buffer forever.
      // Flushing early can in principle split a secret, but at this size that
      // needs a line two orders of magnitude longer than any credential
      // format — unbounded memory is the worse failure.
      if (pending.length > maxPending && !pending.includes('\n')) {
        emit(pending);
        pending = '';
        return;
      }
      const parts = pending.split('\n');
      pending = parts.pop() ?? '';
      for (const line of parts) {
        emit(line);
      }
    },
    // Anything still buffered is a real line; it just never got its newline
    // before the run ended.
    flush() {
      if (pending) {
        emit(pending);
        pending = '';
      }
    },
  };
}

/**
 * Rate-limits CLI stderr without letting the redaction state fall behind.
 *
 * The throttle and the PEM-block formatter are each correct on their own. The
 * bug lived at their handover: the formatter used to be called only for lines
 * that survived the throttle, so a suppressed END marker left `insidePem`
 * stuck and every later line of the run came out as the placeholder. State
 * must advance for EVERY line; only the writing is rate-limited.
 *
 * Kept as a factory for the same reason as the chunker above: this is state
 * that is easy to get subtly wrong and impossible to see afterwards in a log
 * that looks plausible.
 *
 * @param {object} deps
 * @param {(line: string) => string} deps.format - Stateful line formatter.
 * @param {(text: string) => void} deps.sink - Receives lines that pass.
 * @param {(dropped: number) => void} deps.throttleNotice - Reports losses.
 * @param {() => number} [deps.now] - Clock, injectable for tests.
 * @returns {{push: (line: string) => void, flushDropped: () => void}}
 */
function createCliStderrEmitter({ format, sink, throttleNotice, now = Date.now }) {
  let windowStart = 0;
  let linesInWindow = 0;
  let dropped = 0;

  // A throttle that hides its own losses is a log that lies.
  const flushDropped = () => {
    if (dropped > 0) {
      throttleNotice(dropped);
      dropped = 0;
    }
  };

  const push = (rawLine) => {
    const line = String(rawLine ?? '').trim();
    if (!line) {
      return;
    }
    // BEFORE the throttle, unconditionally: the formatter carries the PEM
    // block state across lines. Skipping it for a dropped line would lose the
    // END marker and silently redact the rest of the run.
    const formatted = format(line);
    const stamp = now();
    if (stamp - windowStart >= CLI_STDERR_WINDOW_MS) {
      // Report what the previous window swallowed before opening a new one.
      flushDropped();
      windowStart = stamp;
      linesInWindow = 0;
    }
    if (linesInWindow >= CLI_STDERR_MAX_LINES_PER_WINDOW) {
      dropped += 1;
      return;
    }
    linesInWindow += 1;
    sink(formatted);
  };

  return { push, flushDropped };
}


function formatCliStderrLine(sessionTag, line) {
  const safe = redactCliStderr(line);
  const capped = safe.length > CLI_STDERR_MAX_LINE_CHARS
    ? `${safe.slice(0, CLI_STDERR_MAX_LINE_CHARS - 1)}\u2026`
    : safe;
  return `[claude-cli-stderr] ${sessionTag} ${capped}`;
}

function resolveClaudeEffort(model, effort, modelsDefinition = CLAUDE_PREDEFINED_MODELS) {
  const selectedModel = modelsDefinition?.OPTIONS?.find((option) => option.value === model) || null;
  const allowedEfforts = selectedModel?.effort?.values
    ?.map((value) => value.value) || [];
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
function applyClaudeEffort(sdkOptions, resolvedEffort) {
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

function waitForToolApproval(requestId, options = {}) {
  const { timeoutMs = TOOL_APPROVAL_TIMEOUT_MS, signal, onCancel, metadata } = options;

  return new Promise(resolve => {
    let settled = false;

    const finalize = (decision) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(decision);
    };

    let timeout;

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

    const resolver = (decision) => {
      finalize(decision);
    };
    // Attach metadata for getPendingApprovalsForSession lookup
    if (metadata) {
      Object.assign(resolver, metadata);
    }
    pendingToolApprovals.set(requestId, resolver);
  });
}

function resolveToolApproval(requestId, decision) {
  const resolver = pendingToolApprovals.get(requestId);
  if (resolver) {
    resolver(decision);
  }
}

// Match stored permission entries against a tool + input combo.
// This only supports exact tool names and the Bash(command:*) shorthand
// used by the UI; it intentionally does not implement full glob semantics,
// introduced to stay consistent with the UI's "Allow rule" format.
function matchesToolPermission(entry, toolName, input) {
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

function mapCliOptionsToSDK(options = {}) {
  const { providerSessionId, cwd, toolsSettings, permissionMode, effort, resumeAnchorId, resumeFromScratch } = options;

  const sdkOptions = {};

  // Forward all host env vars (e.g. ANTHROPIC_BASE_URL) to the subprocess.
  // Since SDK 0.2.113, options.env replaces process.env instead of overlaying it.
  sdkOptions.env = { ...process.env, CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: String(BG_WAIT_CEILING_MS) };

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
    const planModeTools = ['Read', ...SUBAGENT_TOOL_NAMES, 'exit_plan_mode', 'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch'];
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
function addSession(sessionId, queryInstance, writer = null, releaseInput = null) {
  const existing = activeSessions.get(sessionId);
  // A different live instance under the same key means an earlier run was
  // superseded without being stopped (e.g. an abort that raced run setup and
  // found nothing to interrupt). Overwriting it here would strand its
  // generator forever — this map entry is the only handle for interrupting
  // it. Stop it directly rather than via abortClaudeSDKSession, whose
  // session-keyed abortedSessionIds flag would be consumed by the new run
  // and suppress its terminal `complete`.
  const superseding = Boolean(
    existing && existing.status === 'active' && existing.instance && existing.instance !== queryInstance
  );
  if (superseding) {
    supersededInstances.add(existing.instance);
    Promise.resolve()
      .then(() => existing.instance.interrupt())
      .catch((error) => {
        console.error(`Error interrupting superseded run for session ${sessionId}:`, error?.message || error);
      });
    existing.releaseInput?.();
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
}

/**
 * Removes a session from the active sessions map
 * @param {string} sessionId - Session identifier
 */
function removeSession(sessionId) {
  activeSessions.delete(sessionId);
}

/**
 * Gets a session from the active sessions map
 * @param {string} sessionId - Session identifier
 * @returns {Object|undefined} Session data or undefined
 */
function getSession(sessionId) {
  return activeSessions.get(sessionId);
}

/**
 * Gets all active session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getAllSessions() {
  return Array.from(activeSessions.keys());
}

/**
 * Emits one greppable line per lifecycle transition of a Claude run.
 *
 * The Agent SDK owns the CLI child process, so this provider never holds a
 * process handle: the *run* is the smallest unit it can observe. These records
 * therefore report when a run started, which session it belonged to, who owned
 * it, and how and why it ended.
 *
 * @param {string} event - Lifecycle transition: run_start, session_created,
 *   abort_requested or run_end.
 * @param {Object} fields - Event payload; serialized as JSON so log processors
 *   can parse it without a format-specific reader.
 */
function logRunLifecycle(event, fields) {
  console.log(`[Claude SDK] lifecycle ${event}`, JSON.stringify(fields));
}

/**
 * Transforms SDK messages to WebSocket format expected by frontend
 * @param {Object} sdkMessage - SDK message object
 * @returns {Object} Transformed message ready for WebSocket
 */
function transformMessage(sdkMessage) {
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
export function isSubagentPromptEcho(message) {
  return Boolean(message?.parentToolUseId) && message.role === 'user' && message.kind === 'text';
}

function readNumber(value) {
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
// The window the SDK last reported for a session, learned from a `result`
// frame. Assistant messages carry usage but no window, and once a turn has sent
// a budget from assistant usage its `result` is skipped for budget purposes —
// so the one frame that knows the real window would otherwise be read and
// thrown away. Bounded because it outlives the runs that fill it.
const reportedContextWindows = new Map();
const MAX_REMEMBERED_CONTEXT_WINDOWS = 200;

// Conversations known to have work that repeats. Kept here rather than in the
// run's closure because the turn that arms a cron and the tick that fires an
// hour later are different runs, and the second one has no way to know what the
// first did. Bounded the same way, and least-recently-used.
const recurringSessions = new Map();
const MAX_REMEMBERED_RECURRING = 200;

function rememberRecurring(key) {
  if (!key) {
    return;
  }
  recurringSessions.delete(key);
  recurringSessions.set(key, true);
  while (recurringSessions.size > MAX_REMEMBERED_RECURRING) {
    recurringSessions.delete(recurringSessions.keys().next().value);
  }
}

function forgetRecurring(key) {
  if (key) {
    recurringSessions.delete(key);
  }
}

function rememberContextWindow(key, window) {
  if (!key || !(window > 0)) {
    return;
  }
  // Re-inserted so the map stays in least-recently-used order.
  reportedContextWindows.delete(key);
  reportedContextWindows.set(key, window);
  while (reportedContextWindows.size > MAX_REMEMBERED_CONTEXT_WINDOWS) {
    reportedContextWindows.delete(reportedContextWindows.keys().next().value);
  }
}

/**
 * The window to divide by, preferring what the SDK reported for this run.
 *
 * `CONTEXT_WINDOW` stays as a manual override, but it is a single global number
 * and every session shares it — set for a 1M model it overstates a 200k one by
 * five times, which reads as a quarter full when the session is nearly ready to
 * compact. It is now the fallback, not the source.
 *
 * @param {number} [reported] - Window the SDK reported, when it did
 * @returns {number} Window to divide by
 */
function resolveContextWindow(reported) {
  if (Number.isFinite(reported) && reported > 0) {
    return reported;
  }
  return parseInt(process.env.CONTEXT_WINDOW, 10) || 200000;
}

/**
 * Reads the real context window out of a `result` frame.
 *
 * `modelUsage` is keyed by model and each entry carries its own window, so a
 * session that ran a subagent on a different model has more than one. The
 * conversation's own model is the one that accumulated the tokens, which is
 * what the bar is about.
 *
 * @param {Object} sdkMessage - SDK stream message
 * @returns {number} Window in tokens, or 0 when the frame does not carry one
 */
function readReportedContextWindow(sdkMessage) {
  const modelUsage = sdkMessage?.modelUsage;
  if (!modelUsage || typeof modelUsage !== 'object') {
    return 0;
  }

  let best = 0;
  let bestTokens = -1;
  for (const entry of Object.values(modelUsage)) {
    const window = readNumber(entry?.contextWindow);
    if (window <= 0) {
      continue;
    }
    const tokens = readNumber(entry?.inputTokens) + readNumber(entry?.outputTokens);
    if (tokens > bestTokens) {
      best = window;
      bestTokens = tokens;
    }
  }
  return best;
}

function buildTokenBudget(messageUsage, reportedContextWindow) {
  const directInputTokens = readNumber(messageUsage.input_tokens ?? messageUsage.inputTokens);
  const cacheCreationTokens = readNumber(messageUsage.cache_creation_input_tokens ?? messageUsage.cacheCreationInputTokens ?? messageUsage.cacheCreationTokens);
  const cacheReadTokens = readNumber(messageUsage.cache_read_input_tokens ?? messageUsage.cacheReadInputTokens ?? messageUsage.cacheReadTokens);
  const cacheTokens = cacheCreationTokens + cacheReadTokens;
  const inputTokens = directInputTokens + cacheTokens;
  const outputTokens = readNumber(messageUsage.output_tokens ?? messageUsage.outputTokens);
  const contextWindow = resolveContextWindow(reportedContextWindow);

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
 * @param {number} [knownContextWindow] - Window last reported for this session
 * @returns {TokenBudget|null} Token budget object or null
 */
function extractTokenBudget(sdkMessage, knownContextWindow) {
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

  return buildTokenBudget(messageUsage, knownContextWindow);
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
function extractCumulativeTokenBudget(sdkMessage) {
  if (!sdkMessage || typeof sdkMessage !== 'object' || sdkMessage.type !== 'result') {
    return null;
  }

  const reportedWindow = readReportedContextWindow(sdkMessage);

  if (sdkMessage.usage && typeof sdkMessage.usage === 'object') {
    return buildTokenBudget(sdkMessage.usage, reportedWindow);
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
  const contextWindow = resolveContextWindow(reportedWindow);

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

/**
 * @typedef {Object} RateLimitWindow
 * @property {string} type - `five_hour`, `seven_day`, `seven_day_opus`, ...
 * @property {number} utilization - Fraction of the window spent, 0..1
 * @property {number|null} resetsAt - Epoch seconds when the window rolls over
 */

/**
 * Reads the account's subscription quota out of a `rate_limit_event` frame.
 *
 * A different number from the token budget sitting next to it in the composer,
 * and the two are easy to confuse: the budget is how full *this session's*
 * context window is, the quota is how much of the *account's* five-hour and
 * weekly allowance is gone. Nothing consumed this event before, so it fell into
 * the unknown branch and was dropped.
 *
 * `unifiedWindows` is what gets displayed: it carries every window at once,
 * while the flat `rateLimitType` names only the active one. It is absent from
 * the SDK's published `SDKRateLimitInfo` but present on the wire (verified on
 * claude 2.1.272), so the flat pair stays as the fallback. `utilization` is a
 * fraction, not a percent — the display multiplies.
 *
 * @param {Object} sdkMessage - SDK stream message
 * @returns {{status: string, activeWindow: string|null, resetsAt: number|null, windows: RateLimitWindow[], overage: Object}|null}
 */
function extractRateLimit(sdkMessage) {
  if (!sdkMessage || typeof sdkMessage !== 'object' || sdkMessage.type !== 'rate_limit_event') {
    return null;
  }

  const info = sdkMessage.rate_limit_info;
  if (!info || typeof info !== 'object') {
    return null;
  }

  const readEpoch = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  const unified = info.unifiedWindows && typeof info.unifiedWindows === 'object'
    ? info.unifiedWindows
    : null;
  const windows = unified
    ? Object.entries(unified)
      .filter(([, window]) => window && typeof window === 'object')
      .map(([type, window]) => ({
        type,
        utilization: readNumber(window.utilization),
        resetsAt: readEpoch(window.resetsAt),
      }))
    : [];

  if (windows.length === 0 && info.rateLimitType) {
    windows.push({
      type: String(info.rateLimitType),
      utilization: readNumber(info.utilization),
      resetsAt: readEpoch(info.resetsAt),
    });
  }

  return {
    status: typeof info.status === 'string' ? info.status : 'allowed',
    activeWindow: info.rateLimitType ? String(info.rateLimitType) : null,
    resetsAt: readEpoch(info.resetsAt),
    windows,
    overage: {
      status: typeof info.overageStatus === 'string' ? info.overageStatus : null,
      resetsAt: readEpoch(info.overageResetsAt),
      disabledReason: typeof info.overageDisabledReason === 'string' ? info.overageDisabledReason : null,
      inUse: info.isUsingOverage === true,
    },
  };
}

// Every name the subagent-spawning tool has been known by. Claude Code renamed
// it Task -> Agent; `Agent` is what arrives now and `Task` is what pre-rename
// transcripts still hold, and those are read forever. Kept as one list because
// a name-keyed decision that misses a name fails silently — nothing throws,
// nothing logs, the rule just stops applying. The frontend keeps the same list
// in src/modules/chat/tools/toolAliases.ts; the two build roots cannot share a
// module, so they share a name instead.
const SUBAGENT_TOOL_NAMES = new Set(['Agent', 'Task']);

// Tool calls that leave work running past the end of a turn. Bash and Agent are
// decided by their input instead (see below); the rest defer, watch, or
// orchestrate work by nature. `Workflow` always runs in the background and can
// take tens of minutes.
const DEFERRED_WORK_TOOLS = new Set(['Monitor', 'ScheduleWakeup', 'CronCreate', 'TaskCreate', 'Workflow']);

// Work that repeats by design rather than finishing. A recurring cron and an
// armed Monitor both go quiet between ticks, so silence never means they are
// done — and the usual "nothing has happened lately, let the process go" rule
// is exactly wrong for them. `/loop 10m` died this way: one tick, then the
// process was released and the in-process cron went with it.
const RECURRING_WORK_TOOLS = new Set(['Monitor']);

/**
 * Detects tool calls that will keep firing until something stops them.
 *
 * @param {Object} sdkMessage - SDK stream message
 * @returns {boolean} True when the message arms work that repeats
 */
function startsRecurringWork(sdkMessage) {
  const content = sdkMessage?.message?.content;
  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((block) => {
    if (block?.type !== 'tool_use') {
      return false;
    }
    if (block.name === 'CronCreate') {
      // A one-shot schedule is ordinary background work; only a repeating one
      // has no ending to wait for.
      return block.input?.recurring === true;
    }
    return RECURRING_WORK_TOOLS.has(block.name);
  });
}

/**
 * What a turn's `result` should do with the process that served it.
 *
 * Three cases, and the middle one is the whole of T8. Work that repeats has no
 * `result` meaning "done" — each tick is one of a series — so reading the tick
 * as the work reporting back is what released the process on the very message
 * that proved the job alive.
 *
 * @param {Object} state
 * @param {boolean} state.backgroundWorkPending - This turn started work that outlives it
 * @param {boolean} state.recurring - The conversation runs work that repeats
 * @returns {'arm'|'rearm'|'release'} What to do with the hold
 */
function decideHoldAfterResult({ backgroundWorkPending, recurring }) {
  if (backgroundWorkPending) {
    return 'arm';
  }
  // Checked after, not before: a turn that both ticks a cron and starts new
  // work is arming for the new work, and `arm` is the stronger of the two.
  if (recurring) {
    return 'rearm';
  }
  return 'release';
}

/**
 * Detects tool calls that stop work which repeats.
 *
 * @param {Object} sdkMessage - SDK stream message
 * @returns {boolean} True when the message stands down a repeating job
 */
function stopsRecurringWork(sdkMessage) {
  const content = sdkMessage?.message?.content;
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((block) => block?.type === 'tool_use' && block.name === 'CronDelete');
}

/**
 * Detects tool calls that keep working after the turn's `result` arrives.
 *
 * Only turns that start background work need their CLI process held open; every
 * other turn can let it exit immediately, as it did before the hold existed.
 *
 * @param {Object} sdkMessage - SDK stream message
 * @returns {boolean} True when the message launches work that outlives the turn
 */
function startsBackgroundWork(sdkMessage) {
  const content = sdkMessage?.message?.content;
  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((block) => {
    if (block?.type !== 'tool_use') {
      return false;
    }
    // Two tools carry the answer in their input rather than their name, and
    // their defaults are opposites: a shell command runs in the foreground
    // unless asked otherwise, a subagent runs in the background unless asked
    // otherwise. Reading the name alone would get one of them wrong either way.
    if (block.name === 'Bash') {
      return block.input?.run_in_background === true;
    }
    if (SUBAGENT_TOOL_NAMES.has(block.name)) {
      return block.input?.run_in_background !== false;
    }
    return DEFERRED_WORK_TOOLS.has(block.name);
  });
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
async function buildPromptMessages(command, images, files, cwd) {
  const promptWithFiles = appendFilesInputTag(command, files);
  const content = normalizeImageDescriptors(images).length === 0
    ? promptWithFiles
    : await buildClaudeUserContent(promptWithFiles, images, cwd);

  return [{
    type: 'user',
    message: {
      role: 'user',
      content
    },
    parent_tool_use_id: null,
    timestamp: new Date().toISOString()
  }];
}

/**
 * Wraps prompt messages in an async iterable that yields them and then parks.
 *
 * The SDK closes the CLI's stdin as soon as its input iterable is exhausted (and
 * immediately on `result` for string prompts). The CLI reads that EOF as the end
 * of the run and kills anything still going in the background, so the iterable
 * has to stay pending until we actually want the process gone.
 *
 * @param {Array<Object>} messages - SDKUserMessage records to send
 * @returns {{ stream: AsyncIterable, release: () => void }} Stream plus its closer
 */
function createHeldPromptStream(messages) {
  let release;
  const held = new Promise((resolve) => { release = resolve; });

  const stream = (async function* () {
    for (const message of messages) {
      yield message;
    }
    // Keeps stdin open — the CLI stays alive until release() is called.
    await held;
  })();

  return { stream, release };
}

/**
 * Loads MCP server configurations from ~/.claude.json
 * @param {string} cwd - Current working directory for project-specific configs
 * @returns {Object|null} MCP servers object or null if none found
 */
async function loadMcpConfig(cwd) {
  try {
    const claudeConfigPath = path.join(os.homedir(), '.claude.json');

    // Check if config file exists
    try {
      await fs.access(claudeConfigPath);
    } catch (error) {
      // File doesn't exist, return null
      // No config file
      return null;
    }

    // Read and parse config file
    let claudeConfig;
    try {
      const configContent = await fs.readFile(claudeConfigPath, 'utf8');
      claudeConfig = JSON.parse(configContent);
    } catch (error) {
      console.error('Failed to parse ~/.claude.json:', error.message);
      return null;
    }

    // Extract MCP servers (merge global and project-specific)
    let mcpServers = {};

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
  } catch (error) {
    console.error('Error loading MCP config:', error.message);
    return null;
  }
}

/**
 * Executes a Claude query using the SDK
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @param {Object} context - Provider-scoped model, session, and auth lookups
 * @returns {Promise<void>}
 */
async function queryClaudeSDK(command, options = {}, ws, context) {
  const { sessionId, sessionSummary } = options;
  // Callers pass the stable app session id; the SDK only understands the
  // provider-native id recorded on the session row.
  const providerSessionId = context.resolveProviderSessionId(sessionId);
  // Provider-native id as the SDK reports it (starts as the resume id, or is
  // captured from the stream for brand-new sessions).
  let capturedSessionId = providerSessionId;
  let sessionCreatedSent = false;
  // Process-map key: the app session id when the caller supplied one, else
  // the provider-native id once captured (legacy/direct API callers).
  const sessionKey = () => sessionId || capturedSessionId || null;
  // Short, greppable session tag for the CLI stderr lines below.
  const sessionTag = () => String(sessionKey() || 'unknown').slice(0, 8);
  // Rate-limit state for CLI stderr. Scoped to this run, dies with this run.
  // Assigned once the SDK options are built; the cleanup path needs both.
  let stderrChunker = null;
  let stderrEmitter = null;
  // Wall-clock start of this run, so every run_end can report a duration.
  const runStartedAt = Date.now();
  // Guarantees exactly one terminal lifecycle record per run: the success path
  // emits run_end before the notification calls, and a throw from one of those
  // would otherwise reach the catch and log a second, contradicting one.
  let runEndLogged = false;
  const logRunEnd = (fields) => {
    if (runEndLogged) {
      return;
    }
    runEndLogged = true;
    logRunLifecycle('run_end', {
      sessionKey: sessionKey(),
      providerSessionId: capturedSessionId || null,
      userId: ws?.userId || null,
      ...fields
    });
  };

  const emitNotification = (event) => {
    notifyUserIfEnabled({
      userId: ws?.userId || null,
      writer: ws,
      event
    });
  };

  // Closes the held stdin stream so the CLI can wind down. Replaced once the
  // stream exists; the finally block calls it no matter how the run ends.
  let releasePromptStream = () => {};
  // Assigned below, once releasePromptStream is known to the closure.
  let holdTimers = null;
  // When the hold started, so a release can say how long it lasted. The two
  // limits are far apart, and which one fired is the whole question when a
  // background job turns out to have been cut off.
  let holdArmedAt = null;
  // The client is told the turn is over as soon as `result` lands, even though
  // the process lingers, so the UI never waits out the idle hold.
  let turnCompleteSent = false;
  // Set when a turn starts background work, cleared when the next `result`
  // arrives — only turns with work still outstanding hold their process open.
  let backgroundWorkPending = false;
  // True while the process is being held open for background work, so a later
  // `result` can be recognised as that work reporting back.
  let heldForBackgroundWork = false;
  // Set once a turn publishes a budget read from an assistant message, so the
  // turn-ending `result` is only mined for usage when nothing better arrived.
  let assistantBudgetSent = false;
  // The transcript row this turn's duration is recorded against, captured as
  // the turn streams.
  let turnAnchorUuid = null;

  // Whether this conversation keeps one process across its turns instead of
  // starting a fresh one per message.
  const keepSessionAlive = Boolean(options.toolsSettings?.keepSessionAlive);

  // A new turn supersedes any earlier one still holding this session's process
  // open, so held runs cannot stack up across a conversation. A process being
  // kept for this very conversation is the exception - releasing it here would
  // undo the point of holding it.
  if (sessionKey() && !(keepSessionAlive && getHeldSession(sessionKey()))) {
    getSession(sessionKey())?.releaseInput?.();
  }

  // `releasePromptStream` is reassigned once the held stream exists, so the
  // callback has to read it at fire time rather than capture it now.
  holdTimers = createHoldTimers({
    onRelease: (reason) => {
      // Every run closes its stdin here, held or not. Only a run that was
      // actually held has something to report, and logging the rest would bury
      // the records that matter under one per ordinary turn.
      if (holdArmedAt) {
        logRunLifecycle('hold_released', {
          sessionKey: sessionKey(),
          providerSessionId: capturedSessionId || null,
          reason,
          heldForMs: Date.now() - holdArmedAt
        });
        holdArmedAt = null;
      }
      // A held process is closed through the session that owns it: its prompt
      // stream belongs to the session and `releasePromptStream` is a no-op for
      // it. Calling only the latter here let the hold's limits expire without
      // releasing anything, leaving the held session's own idle timer as the
      // only thing deciding when a process goes.
      if (heldSession) {
        heldSession.close();
      } else {
        releasePromptStream();
      }
    }
  });

  // Arms the countdowns that eventually close stdin. Called when the hold starts
  // and again on every frame that arrives while it is held.
  const scheduleRelease = () => holdTimers.schedule();
  const releaseHeldStream = (reason) => holdTimers.release(reason);
  const clearReleaseTimers = () => holdTimers.clear();

  // Hoisted above the try so the catch's cleanup can tell whether this run
  // still owns the activeSessions entry (or was superseded by a newer run).
  let queryInstance = null;
  // Hoisted so the catch path can still report what was resolved when setup
  // failed part-way through.
  let sdkOptions = null;
  // Guarantees a run_start for every run_end. The record is emitted where its
  // payload is complete -- but everything above that point can throw, and a
  // run_end without a matching run_start reads like a run that started before
  // the log did. That is exactly the confusion this logging exists to remove.
  let runStartLogged = false;
  const logRunStart = () => {
    if (runStartLogged) {
      return;
    }
    runStartLogged = true;
    logRunLifecycle('run_start', {
      sessionKey: sessionKey(),
      providerSessionId: providerSessionId || null,
      // A run either resumes a known provider session or creates a new one.
      resumed: Boolean(providerSessionId),
      userId: ws?.userId || null,
      model: sdkOptions?.model || null,
      permissionMode: sdkOptions?.permissionMode || null
    });
  };
  // The process serving this conversation, when it is being kept alive.
  let heldSession = null;
  // The writer to answer on. These options can outlive the turn that built
  // them: a held process serves later turns, and each of those arrives on its
  // own writer. Closing over `ws` would send this turn's permission prompt to
  // the socket of whoever started the conversation — the laptop you left
  // behind when you picked up your phone.
  const currentWriter = () => heldSession?.writer || ws;
  // Whether this turn already claimed that process (see `reserve`).
  let heldTurnReserved = false;

  try {
    const resolvedModel = await context.resolveResumeModel(sessionId, options.model);
    let effortModels = CLAUDE_PREDEFINED_MODELS;
    try {
      effortModels = await context.getProviderModels();
    } catch (error) {
      console.warn('[Claude SDK] Unable to load provider models for effort validation:', error);
    }

    sdkOptions = mapCliOptionsToSDK({
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

    // Forward the CLI child's stderr into the service log; see the limits
    // documented at CLI_STDERR_MAX_LINE_CHARS above.
    // Per-run PEM state; see createCliStderrFormatter.
    const formatStderrLine = createCliStderrFormatter(sessionTag);

    // One place where a finished line is emitted, used by both the streaming
    // path and the flush during cleanup. Two code paths for the same job are
    // how a redaction rule ends up applied in one of them and not the other.
    stderrEmitter = createCliStderrEmitter({
      format: formatStderrLine,
      sink: (text) => console.error(text),
      throttleNotice: (dropped) => console.error(
        `[claude-cli-stderr] ${sessionTag()} [throttled ${dropped}]`,
      ),
    });

    stderrChunker = createCliStderrChunker(stderrEmitter.push);
    sdkOptions.stderr = (data) => stderrChunker.push(data);

    sdkOptions.hooks = {
      Notification: [{
        matcher: '',
        hooks: [async (input) => {
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
    sdkOptions.canUseTool = async (toolName, input, context) => {
      const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);

      if (!requiresInteraction) {
        if (sdkOptions.permissionMode === 'bypassPermissions') {
          return { behavior: 'allow', updatedInput: input };
        }

        const isDisallowed = (sdkOptions.disallowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isDisallowed) {
          return { behavior: 'deny', message: 'Tool disallowed by settings' };
        }

        const isAllowed = (sdkOptions.allowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isAllowed) {
          return { behavior: 'allow', updatedInput: input };
        }
      }

      const requestId = createRequestId();
      currentWriter().send(createNormalizedMessage({ kind: 'permission_request', requestId, toolName, input, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
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
        onCancel: (reason) => {
          currentWriter().send(createNormalizedMessage({ kind: 'permission_cancelled', requestId, reason, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
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
          if (!sdkOptions.allowedTools.includes(decision.rememberEntry)) {
            sdkOptions.allowedTools.push(decision.rememberEntry);
          }
          if (Array.isArray(sdkOptions.disallowedTools)) {
            sdkOptions.disallowedTools = sdkOptions.disallowedTools.filter(entry => entry !== decision.rememberEntry);
          }
        }
        return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
      }

      return { behavior: 'deny', message: decision.message ?? 'User denied tool use' };
    };

    // What the CLI fixes when it starts. A held process may serve the next turn
    // only if all of it still matches; model and permission mode are the
    // exception and are set on the live process below.
    const fingerprint = {
      cwd: options.cwd || '',
      // The whole configuration, not just the names: a server that keeps its
      // name but changes command, url, arguments or environment is a different
      // server, and the running process still has the old one.
      mcp: stableJson(mcpServers || {}),
      // The policy the user set, not the list handed to the CLI: plan mode
      // adds its own read-only tools, and the mode is switched on the live
      // process. Comparing the full list would start a new process for every
      // step into a plan and back out of it - `applyTurn` moves those entries
      // over instead.
      tools: stableJson({
        allowed: options.toolsSettings?.allowedTools || [],
        disallowed: options.toolsSettings?.disallowedTools || [],
      }),
      effort: sdkOptions.effort || '',
      model: sdkOptions.model || '',
      permissionMode: sdkOptions.permissionMode || 'default',
    };

    const reusable = keepSessionAlive ? getHeldSession(sessionKey()) : null;
    if (reusable && reusable.matches(fingerprint)) {
      // This turn answers on its own writer, whichever device asked for it.
      reusable.adopt(ws);
      // Claimed before anything is applied. `applyTurn` sets the model and the
      // permission mode on the live process and writes the tool list into the
      // options the running turn reads from, so a turn that did all that and
      // only then found the session busy would leave its settings on someone
      // else's turn. Refusing here also keeps the process: falling through to
      // the branch below would start a second one and `holdSession` would
      // close this one, ending the turn it is serving.
      if (!reusable.reserve()) {
        throw new Error('This session is already serving a turn.');
      }

      heldSession = reusable;
      heldTurnReserved = true;
      queryInstance = reusable.instance;
      try {
        await reusable.applyTurn({
          model: sdkOptions.model,
          permissionMode: sdkOptions.permissionMode,
          allowedTools: sdkOptions.allowedTools,
        });
      } catch (error) {
        // The turn never starts, so the claim has to go back or the process
        // stays blocked for the rest of the conversation.
        reusable.cancelReservation();
        heldTurnReserved = false;
        throw error;
      }
    } else {
      if (keepSessionAlive && sessionKey()) {
        heldSession = new HeldClaudeSession({ sessionKey: sessionKey(), fingerprint });
        heldSession.adopt(ws);
      }

      // A held session feeds the process itself, turn by turn; a one-shot run
      // gets this turn's messages and nothing more.
      let heldPrompt = heldSession
        ? { stream: heldSession.promptStream(), release: () => {} }
        : createHeldPromptStream(promptMessages);
      releasePromptStream = heldPrompt.release;
      try {
        queryInstance = query({
          prompt: heldPrompt.stream,
          options: sdkOptions
        });
      } catch (hookError) {
        // Older/newer SDK versions may not accept hook shapes yet.
        // Keep notification behavior operational via runtime events even if hook registration fails.
        console.warn('Failed to initialize Claude query with hooks, retrying without hooks:', hookError?.message || hookError);
        delete sdkOptions.hooks;
        // The retry falls back to a one-shot run: the held stream cannot be
        // handed out twice, and this path is a compatibility fallback anyway.
        heldPrompt.release();
        heldSession?.close();
        heldSession = null;
        heldPrompt = createHeldPromptStream(promptMessages);
        releasePromptStream = heldPrompt.release;
        queryInstance = query({
          prompt: heldPrompt.stream,
          options: sdkOptions
        });
      }

      if (heldSession) {
        heldSession.start(queryInstance, () => {}, sdkOptions);
        holdSession(heldSession);
      }
    }

    // Track the query instance for abort capability
    if (sessionKey()) {
      addSession(
        sessionKey(),
        queryInstance,
        ws,
        heldSession ? () => heldSession.close() : releasePromptStream,
      );
    }

    // Process streaming messages
    logRunStart();
    // One SDK message, handled the same way whichever process delivered it:
    // a fresh query, or one held open across the turns of this conversation.
    const handleTurnMessage = (message) => {
      // Capture session ID from first message
      if (message.session_id && !capturedSessionId) {

        capturedSessionId = message.session_id;
        addSession(sessionKey(), queryInstance, ws, releasePromptStream);

        // Set session ID on writer
        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(capturedSessionId);
        }

        // Send session-created event only once for sessions with nothing to resume
        if (!providerSessionId && !sessionCreatedSent) {
          sessionCreatedSent = true;
          logRunLifecycle('session_created', {
            sessionKey: sessionKey(),
            providerSessionId: capturedSessionId,
            userId: ws?.userId || null
          });
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
      // A `result` is the only frame carrying the real window, so learn from it
      // even on the turns whose budget comes from assistant usage instead.
      rememberContextWindow(sessionKey(), readReportedContextWindow(message));

      const tokenBudgetData = extractTokenBudget(message, reportedContextWindows.get(sessionKey()))
        || (assistantBudgetSent ? null : extractCumulativeTokenBudget(message));
      if (tokenBudgetData) {
        if (message.type === 'assistant') {
          assistantBudgetSent = true;
        }
        ws.send(createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget: tokenBudgetData, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
      }

      // Account quota, not session context. It is emitted only when it changes
      // — the first one arrives ahead of `system init`, before a single token
      // is spent — so the client keeps the last value rather than expecting one
      // per turn.
      const rateLimitData = extractRateLimit(message);
      if (rateLimitData) {
        ws.send(createNormalizedMessage({ kind: 'status', text: 'rate_limit', rateLimit: rateLimitData, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
      }

      if (startsRecurringWork(message)) {
        // Sticky: a cron armed on turn one is still armed on turn twenty, and
        // nothing in a later turn says so.
        heldSession?.setRecurring();
        rememberRecurring(sessionKey());
      }

      if (stopsRecurringWork(message)) {
        // Without this the flag outlives the job it describes and the process
        // is pinned for nothing. Coarse on purpose: deleting one of two crons
        // clears the mark, and the next tick of the survivor sets it again.
        forgetRecurring(sessionKey());
      }

      if (startsBackgroundWork(message)) {
        backgroundWorkPending = true;
      }

      // The transcript row the turn's duration will be shown on: the turn's
      // first assistant message with something to say. It has to be picked up
      // while the turn streams, because `result` carries the duration but names
      // no row — its own uuid is never written to the transcript, and the
      // transcript keeps no record for it at all.
      if (!turnAnchorUuid && message.type === 'assistant' && typeof message.uuid === 'string') {
        const blocks = Array.isArray(message.message?.content) ? message.message.content : [];
        if (blocks.some((block) => block?.type === 'text' && String(block.text || '').trim())) {
          turnAnchorUuid = message.uuid;
        }
      }

      if (message.type === 'result') {
        // Exact, and only available here: the alternative is guessing from the
        // timestamps either side of the turn, which stop at the last message
        // rather than at the end of the run.
        const durationSessionId = capturedSessionId || providerSessionId || sessionId || null;
        const durationMs = Number(message.duration_ms);
        if (turnAnchorUuid && durationSessionId && Number.isFinite(durationMs) && durationMs > 0) {
          turnDurationsDb.record(durationSessionId, turnAnchorUuid, {
            durationMs,
            durationApiMs: Number(message.duration_api_ms),
          });
        }
        // A held process serves several turns from this same loop, so the
        // anchor has to be given up here or turn two would annotate turn one.
        turnAnchorUuid = null;

        // The turn is done as far as the client is concerned.
        const abortPending = sessionKey() ? abortedSessionIds.has(sessionKey()) : false;
        if (!turnCompleteSent && !abortPending) {
          turnCompleteSent = true;
          ws.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 0 }));
          notifyRunStopped({
            userId: ws?.userId || null,
            provider: 'claude',
            sessionId: sessionId || capturedSessionId || null,
            sessionName: sessionSummary,
            stopReason: 'completed'
          });
        } else if (heldForBackgroundWork && !abortPending) {
          // A result after the turn already reported complete means the work we
          // held the process open for has finished and pushed a follow-up turn.
          notifyBackgroundWorkCompleted({
            userId: ws?.userId || null,
            provider: 'claude',
            sessionId: sessionId || capturedSessionId || null,
            sessionName: sessionSummary
          });
        }
        const holdDecision = decideHoldAfterResult({
          backgroundWorkPending,
          recurring: recurringSessions.has(sessionKey())
        });

        if (holdDecision === 'arm') {
          // Work started during this turn is still running. Hold the process
          // open so it can finish and report back in a follow-up turn; the
          // ceiling is only a backstop for work that never reports.
          backgroundWorkPending = false;
          heldForBackgroundWork = true;
          holdArmedAt = Date.now();
          // Suspends the held session's own idle countdown: the conversation
          // is about to look quiet while the work it started keeps running.
          heldSession?.setOutstandingWork(true);
          // And leaves this turn's handler behind to receive what that work
          // reports. Without it the held stream has nowhere to put anything
          // arriving after this `result`, which is all of it.
          heldSession?.setBetweenTurnsHandler(handleTurnMessage);
          logRunLifecycle('hold_armed', {
            sessionKey: sessionKey(),
            providerSessionId: capturedSessionId || null,
            idleMs: BG_IDLE_RELEASE_MS,
            totalMs: BG_TOTAL_HOLD_MS
          });
          scheduleRelease();
        } else if (holdDecision === 'rearm') {
          // A tick is not a finish. Work that repeats has no `result` that
          // means "done", so releasing on this one is what killed `/loop 10m`
          // after its first tick: the process went, and the in-process cron
          // with it. Re-arming from here also makes the ceiling measure time
          // since the last tick, which is the right question to ask of a cron
          // — one that has not fired in two hours is not coming back.
          heldForBackgroundWork = true;
          holdArmedAt = holdArmedAt || Date.now();
          // A tick between turns has to reach this turn's client too, and this
          // turn's writer is the newest one there is.
          heldSession?.setBetweenTurnsHandler(handleTurnMessage);
          clearReleaseTimers();
          scheduleRelease();
        } else {
          // Either nothing was backgrounded, or the background work just
          // reported in — let the CLI exit now, as it always has.
          heldForBackgroundWork = false;
          heldSession?.setOutstandingWork(false);
          // Nothing is outstanding, so nothing is expected between turns; a
          // handler left armed here would answer into a socket this run is
          // about to stop owning.
          heldSession?.setBetweenTurnsHandler(null);
          releaseHeldStream('work_reported_back');
        }
      } else if (holdTimers.isArmed()) {
        // Background activity after the turn — push the countdown back out.
        scheduleRelease();
      }
    };

    if (heldSession) {
      // The session reads the stream for all of its turns; this one gets its
      // messages through the callback and ends with its own `result`.
      await heldSession.runTurn({ promptMessages, onMessage: handleTurnMessage, reserved: heldTurnReserved });
    } else {
      for await (const message of queryInstance) {
        handleTurnMessage(message);
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
    const superseded = supersededInstances.has(queryInstance);

    // Send the terminal completion event — skipped for aborted runs, whose
    // terminal `complete` (aborted: true) was already sent by abort-session, and
    // for runs that already reported completion when their `result` arrived.
    const wasAborted = !superseded && sessionKey() ? abortedSessionIds.delete(sessionKey()) : false;
    if (!turnCompleteSent && !superseded) {
      turnCompleteSent = true;
      if (!wasAborted) {
        ws.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 0 }));
      }
      notifyRunStopped({
        userId: ws?.userId || null,
        provider: 'claude',
        sessionId: sessionId || capturedSessionId || null,
        sessionName: sessionSummary,
        stopReason: wasAborted ? 'aborted' : 'completed'
      });
    }
    // A superseded run skips the block above entirely — it owns none of the
    // client-facing events. Without a record here it would end as a run_start
    // with no run_end, which is exactly how such a run becomes invisible at
    // the moment something unusual happened to it.
    logRunEnd(superseded
      ? { reason: 'superseded', exitCode: null, durationMs: Date.now() - runStartedAt }
      : {
        reason: wasAborted ? 'aborted' : 'completed',
        exitCode: wasAborted ? null : 0,
        durationMs: Date.now() - runStartedAt
      });
    // Complete

  } catch (error) {
    console.error('SDK query error:', error);

    // Setup may have thrown before the run_start above was reached.
    logRunStart();

    // Clean up session on error — only while this run still owns the map entry
    // (a superseding run may have replaced it).
    if (sessionKey() && getSession(sessionKey())?.instance === queryInstance) {
      removeSession(sessionKey());
    }

    if (supersededInstances.has(queryInstance)) {
      // Interrupted because a newer run took over this session id; that run
      // owns the abort flag and all further client-facing events.
      //
      // The run stays silent toward the CLIENT — that is deliberate and
      // unchanged. It does get a log record, though: this is the path an
      // interrupted run actually takes, and without a record it vanishes
      // here without a trace.
      logRunEnd({
        reason: 'superseded',
        exitCode: null,
        durationMs: Date.now() - runStartedAt
      });
      return;
    }

    const wasAborted = sessionKey() ? abortedSessionIds.delete(sessionKey()) : false;
    if (wasAborted) {
      // The abort already produced the terminal complete; a generator throw
      // caused by interrupt() is expected noise, not a user-facing error.
      logRunEnd({
        reason: 'aborted',
        exitCode: null,
        durationMs: Date.now() - runStartedAt
      });
      return;
    }

    // Check if Claude CLI is installed for a clearer error message
    const installed = await context.isProviderInstalled();
    const errorContent = !installed
      ? 'Claude Code is not installed. Please install it first: https://docs.anthropic.com/en/docs/claude-code'
      : error.message;

    // Send error to WebSocket, then the terminal complete. A run that already
    // reported completion and then failed during its post-turn hold still
    // surfaces the error, but must not emit a second terminal complete.
    ws.send(createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
    // The logging sits after the guard on purpose: it belongs to the RUN, not
    // to the client-facing message, and runEndLogged gives it its own
    // exactly-once guarantee.
    if (!turnCompleteSent) {
      ws.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 1 }));
    }
    logRunEnd({
      reason: 'error',
      exitCode: 1,
      durationMs: Date.now() - runStartedAt,
      error: error?.message || String(error)
    });
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
    clearReleaseTimers();
    // Anything still buffered is a real line the CLI wrote; it just never got
    // its newline before the run ended.
    stderrChunker?.flush();
    // A run that ends while its throttle window is still open would otherwise
    // carry the dropped-line count to the grave.
    stderrEmitter?.flushDropped();
    releasePromptStream();
  }
}

/**
 * Aborts an active SDK session
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session was aborted, false if not found
 */
async function abortClaudeSDKSession(sessionId) {
  const session = getSession(sessionId);

  if (!session) {
    console.log(`Session ${sessionId} not found`);
    return false;
  }

  try {
    logRunLifecycle('abort_requested', { sessionKey: sessionId });

    // Mark before interrupting so the run loop knows not to emit its own
    // terminal complete (the abort handler sends the aborted one).
    abortedSessionIds.add(sessionId);

    // Call interrupt() on the query instance
    await session.instance.interrupt();

    // Release the held stdin stream; without this the CLI stays up for the rest
    // of the post-turn hold even though the user cancelled.
    session.releaseInput?.();

    // Update session status
    session.status = 'aborted';

    // Clean up session
    removeSession(sessionId);

    return true;
  } catch (error) {
    console.error(`Error aborting session ${sessionId}:`, error);
    // The run keeps going; let it emit its own terminal complete.
    abortedSessionIds.delete(sessionId);
    return false;
  }
}

/**
 * Checks if an SDK session is currently active
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session is active
 */
function isClaudeSDKSessionActive(sessionId) {
  const session = getSession(sessionId);
  return session && session.status === 'active';
}

/**
 * Gets all active SDK session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getActiveClaudeSDKSessions() {
  return getAllSessions();
}

/**
 * Get pending tool approvals for a specific session.
 * @param {string} sessionId - The session ID
 * @returns {Array} Array of pending permission request objects
 */
function getPendingApprovalsForSession(sessionId) {
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
function reconnectSessionWriter(sessionId, newRawWs) {
  const session = getSession(sessionId);
  if (!session?.writer?.updateWebSocket) return false;
  session.writer.updateWebSocket(newRawWs);
  console.log(`[RECONNECT] Writer swapped for session ${sessionId}`);
  return true;
}

export const claudeRuntime = {
  run: queryClaudeSDK,
  abort: abortClaudeSDKSession,
  permissions: {
    resolve: resolveToolApproval,
    listPending: getPendingApprovalsForSession,
  },
};

// Export public API
export {
  createCliStderrChunker,
  createCliStderrEmitter,
  createCliStderrFormatter,
  formatCliStderrLine,
  queryClaudeSDK,
  abortClaudeSDKSession,
  // Exported for tests. It is a pure predicate over one SDK message and it
  // decides whether a turn's CLI process is held open, so it is the cheapest
  // thing in this file to pin down — and it had no coverage at all.
  startsBackgroundWork,
  startsRecurringWork,
  stopsRecurringWork,
  decideHoldAfterResult,
  DEFERRED_WORK_TOOLS,
  RECURRING_WORK_TOOLS,
  SUBAGENT_TOOL_NAMES,
  createHoldTimers,
  // Exported for tests. Abort-on-a-held-run and supersede both live in this
  // registry rather than in the SDK, so they can be pinned down without
  // faking `query()` — but only if a run can be registered from outside.
  addSession,
  isClaudeSDKSessionActive,
  getActiveClaudeSDKSessions,
  resolveToolApproval,
  getPendingApprovalsForSession,
  reconnectSessionWriter,
  extractTokenBudget,
  extractCumulativeTokenBudget,
  extractRateLimit,
  readReportedContextWindow
};
