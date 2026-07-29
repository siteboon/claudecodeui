import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

import crossSpawn from 'cross-spawn';

import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { createNormalizedMessage } from './shared/utils.js';
import { StdioJsonRpcClient } from './modules/providers/list/kiro/stdio-jsonrpc-client.js';

const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;
const KIRO_BIN = process.env.KIRO_PATH ?? 'kiro-cli';

// Tracks active Kiro processes by session id (or a temporary process key
// before the ACP `session/new` reply assigns a real sessionId).
const activeKiroProcesses = new Map();

const PROVIDER = 'kiro';

/**
 * Kiro speaks ACP (Agent Client Protocol) — JSON-RPC 2.0 over stdio. Each
 * `kiro-cli acp` invocation hosts ONE chat session that we drive with
 * `initialize` → `session/new` (or `session/load` for resume) → `session/prompt`.
 *
 * Streamed agent events arrive as `session/update` notifications and are
 * normalized into NormalizedMessage shapes the rest of the app already
 * understands (text, tool_use, tool_result, complete, error).
 */

/**
 * Maps an ACP `session/update` notification into NormalizedMessage chunks.
 *
 * Event shapes (verified against kiro-cli 2.3.0):
 *   sessionUpdate: 'agent_message_chunk' → {content: {type, text}}
 *   sessionUpdate: 'tool_call'           → {toolCallId, title, kind, locations[], rawInput}
 *   sessionUpdate: 'tool_call_chunk'     → {toolCallId, ...}  (progressive args)
 *   sessionUpdate: 'tool_call_update'    → {toolCallId, status: 'completed'|'failed', ...}
 */
function normalizeAcpUpdate(params, sessionId) {
  if (!params || typeof params !== 'object') {
    return [];
  }

  const update = params.update;
  if (!update || typeof update !== 'object') {
    return [];
  }

  const kind = update.sessionUpdate;
  const ts = new Date().toISOString();

  if (kind === 'agent_message_chunk') {
    const content = update.content;
    const text = content && typeof content === 'object' && typeof content.text === 'string'
      ? content.text
      : '';
    if (!text) {
      return [];
    }
    return [createNormalizedMessage({
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'text',
      role: 'assistant',
      content: text,
    })];
  }

  if (kind === 'tool_call') {
    const toolId = typeof update.toolCallId === 'string' ? update.toolCallId : '';
    return [createNormalizedMessage({
      id: toolId || undefined,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'tool_use',
      toolName: typeof update.title === 'string' ? update.title : (typeof update.kind === 'string' ? update.kind : 'tool'),
      toolId,
      toolInput: update.rawInput,
      input: update.locations,
    })];
  }

  if (kind === 'tool_call_update') {
    const toolId = typeof update.toolCallId === 'string' ? update.toolCallId : '';
    const status = typeof update.status === 'string' ? update.status : 'completed';
    if (status !== 'completed' && status !== 'failed') {
      // Intermediate (e.g. 'in_progress') updates are not surfaced to keep the
      // history reader and the live stream byte-identical.
      return [];
    }
    const isError = status === 'failed';
    let content = '';
    if (typeof update.output === 'string') {
      content = update.output;
    } else if (update.output && typeof update.output === 'object') {
      try { content = JSON.stringify(update.output); } catch { content = ''; }
    }
    return [createNormalizedMessage({
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'tool_result',
      toolId,
      content,
      isError,
    })];
  }

  // tool_call_chunk and other progressive variants are intentionally dropped:
  // the final tool_call carries the complete rawInput, so duplicating the
  // streamed args would inflate the wire transcript without UI value.
  return [];
}

async function spawnKiro(command, options = {}, ws) {
  const { sessionId, projectPath, cwd, model, agent, sessionSummary } = options;
  const workingDir = cwd || projectPath || process.cwd();

  // Process key starts as the existing sessionId (resume) or a placeholder
  // we'll replace once `session/new` returns the real id. We expose the
  // placeholder via `ws.setSessionId` so the frontend can target an abort
  // BEFORE the real id arrives (the `session/new` round-trip can take 30+s
  // while MCP servers boot).
  const placeholderKey = sessionId || `pending-${crypto.randomUUID()}`;
  let activeKey = placeholderKey;
  let capturedSessionId = sessionId || null;
  let sessionCreatedSent = false;
  let terminalNotificationSent = false;

  if (!sessionId && typeof ws.setSessionId === 'function') {
    // Frontend uses this id to send `abort-session` while we're still in the
    // ACP handshake. Once `session/new` returns, the id flips and the swap
    // below rekeys the active map.
    ws.setSessionId(placeholderKey);
  }

  // ACP `--model` and `--agent` are CLI flags applied to the FIRST session in
  // the process. They must be passed at spawn time, not in `session/prompt`
  // params (Kiro silently ignores `model`/`agent` on prompt). Resume mode
  // reuses the existing session's model, so we only set them for new sessions.
  const acpArgs = ['acp', '--trust-all-tools'];
  if (!sessionId && model) {
    acpArgs.push('--model', model);
  }
  if (!sessionId && agent) {
    acpArgs.push('--agent', agent);
  }

  const kiroProcess = spawnFunction(KIRO_BIN, acpArgs, {
    cwd: workingDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  activeKiroProcesses.set(activeKey, kiroProcess);

  console.log('Spawning Kiro CLI:', KIRO_BIN, acpArgs.join(' '));
  console.log('Working directory:', workingDir);
  console.log('Session info - Input sessionId:', sessionId);

  const client = new StdioJsonRpcClient(kiroProcess, {
    onStderr: (line) => console.error('Kiro CLI stderr:', line),
    onParseError: (rawLine) => console.warn('Kiro ACP non-JSON line:', rawLine.slice(0, 200)),
  });

  const notifyTerminalState = ({ code = null, error = null } = {}) => {
    if (terminalNotificationSent) {
      return;
    }
    terminalNotificationSent = true;

    const finalSessionId = capturedSessionId || sessionId || activeKey;
    if (code === 0 && !error) {
      notifyRunStopped({
        userId: ws?.userId || null,
        provider: PROVIDER,
        sessionId: finalSessionId,
        sessionName: sessionSummary,
        stopReason: 'completed',
      });
      return;
    }

    notifyRunFailed({
      userId: ws?.userId || null,
      provider: PROVIDER,
      sessionId: finalSessionId,
      sessionName: sessionSummary,
      error: error || `Kiro CLI exited with code ${code}`,
    });
  };

  // Stream session/update notifications onto the websocket.
  client.onNotification('session/update', (params) => {
    const targetSessionId = capturedSessionId || sessionId || null;
    const messages = normalizeAcpUpdate(params, targetSessionId);
    for (const msg of messages) {
      ws.send(msg);
    }
  });

  // Kiro extension namespace: log for debugging, but do not surface to the UI
  // in v1. Future enhancements (live MCP server status, credit usage) can hook
  // here without touching the core normalization path.
  client.onNotificationPrefix('_kiro.dev/', () => {});

  return new Promise((resolve, reject) => {
    let settled = false;
    const settleOnce = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };

    kiroProcess.on('close', async (code) => {
      activeKiroProcesses.delete(activeKey);
      ws.send(createNormalizedMessage({
        kind: 'complete',
        exitCode: code,
        isNewSession: !sessionId && !!command,
        sessionId: capturedSessionId || sessionId || activeKey,
        provider: PROVIDER,
      }));
      notifyTerminalState({ code });
      if (code === 0) {
        settleOnce(() => resolve());
      } else {
        settleOnce(() => reject(new Error(`Kiro CLI exited with code ${code}`)));
      }
    });

    kiroProcess.on('error', async (error) => {
      console.error('Kiro CLI process error:', error);
      activeKiroProcesses.delete(activeKey);

      const installed = await providerAuthService.isProviderInstalled(PROVIDER);
      const errorContent = !installed
        ? 'Kiro CLI is not installed. Install with: curl -fsSL https://cli.kiro.dev/install | bash'
        : error.message;

      ws.send(createNormalizedMessage({
        kind: 'error',
        content: errorContent,
        sessionId: capturedSessionId || sessionId || null,
        provider: PROVIDER,
      }));
      notifyTerminalState({ error });
      settleOnce(() => reject(error));
    });

    // Drive the ACP handshake → new/load → prompt sequence.
    (async () => {
      try {
        await client.request('initialize', {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
          },
        });

        if (sessionId) {
          // Resume an existing chat-store or ACP-store session by id.
          await client.request('session/load', { sessionId, cwd: workingDir, mcpServers: [] });
          capturedSessionId = sessionId;
        } else {
          const newResult = await client.request('session/new', {
            cwd: workingDir,
            mcpServers: [],
          });
          const result = newResult && typeof newResult === 'object' ? newResult : {};
          if (typeof result.sessionId === 'string' && result.sessionId) {
            capturedSessionId = result.sessionId;
            const previousKey = activeKey;
            activeKey = capturedSessionId;
            if (previousKey !== capturedSessionId) {
              activeKiroProcesses.delete(previousKey);
              activeKiroProcesses.set(activeKey, kiroProcess);
            }
            if (typeof ws.setSessionId === 'function') {
              ws.setSessionId(capturedSessionId);
            }
            if (!sessionCreatedSent) {
              sessionCreatedSent = true;
              ws.send(createNormalizedMessage({
                kind: 'session_created',
                newSessionId: capturedSessionId,
                cwd: workingDir,
                sessionId: capturedSessionId,
                provider: PROVIDER,
              }));
            }
          }
        }

        if (command && command.trim()) {
          // ACP `session/prompt` only accepts {sessionId, prompt}. Model and
          // agent are baked into the spawn-time CLI flags above; resume mode
          // inherits whatever the original session was created with.
          const promptResult = await client.request('session/prompt', {
            sessionId: capturedSessionId,
            prompt: [{ type: 'text', text: command }],
          });
          const stopReason = promptResult && typeof promptResult === 'object'
            ? promptResult.stopReason
            : null;
          if (stopReason && stopReason !== 'end_turn') {
            ws.send(createNormalizedMessage({
              kind: 'status',
              status: stopReason,
              sessionId: capturedSessionId,
              provider: PROVIDER,
            }));
          }
        }

        // Close stdin to let the child terminate naturally; the 'close' event
        // handler above resolves the outer promise.
        kiroProcess.stdin.end();
      } catch (rpcError) {
        ws.send(createNormalizedMessage({
          kind: 'error',
          content: rpcError instanceof Error ? rpcError.message : String(rpcError),
          sessionId: capturedSessionId || sessionId || null,
          provider: PROVIDER,
        }));
        // Half-close stdin so the child can drain pending writes, then SIGTERM.
        // If the child ignores SIGTERM (running tool, blocked syscall), force
        // SIGKILL after a grace window so the outer Promise resolves via the
        // 'close' event handler instead of hanging forever.
        try { kiroProcess.stdin.end(); } catch { /* already closed */ }
        try { kiroProcess.kill('SIGTERM'); } catch { /* already gone */ }
        setTimeout(() => {
          if (!kiroProcess.killed) {
            try { kiroProcess.kill('SIGKILL'); } catch { /* already gone */ }
          }
        }, 5000).unref();
      }
    })();
  });
}

function abortKiroSession(sessionId) {
  const process = activeKiroProcesses.get(sessionId);
  if (process) {
    console.log(`Aborting Kiro session: ${sessionId}`);
    process.kill('SIGTERM');
    activeKiroProcesses.delete(sessionId);
    return true;
  }
  return false;
}

function isKiroSessionActive(sessionId) {
  return activeKiroProcesses.has(sessionId);
}

function getActiveKiroSessions() {
  return Array.from(activeKiroProcesses.keys());
}

export {
  spawnKiro,
  abortKiroSession,
  isKiroSessionActive,
  getActiveKiroSessions,
};
