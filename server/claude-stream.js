/**
 * Claude Stream Integration — long-lived CLI process per chat session.
 *
 * Alternative to claude-sdk.js which spawns a fresh Claude CLI process for every
 * message (paying the full ~22s cold start each time). This handler keeps one
 * `claude --print --input-format stream-json --output-format stream-json` process
 * alive per chat session and feeds sequential prompts over stdin. First message
 * pays cold start (~22s); subsequent messages pay only per-prompt overhead (~12s).
 *
 * MVP caveats:
 *   - Uses --dangerously-skip-permissions. No UI approval prompts.
 *   - Hooks are read from settings.json by the CLI itself (not from cloudcli code).
 *   - No support for canUseTool callbacks / pendingApprovals from claude-sdk.js.
 *
 * Enable with env var CLAUDE_STREAM_MODE=1 (dispatched from server/index.js).
 */

import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import crypto from 'crypto';
import { CLAUDE_MODELS } from '../shared/modelConstants.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { createNormalizedMessage } from './shared/utils.js';
import { handleImages, cleanupTempFiles, loadMcpConfig } from './claude-sdk.js';

const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

/**
 * Map of sessionId → session record.
 * Before first `system/init` arrives, a session is keyed by a temporary pendingKey
 * and rekeyed to the real sessionId once detected.
 */
const activeStreamSessions = new Map();

const IDLE_TIMEOUT_MS = parseInt(process.env.CLAUDE_STREAM_IDLE_MS, 10) || 30 * 60 * 1000;

/**
 * Temporary map key for a session that hasn't seen its `system/init` yet.
 * Rekeyed to the real session_id once `handleEvent` sees it.
 * @returns {string}
 */
function createPendingKey() {
  return 'pending:' + crypto.randomBytes(8).toString('hex');
}

/**
 * @typedef {Object} StreamSession
 * @property {import('child_process').ChildProcess} process
 * @property {string|null} sessionId  // real session ID (null until system/init)
 * @property {Object} writer          // WebSocketWriter
 * @property {string} cwd
 * @property {string[]} tempImagePaths
 * @property {string|null} tempDir
 * @property {string} stdoutBuffer
 * @property {boolean} sessionCreatedSent
 * @property {boolean} inFlight       // true while a prompt is being processed
 * @property {NodeJS.Timeout|null} idleTimer
 */

/**
 * Build CLI args for a new claude process.
 */
function buildCliArgs({ sessionId, model, permissionMode, mcpServers, additionalDirs }) {
  const args = [
    '--print',
    '--verbose',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    // --include-partial-messages is intentionally NOT set: the UI store
    // finalizes a streamed message with a locally-generated id that cannot
    // match the canonical JSONL id, so once the server catches up on refresh,
    // the streamed copy persists as a duplicate next to the server's canonical
    // assistant message. Emitting only the final `assistant` event avoids this.
    '--dangerously-skip-permissions',
  ];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  args.push('--model', model || CLAUDE_MODELS.DEFAULT);

  if (permissionMode === 'plan') {
    args.push('--permission-mode', 'plan');
  }

  if (mcpServers && Object.keys(mcpServers).length > 0) {
    args.push('--mcp-config', JSON.stringify({ mcpServers }));
  }

  if (Array.isArray(additionalDirs)) {
    for (const dir of additionalDirs) args.push('--add-dir', dir);
  }

  return args;
}

/**
 * Spawn a new claude process for a session.
 */
function spawnClaudeProcess({ sessionId, cwd, model, permissionMode, mcpServers, additionalDirs }) {
  const args = buildCliArgs({ sessionId, model, permissionMode, mcpServers, additionalDirs });

  const child = spawnFunction(process.env.CLAUDE_CLI_PATH || 'claude', args, {
    cwd: cwd || process.cwd(),
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  console.log(`[claude-stream] spawned pid=${child.pid} session=${sessionId || 'NEW'}`);
  return child;
}

/**
 * Feed one event (possibly unwrapped) to the provider adapter and forward the
 * resulting normalized messages to the WebSocket writer.
 */
function forwardToAdapter(session, event) {
  const sid = session.sessionId;
  let normalized;
  try {
    normalized = sessionsService.normalizeMessage('claude', event, sid);
  } catch (err) {
    console.error('[claude-stream] normalizeMessage failed:', err);
    return;
  }
  if (Array.isArray(normalized)) {
    for (const msg of normalized) {
      session.writer?.send(msg);
    }
  }
}

/**
 * Process a single parsed stdout event from the CLI. Handles CLI-specific
 * shapes the provider adapter doesn't know about (stream_event wrapper,
 * rate_limit_event, system/* lifecycle events, result).
 */
function handleEvent(session, event) {
  // Capture session ID on first init message
  if (event.session_id && !session.sessionId) {
    const realId = event.session_id;
    session.sessionId = realId;

    // Rekey the map: find current key (pendingKey) and replace with realId
    for (const [key, value] of activeStreamSessions.entries()) {
      if (value === session) {
        activeStreamSessions.delete(key);
        break;
      }
    }
    activeStreamSessions.set(realId, session);

    if (session.writer?.setSessionId) {
      session.writer.setSessionId(realId);
    }

    if (!session.sessionCreatedSent) {
      session.sessionCreatedSent = true;
      session.writer?.send(createNormalizedMessage({
        kind: 'session_created',
        newSessionId: realId,
        sessionId: realId,
        provider: 'claude',
      }));
    }
  }

  const sid = session.sessionId;

  // Unwrap Anthropic SSE events (emitted only with --include-partial-messages,
  // which buildCliArgs currently does NOT set). Retained so re-enabling the
  // flag doesn't silently drop streaming tokens: the provider adapter matches
  // top-level `content_block_delta` / `content_block_stop`, but the CLI wraps
  // them as { type: 'stream_event', event: { type: 'content_block_delta', ... } }.
  if (event.type === 'stream_event' && event.event) {
    forwardToAdapter(session, event.event);
    return;
  }

  // Surface rate limit events as a status message so the user sees when they
  // approach their quota (the adapter silently drops these).
  if (event.type === 'rate_limit_event') {
    const info = event.rate_limit_info || {};
    const utilPct = Math.round((info.utilization ?? 0) * 100);
    const resetAt = info.resetsAt ? new Date(info.resetsAt * 1000).toISOString() : null;
    session.writer?.send(createNormalizedMessage({
      kind: 'status',
      text: 'rate_limit',
      content: `Rate limit ${info.rateLimitType || ''} at ${utilPct}%${resetAt ? ` (resets ${resetAt})` : ''}`,
      rateLimitInfo: info,
      sessionId: sid,
      provider: 'claude',
    }));
    return;
  }

  // Surface user-facing systemMessages from hook responses (e.g. SessionStart hooks
  // that echo "Session saved to task X"). Drop other hook lifecycle events silently.
  if (event.type === 'system' && event.subtype === 'hook_response') {
    try {
      const parsed = typeof event.output === 'string' ? JSON.parse(event.output) : event.output;
      const sysMsg = parsed?.systemMessage;
      if (sysMsg) {
        session.writer?.send(createNormalizedMessage({
          kind: 'status',
          text: 'system_message',
          content: sysMsg,
          source: event.hook_name,
          sessionId: sid,
          provider: 'claude',
        }));
      }
    } catch (_) { /* non-JSON output, ignore */ }
    return;
  }

  // Drop non-informative system events silently: init (we already captured
  // session_id), status, hook_started — they'd be UI noise.
  if (event.type === 'system') return;

  // CLI error events (auth failure, internal errors). The shared adapter has
  // no handler for `type: 'error'` and silently drops it, which leaves the UI
  // hanging forever waiting for a `result` that will never come.
  if (event.type === 'error') {
    const msg = event.error?.message || event.message || (typeof event.error === 'string' ? event.error : null) || 'Unknown CLI error';
    console.error('[claude-stream] CLI error event:', msg);
    session.writer?.send(createNormalizedMessage({
      kind: 'error',
      content: msg,
      sessionId: sid,
      provider: 'claude',
    }));
    // Clean the failed prompt's temps now — no `result` will follow to do it
    // for us, and letting the next drainQueue call overwrite
    // `currentPromptTemps` would leak the files on disk.
    const current = session.currentPromptTemps;
    if (current && Array.isArray(current.tempImagePaths) && current.tempImagePaths.length > 0) {
      cleanupTempFiles(current.tempImagePaths, current.tempDir).catch(() => {});
    }
    session.currentPromptTemps = null;
    session.inFlight = false;
    drainQueue(session);
    if (!session.inFlight) armIdleTimer(session);
    return;
  }

  // Default path: hand off to the provider adapter (handles assistant/user
  // message content, tool_use, tool_result, thinking, content_block_delta/stop).
  forwardToAdapter(session, event);

  // On result event, mark prompt done and run idle timer.
  if (event.type === 'result') {
    session.inFlight = false;

    // Clean up only the in-flight prompt's temp files; queued prompts keep
    // their own temps attached to their queue entry until they run.
    const current = session.currentPromptTemps;
    if (current && Array.isArray(current.tempImagePaths) && current.tempImagePaths.length > 0) {
      cleanupTempFiles(current.tempImagePaths, current.tempDir).catch(() => {});
    }
    session.currentPromptTemps = null;

    session.writer?.send(createNormalizedMessage({
      kind: 'complete',
      exitCode: event.is_error ? 1 : 0,
      isNewSession: false,
      durationMs: event.duration_ms,
      apiDurationMs: event.duration_api_ms,
      totalCostUsd: event.total_cost_usd,
      usage: event.usage,
      sessionId: sid,
      provider: 'claude',
    }));

    drainQueue(session);
    if (!session.inFlight) armIdleTimer(session);
  }
}

/**
 * Consume stdout chunks: split on newlines, parse each JSON line.
 */
function attachStdoutHandler(session) {
  session.process.stdout.on('data', (chunk) => {
    session.stdoutBuffer += chunk.toString('utf8');
    let nl;
    while ((nl = session.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = session.stdoutBuffer.slice(0, nl);
      session.stdoutBuffer = session.stdoutBuffer.slice(nl + 1);
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch (err) {
        console.warn('[claude-stream] non-JSON stdout line (ignored):', line.slice(0, 200));
        continue;
      }
      handleEvent(session, event);
    }
  });

  session.process.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    console.error('[claude-stream stderr]', text.slice(0, 500));
  });

  // 'close' fires after all stdio streams are fully drained; 'exit' fires as
  // soon as the process terminates and can leave final JSONL lines buffered
  // in stdout that never reach handleEvent if we cleanup on 'exit'.
  session.process.on('close', (code, signal) => {
    console.log(`[claude-stream] process pid=${session.process.pid} closed code=${code} signal=${signal} session=${session.sessionId || 'NEW'}`);
    cleanupSession(session, { sendComplete: session.inFlight });
  });

  session.process.on('error', (err) => {
    console.error('[claude-stream] process error:', err);
    session.writer?.send(createNormalizedMessage({
      kind: 'error',
      content: `Claude process error: ${err.message}`,
      sessionId: session.sessionId,
      provider: 'claude',
    }));
  });
}

/**
 * (Re)start the idle timer. When it fires, the long-lived process is killed
 * so abandoned sessions don't occupy resources indefinitely.
 * @param {StreamSession} session
 */
function armIdleTimer(session) {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    console.log(`[claude-stream] idle timeout → killing session ${session.sessionId}`);
    killSession(session);
  }, IDLE_TIMEOUT_MS);
}

/**
 * Cancel the pending idle timer without killing the session.
 * @param {StreamSession} session
 */
function disarmIdleTimer(session) {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
}

/**
 * Terminate the session's child process (stdin end + SIGTERM). Used by the
 * idle timer and by the SIGTERM fallback in `abortClaudeStreamSession`. The
 * `close` handler will fire `cleanupSession` once the process actually exits.
 * @param {StreamSession} session
 */
function killSession(session) {
  disarmIdleTimer(session);
  try {
    session.process.stdin.end();
  } catch (_) {}
  try {
    session.process.kill('SIGTERM');
  } catch (_) {}
}

/**
 * Drop the session from the active map and release every resource it owned:
 * in-flight + queued temp image files, queued prompts (reported as errors),
 * and the idle timer. Optionally emits a synthetic `complete { aborted: true }`
 * to the writer when a prompt was still in flight at exit.
 * @param {StreamSession} session
 * @param {{ sendComplete?: boolean }} [opts]
 */
function cleanupSession(session, { sendComplete = false } = {}) {
  disarmIdleTimer(session);

  // Clean up the in-flight prompt's temps (if any) and every queued prompt's
  // temps. Temp files belong to individual prompts so process-wide state
  // never deletes files that a queued prompt is still about to reference.
  const current = session.currentPromptTemps;
  if (current && Array.isArray(current.tempImagePaths) && current.tempImagePaths.length > 0) {
    cleanupTempFiles(current.tempImagePaths, current.tempDir).catch(() => {});
  }
  session.currentPromptTemps = null;
  if (Array.isArray(session.queue)) {
    for (const entry of session.queue) {
      if (entry && Array.isArray(entry.tempImagePaths) && entry.tempImagePaths.length > 0) {
        cleanupTempFiles(entry.tempImagePaths, entry.tempDir).catch(() => {});
      }
    }
  }

  // Remove from map
  for (const [key, value] of activeStreamSessions.entries()) {
    if (value === session) {
      activeStreamSessions.delete(key);
      break;
    }
  }

  // Notify the client about any queued prompts that never got to run so the
  // UI can surface a failure instead of hanging on that conversation forever.
  if (Array.isArray(session.queue) && session.queue.length > 0) {
    console.log(`[claude-stream] discarding ${session.queue.length} queued prompt(s) on cleanup`);
    for (let i = 0; i < session.queue.length; i++) {
      session.writer?.send(createNormalizedMessage({
        kind: 'error',
        content: 'Claude process exited before this message could be sent',
        sessionId: session.sessionId,
        provider: 'claude',
      }));
    }
    session.queue.length = 0;
  }

  // Suppress the final complete event if the dispatcher in index.js already
  // emitted one for an explicit abort — otherwise the client sees two.
  if (sendComplete && session.writer && !session.abortRequested) {
    session.writer.send(createNormalizedMessage({
      kind: 'complete',
      exitCode: 1,
      aborted: true,
      sessionId: session.sessionId,
      provider: 'claude',
    }));
  }
}

/**
 * Write a prompt entry ({text, tempImagePaths, tempDir}) to the process stdin
 * in stream-json format. On success marks inFlight=true and records the
 * entry's temps so handleEvent can clean them when its `result` fires.
 * Returns true on success, false if stdin is closed/broken; on failure the
 * caller is responsible for re-queuing and surfacing the error — writing
 * does NOT set inFlight so the queue can still drain.
 */
function writePromptNow(session, entry) {
  const payload = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: entry.text },
  }) + '\n';
  try {
    session.process.stdin.write(payload);
    session.inFlight = true;
    session.currentPromptTemps = {
      tempImagePaths: entry.tempImagePaths || [],
      tempDir: entry.tempDir || null,
    };
    return true;
  } catch (err) {
    console.error('[claude-stream] stdin write failed:', err);
    return false;
  }
}

/**
 * Write or queue a prompt entry. When claude is already processing a prior
 * prompt (inFlight), stacking prompts on stdin can cause the CLI to drop or
 * merge them — observed in testing. Queueing locally is safe: we write the
 * next prompt only after we see the preceding `result` event.
 * On sync stdin failure clean the entry's temp images and surface an error
 * instead of silently losing the prompt and leaking files on disk.
 */
function submitPrompt(session, entry) {
  if (session.inFlight) {
    session.queue.push(entry);
    return;
  }
  if (writePromptNow(session, entry)) return;

  if (Array.isArray(entry.tempImagePaths) && entry.tempImagePaths.length > 0) {
    cleanupTempFiles(entry.tempImagePaths, entry.tempDir).catch(() => {});
  }
  session.writer?.send(createNormalizedMessage({
    kind: 'error',
    content: 'Failed to write prompt to Claude process; please retry the message',
    sessionId: session.sessionId,
    provider: 'claude',
  }));
}

/**
 * Drain one queued prompt, called after a `result` event. On sync stdin
 * failure put the entry back on the front of the queue and surface an error
 * rather than silently losing the prompt.
 */
function drainQueue(session) {
  if (session.queue.length === 0) return;
  const next = session.queue.shift();
  if (!writePromptNow(session, next)) {
    session.queue.unshift(next);
    session.writer?.send(createNormalizedMessage({
      kind: 'error',
      content: 'Failed to write queued prompt to Claude process; the message is still queued but the session may need to be restarted',
      sessionId: session.sessionId,
      provider: 'claude',
    }));
  }
}

/**
 * Main entry point. Same signature as queryClaudeSDK.
 */
async function queryClaudeStream(command, options = {}, ws) {
  const { sessionId, cwd, model, permissionMode, images, additionalDirs } = options;

  // Track temp files outside the try so an early-return or thrown error that
  // never reaches submitPrompt (which transfers ownership to the prompt entry)
  // can still clean up the image files we already wrote to disk.
  let imageResult = null;
  let ownershipTaken = false;

  const cleanupUntakenTemps = () => {
    if (ownershipTaken) return;
    if (imageResult && Array.isArray(imageResult.tempImagePaths) && imageResult.tempImagePaths.length > 0) {
      cleanupTempFiles(imageResult.tempImagePaths, imageResult.tempDir).catch(() => {});
    }
  };

  try {
    // Save images to disk and augment prompt
    imageResult = await handleImages(command, images, cwd);
    const finalCommand = imageResult.modifiedCommand;

    // Lookup existing session if sessionId provided and process is alive.
    // Delete stale entries immediately so a second concurrent resume can't
    // also see the dead record and spawn a duplicate process, and so
    // isClaudeStreamSessionActive doesn't report a dead session as live.
    let session = sessionId ? activeStreamSessions.get(sessionId) : null;
    if (session && !isSessionProcessAlive(session)) {
      activeStreamSessions.delete(sessionId);
      session = null;
    }

    if (!session) {
      // Spawn new process
      const mcpServers = await loadMcpConfig(cwd);
      const child = spawnClaudeProcess({
        sessionId,  // pass --resume if sessionId provided (after reconnect)
        cwd,
        model,
        permissionMode,
        mcpServers,
        additionalDirs,
      });

      session = {
        process: child,
        sessionId: sessionId || null,  // may be null until system/init arrives
        writer: ws,
        cwd: cwd || process.cwd(),
        // Temp files are owned per-prompt (on queue entries + currentPromptTemps),
        // never on the session itself, so queued prompts don't have their
        // images deleted by a previous prompt's result cleanup.
        currentPromptTemps: null,
        stdoutBuffer: '',
        sessionCreatedSent: false,
        inFlight: false,  // set by writePromptNow
        idleTimer: null,
        queue: [],
      };

      const key = sessionId || createPendingKey();
      activeStreamSessions.set(key, session);
      attachStdoutHandler(session);
    } else {
      // Reuse existing session — writer is refreshed; temps stay per-prompt.
      // Ownership guard: without this an authenticated client who knows
      // another user's sessionId could hijack the long-lived process by
      // sending a `claude-command` with that sessionId, silently rerouting
      // all subsequent output to themselves and locking the original owner
      // out (their later abort/reconnect would fail the downstream
      // `sessionBelongsTo` checks).
      if (!sessionBelongsTo(session, ws?.userId ?? null)) {
        console.warn(`[claude-stream] query rejected: user ${ws?.userId} does not own session ${sessionId}`);
        cleanupUntakenTemps();
        ws?.send?.(createNormalizedMessage({
          kind: 'error',
          content: 'Session belongs to another user',
          sessionId: sessionId || null,
          provider: 'claude',
        }));
        return;
      }
      session.writer = ws;
      disarmIdleTimer(session);
    }

    // submitPrompt takes ownership of the temps — from here on they live on
    // the queue entry (and then on session.currentPromptTemps once written),
    // and any subsequent cleanup path will handle them.
    ownershipTaken = true;
    submitPrompt(session, {
      text: finalCommand,
      tempImagePaths: imageResult.tempImagePaths,
      tempDir: imageResult.tempDir,
    });
    // Intentionally do NOT close stdin — we want to send more prompts later.
  } catch (err) {
    console.error('[claude-stream] queryClaudeStream error:', err);
    cleanupUntakenTemps();
    ws?.send?.(createNormalizedMessage({
      kind: 'error',
      content: `Claude stream error: ${err.message}`,
      sessionId: options.sessionId || null,
      provider: 'claude',
    }));
  }
}

/**
 * True when the session's child process hasn't exited yet. Checks exitCode
 * and signalCode (both null → still running); `process.killed` is NOT safe
 * here — Node sets it as soon as `process.kill()` has been called, even if
 * the signal hasn't taken effect yet, which would flag a still-running
 * process as dead.
 */
function isSessionProcessAlive(session) {
  return !!session
    && session.process.exitCode === null
    && session.process.signalCode === null;
}

/**
 * Return the live session for `sessionId`, or null. A map entry whose process
 * has already died is removed on the way out so callers don't see stale
 * `isProcessing: true` or misroute an abort away from SDK fallback.
 */
function getLiveSession(sessionId) {
  const session = activeStreamSessions.get(sessionId);
  if (!session) return null;
  if (!isSessionProcessAlive(session)) {
    cleanupSession(session);
    return null;
  }
  return session;
}

/**
 * Ownership guard. Returns true when either no userId is supplied (internal
 * calls) or the session was created on a WebSocket with the same userId.
 * Prevents one authenticated client from aborting or rebinding another
 * user's long-lived Claude process just by knowing its sessionId.
 */
function sessionBelongsTo(session, userId) {
  if (userId === undefined || userId === null) return true;
  const ownerId = session?.writer?.userId ?? null;
  return ownerId === userId;
}

/**
 * Abort a live stream session on user request. SIGINT first for a clean
 * shutdown; a 2s SIGTERM fallback is armed and cleared once the child
 * process emits `exit`, so a graceful shutdown doesn't keep the event loop
 * alive unnecessarily. Returns false when the session isn't live or the
 * caller doesn't own it.
 * @param {string} sessionId
 * @param {string|number|null} [userId]
 * @returns {Promise<boolean>}
 */
async function abortClaudeStreamSession(sessionId, userId) {
  const session = getLiveSession(sessionId);
  if (!session) return false;
  if (!sessionBelongsTo(session, userId)) {
    console.warn(`[claude-stream] abort rejected: user ${userId} does not own session ${sessionId}`);
    return false;
  }
  // Flag so the exit handler doesn't emit a second `complete` event — the
  // dispatcher in index.js already sent one for this abort.
  session.abortRequested = true;
  try {
    // Send SIGINT first (graceful) — claude should flush and exit.
    session.process.kill('SIGINT');
    // SIGTERM fallback after 2s, cleared if the process exits cleanly first
    // so the timer doesn't keep the event loop alive unnecessarily.
    const fallbackTimer = setTimeout(() => {
      if (isSessionProcessAlive(session)) {
        killSession(session);
      }
    }, 2000);
    session.process.once('exit', () => clearTimeout(fallbackTimer));
    return true;
  } catch (err) {
    console.error('[claude-stream] abort failed:', err);
    return false;
  }
}

/**
 * True when `sessionId` maps to a live stream session owned by `userId`.
 * Both liveness and ownership are checked; stale map entries are pruned by
 * `getLiveSession`.
 * @param {string} sessionId
 * @param {string|number|null} [userId]
 * @returns {boolean}
 */
function isClaudeStreamSessionActive(sessionId, userId) {
  const session = getLiveSession(sessionId);
  if (!session) return false;
  if (!sessionBelongsTo(session, userId)) return false;
  return true;
}

/**
 * List every live stream session visible to `userId`. Dead entries are
 * pruned as a side effect of iterating and `pending:*` keys (pre-init
 * sessions) are hidden. When `userId` is omitted every live session is
 * returned — intended for internal callers only.
 * @param {string|number|null} [userId]
 * @returns {string[]}
 */
function getActiveClaudeStreamSessions(userId) {
  const live = [];
  for (const [key, session] of activeStreamSessions.entries()) {
    if (key.startsWith('pending:')) continue;
    if (!isSessionProcessAlive(session)) {
      cleanupSession(session);
      continue;
    }
    if (!sessionBelongsTo(session, userId)) continue;
    live.push(key);
  }
  return live;
}

/**
 * Swap the WebSocket that streams events back to the client (e.g. after a
 * client reconnect or page refresh). Refuses if the session isn't live or
 * the requesting user doesn't own it.
 * @param {string} sessionId
 * @param {import('ws').WebSocket} newRawWs
 * @param {string|number|null} [userId]
 * @returns {boolean}
 */
function reconnectStreamSessionWriter(sessionId, newRawWs, userId) {
  const session = getLiveSession(sessionId);
  if (!session?.writer?.updateWebSocket) return false;
  if (!sessionBelongsTo(session, userId)) {
    console.warn(`[claude-stream] reconnect rejected: user ${userId} does not own session ${sessionId}`);
    return false;
  }
  session.writer.updateWebSocket(newRawWs);
  console.log(`[claude-stream RECONNECT] writer swapped for session ${sessionId}`);
  return true;
}

export {
  queryClaudeStream,
  abortClaudeStreamSession,
  isClaudeStreamSessionActive,
  getActiveClaudeStreamSessions,
  reconnectStreamSessionWriter,
};
