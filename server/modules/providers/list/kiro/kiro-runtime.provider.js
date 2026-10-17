import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

import crossSpawn from 'cross-spawn';

import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

import { StdioJsonRpcClient } from './stdio-jsonrpc-client.js';

const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

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
      kind: 'stream_delta',
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
    const status = update.status;
    if (status !== 'completed' && status !== 'failed') {
      // Intermediate (e.g. 'in_progress') updates are not surfaced to keep the
      // history reader and the live stream byte-identical.
      return [];
    }
    const isError = status === 'failed';
    let content = '';
    if (Array.isArray(update.content)) {
      content = update.content.map((part) => part?.content?.text ?? '').filter(Boolean).join('\n');
    } else if (typeof update.output === 'string') {
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

/**
 * The app allocates its session id before starting a run. Keep that id as the
 * process-map key for cancellation; only real ACP ids may reach setSessionId,
 * which now persists the app-to-provider mapping through ChatSessionWriter.
 */
async function spawnKiro(command, options = {}, ws, context) {
  const { sessionId, projectPath, cwd, model, agent, sessionSummary } = options;
  const providerSessionId = context.resolveProviderSessionId(sessionId);
  const workingDir = cwd || projectPath || process.cwd();
  const processKey = sessionId || `pending-${crypto.randomUUID()}`;
  let capturedSessionId = providerSessionId;
  let activeKey = processKey;
  let acceptingUpdates = false;
  let streamedText = '';
  let runError = null;
  let finished = false;
  let stopTimer;
  let killTimer;

  const resolvedModel = await context.resolveResumeModel(sessionId, model);
  const acpArgs = ['acp', '--trust-all-tools'];
  if (!providerSessionId && resolvedModel) acpArgs.push('--model', resolvedModel);
  if (!providerSessionId && agent) acpArgs.push('--agent', agent);

  const kiroProcess = spawnFunction(process.env.KIRO_PATH ?? 'kiro-cli', acpArgs, {
    cwd: workingDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  activeKiroProcesses.set(activeKey, kiroProcess);

  // ChildProcess.killed means a signal was sent, not that the child exited.
  // A process ignoring SIGTERM must still receive SIGKILL after the grace period.
  const terminate = () => {
    kiroProcess.stdin.end();
    kiroProcess.kill('SIGTERM');
    if (!killTimer) {
      killTimer = setTimeout(() => {
        if (kiroProcess.exitCode === null && kiroProcess.signalCode === null) {
          kiroProcess.kill('SIGKILL');
        }
      }, 5000);
      killTimer.unref();
    }
  };
  kiroProcess.abortRun = () => {
    kiroProcess.aborted = true;
    terminate();
  };

  const client = new StdioJsonRpcClient(kiroProcess, {
    onStderr: (line) => console.error('Kiro CLI stderr:', line),
    onParseError: (rawLine) => console.warn('Kiro ACP non-JSON line:', rawLine.slice(0, 200)),
  });
  const eventSessionId = () => capturedSessionId || sessionId || null;
  const flushText = () => {
    if (!streamedText) return;
    ws.send(createNormalizedMessage({
      kind: 'stream_end',
      sessionId: eventSessionId(), provider: PROVIDER,
    }));
    streamedText = '';
  };

  client.onNotification('session/update', (params) => {
    // session/load replays history, which the UI already fetched separately.
    if (!acceptingUpdates || kiroProcess.aborted || finished) return;
    for (const message of normalizeAcpUpdate(params, eventSessionId())) {
      if (message.kind === 'stream_delta') {
        streamedText += message.content;
      } else {
        flushText();
      }
      ws.send(message);
    }
  });

  return new Promise((resolve, reject) => {
    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(stopTimer);
      clearTimeout(killTimer);
      activeKiroProcesses.delete(activeKey);
      const finalSessionId = sessionId || capturedSessionId || processKey;
      if (kiroProcess.aborted) {
        // chat.abort owns the aborted terminal event and notification.
        resolve();
        return;
      }
      flushText();
      const error = runError || (code !== 0 ? new Error(`Kiro CLI exited with code ${code}`) : null);
      if (error) {
        ws.send(createNormalizedMessage({
          kind: 'error', content: error.message, sessionId: finalSessionId, provider: PROVIDER,
        }));
      }
      ws.send(createCompleteMessage({
        provider: PROVIDER, sessionId: finalSessionId, exitCode: error ? 1 : 0,
      }));
      const notification = {
        userId: ws.userId || null, provider: PROVIDER,
        sessionId: finalSessionId, sessionName: sessionSummary,
      };
      if (error) {
        notifyRunFailed({ ...notification, error });
        reject(error);
      } else {
        notifyRunStopped({ ...notification, stopReason: 'completed' });
        resolve();
      }
    };

    kiroProcess.on('close', finish);
    kiroProcess.on('error', (error) => {
      runError = error.code === 'ENOENT'
        ? new Error('Kiro CLI is not installed. Install it from https://kiro.dev/docs/cli/')
        : error;
      finish(1);
    });

    void (async () => {
      try {
        await client.request('initialize', {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        });
        if (kiroProcess.aborted || finished) return;

        if (providerSessionId) {
          await client.request('session/load', {
            sessionId: providerSessionId, cwd: workingDir, mcpServers: [],
          });
          if (resolvedModel && !kiroProcess.aborted) {
            await client.request('session/set_model', {
              sessionId: providerSessionId, modelId: resolvedModel,
            });
          }
        } else {
          const result = await client.request('session/new', { cwd: workingDir, mcpServers: [] });
          if (kiroProcess.aborted || finished) return;
          if (typeof result?.sessionId !== 'string' || !result.sessionId.trim()) {
            throw new Error('Kiro ACP did not return a session id');
          }
          capturedSessionId = result.sessionId;
          if (!sessionId) {
            activeKiroProcesses.delete(activeKey);
            activeKey = capturedSessionId;
            activeKiroProcesses.set(activeKey, kiroProcess);
          }
          ws.setSessionId?.(capturedSessionId);
          ws.send(createNormalizedMessage({
            kind: 'session_created', newSessionId: capturedSessionId,
            cwd: workingDir, sessionId: capturedSessionId, provider: PROVIDER,
          }));
        }
        if (kiroProcess.aborted || finished) return;
        acceptingUpdates = true;

        if (command?.trim()) {
          // Tool-running prompts can take much longer than the handshake timeout.
          const result = await client.request('session/prompt', {
            sessionId: capturedSessionId,
            prompt: [{ type: 'text', text: command }],
          }, { timeoutMs: 0 });
          if (result?.stopReason && result.stopReason !== 'end_turn') {
            ws.send(createNormalizedMessage({
              kind: 'status', text: result.stopReason,
              sessionId: eventSessionId(), provider: PROVIDER,
            }));
          }
        }
        flushText();
        kiroProcess.stdin.end();
        // ACP should exit on EOF; bound shutdown if a CLI version does not.
        if (!finished) {
          stopTimer = setTimeout(terminate, 5000);
          stopTimer.unref();
        }
      } catch (error) {
        if (finished || kiroProcess.aborted) return;
        runError = error instanceof Error ? error : new Error(String(error));
        terminate();
      }
    })();
  });
}

function abortKiroSession(sessionId) {
  const child = activeKiroProcesses.get(sessionId);
  if (!child) return false;
  child.abortRun();
  activeKiroProcesses.delete(sessionId);
  return true;
}

export const kiroRuntime = {
  run: spawnKiro,
  abort: abortKiroSession,
};
