import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import os from 'os';
import sessionManager from './sessionManager.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { createNormalizedMessage } from './shared/utils.js';

const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

let activeOpenClaudeProcesses = new Map();

/**
 * Builds the CLI argument array for the openclaude subprocess.
 * Exported separately so tests can verify argument construction without spawning.
 */
function buildOpenClaudeArgs(command, options = {}) {
  const args = [];

  if (command && command.trim()) {
    args.push('--print', command);
  }

  if (options.resumeSessionId) {
    args.push('--resume', options.resumeSessionId);
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  args.push('--output-format', 'stream-json');

  if (options.skipPermissions) {
    args.push('--dangerously-skip-permissions');
  }

  return args;
}

async function spawnOpenClaude(command, options = {}, ws) {
  const { sessionId, projectPath, cwd, model, permissionMode, sessionSummary } = options;
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let assistantBlocks = [];

  const ocArgs = buildOpenClaudeArgs(command, {
    resumeSessionId: sessionId ? sessionManager.getSession(sessionId)?.cliSessionId : undefined,
    model: model || undefined,
    skipPermissions: permissionMode === 'bypassPermissions' || options.skipPermissions,
  });

  const cleanPath = (cwd || projectPath || process.cwd()).replace(/[^\x20-\x7E]/g, '').trim();
  const workingDir = cleanPath;

  const openclaudePath = process.env.OPENCLAUDE_PATH || 'openclaude';
  console.log('Spawning OpenClaude CLI:', openclaudePath, ocArgs.join(' '));
  console.log('Working directory:', workingDir);

  let spawnCmd = openclaudePath;
  let spawnArgs = ocArgs;

  if (os.platform() !== 'win32') {
    spawnCmd = 'sh';
    spawnArgs = ['-c', 'exec "$0" "$@"', openclaudePath, ...ocArgs];
  }

  return new Promise((resolve, reject) => {
    const ocProcess = spawnFunction(spawnCmd, spawnArgs, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    let terminalNotificationSent = false;
    let terminalFailureReason = null;

    const notifyTerminalState = ({ code = null, error = null } = {}) => {
      if (terminalNotificationSent) return;
      terminalNotificationSent = true;
      const finalSessionId = capturedSessionId || sessionId || processKey;
      if (code === 0 && !error) {
        notifyRunStopped({ userId: ws?.userId || null, provider: 'openclaude', sessionId: finalSessionId, sessionName: sessionSummary, stopReason: 'completed' });
        return;
      }
      notifyRunFailed({ userId: ws?.userId || null, provider: 'openclaude', sessionId: finalSessionId, sessionName: sessionSummary, error: error || terminalFailureReason || `OpenClaude CLI exited with code ${code}` });
    };

    const processKey = capturedSessionId || sessionId || Date.now().toString();
    activeOpenClaudeProcesses.set(processKey, ocProcess);
    ocProcess.sessionId = processKey;

    ocProcess.stdin.end();

    const timeoutMs = 120000;
    let timeout;

    const startTimeout = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : (capturedSessionId || sessionId || processKey);
        terminalFailureReason = `OpenClaude CLI timeout - no response for ${timeoutMs / 1000} seconds`;
        ws.send(createNormalizedMessage({ kind: 'error', content: terminalFailureReason, sessionId: socketSessionId, provider: 'openclaude' }));
        try { ocProcess.kill('SIGTERM'); } catch (e) { }
      }, timeoutMs);
    };

    startTimeout();

    if (command && capturedSessionId) {
      sessionManager.addMessage(capturedSessionId, 'user', command);
    }

    // OpenClaude outputs NDJSON (stream-json) — same format as Claude Code / Gemini CLI
    let buffer = '';

    ocProcess.stdout.on('data', (data) => {
      const rawOutput = data.toString();
      startTimeout();

      if (!sessionId && !sessionCreatedSent && !capturedSessionId) {
        capturedSessionId = `openclaude_${Date.now()}`;
        sessionCreatedSent = true;
        sessionManager.createSession(capturedSessionId, cwd || process.cwd());
        if (command) {
          sessionManager.addMessage(capturedSessionId, 'user', command);
        }
        if (processKey !== capturedSessionId) {
          activeOpenClaudeProcesses.delete(processKey);
          activeOpenClaudeProcesses.set(capturedSessionId, ocProcess);
        }
        ws.setSessionId && typeof ws.setSessionId === 'function' && ws.setSessionId(capturedSessionId);
        ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'openclaude' }));
      }

      buffer += rawOutput;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed);
          const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : (capturedSessionId || sessionId);

          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text') {
                assistantBlocks.push({ type: 'text', text: block.text });
                ws.send(createNormalizedMessage({ kind: 'stream_delta', content: block.text, sessionId: socketSessionId, provider: 'openclaude' }));
              } else if (block.type === 'tool_use') {
                assistantBlocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
                ws.send(createNormalizedMessage({ kind: 'tool_use', toolId: block.id, toolName: block.name, input: block.input, sessionId: socketSessionId, provider: 'openclaude' }));
              }
            }
          } else if (event.type === 'content_block_delta' && event.delta?.text) {
            if (assistantBlocks.length > 0 && assistantBlocks[assistantBlocks.length - 1].type === 'text') {
              assistantBlocks[assistantBlocks.length - 1].text += event.delta.text;
            } else {
              assistantBlocks.push({ type: 'text', text: event.delta.text });
            }
            ws.send(createNormalizedMessage({ kind: 'stream_delta', content: event.delta.text, sessionId: socketSessionId, provider: 'openclaude' }));
          } else if (event.type === 'result' && event.result) {
            if (capturedSessionId) {
              const sess = sessionManager.getSession(capturedSessionId);
              if (sess && !sess.cliSessionId && event.session_id) {
                sess.cliSessionId = event.session_id;
                sessionManager.saveSession(capturedSessionId);
              }
            }
          }
        } catch {
          // Non-JSON line — send as raw text
          const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : (capturedSessionId || sessionId);
          if (trimmed) {
            if (assistantBlocks.length > 0 && assistantBlocks[assistantBlocks.length - 1].type === 'text') {
              assistantBlocks[assistantBlocks.length - 1].text += trimmed;
            } else {
              assistantBlocks.push({ type: 'text', text: trimmed });
            }
            ws.send(createNormalizedMessage({ kind: 'stream_delta', content: trimmed, sessionId: socketSessionId, provider: 'openclaude' }));
          }
        }
      }
    });

    ocProcess.stderr.on('data', (data) => {
      const errorMsg = data.toString();
      if (errorMsg.includes('[DEP0040]') || errorMsg.includes('DeprecationWarning') || errorMsg.includes('--trace-deprecation')) {
        return;
      }
      const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : (capturedSessionId || sessionId);
      ws.send(createNormalizedMessage({ kind: 'error', content: errorMsg, sessionId: socketSessionId, provider: 'openclaude' }));
    });

    ocProcess.on('close', async (code) => {
      clearTimeout(timeout);
      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeOpenClaudeProcesses.delete(finalSessionId);

      if (finalSessionId && assistantBlocks.length > 0) {
        sessionManager.addMessage(finalSessionId, 'assistant', assistantBlocks);
      }

      ws.send(createNormalizedMessage({ kind: 'complete', exitCode: code, isNewSession: !sessionId && !!command, sessionId: finalSessionId, provider: 'openclaude' }));

      if (code === 0) {
        notifyTerminalState({ code });
        resolve();
      } else {
        if (code === 127) {
          const installed = await providerAuthService.isProviderInstalled('openclaude');
          if (!installed) {
            const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : finalSessionId;
            ws.send(createNormalizedMessage({ kind: 'error', content: 'OpenClaude CLI is not installed. Install it: npm i -g @gitlawb/openclaude', sessionId: socketSessionId, provider: 'openclaude' }));
          }
        }
        notifyTerminalState({ code, error: code === null ? 'OpenClaude CLI process was terminated or timed out' : null });
        reject(new Error(code === null ? 'OpenClaude CLI process was terminated or timed out' : `OpenClaude CLI exited with code ${code}`));
      }
    });

    ocProcess.on('error', async (error) => {
      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeOpenClaudeProcesses.delete(finalSessionId);
      const installed = await providerAuthService.isProviderInstalled('openclaude');
      const errorContent = !installed ? 'OpenClaude CLI is not installed. Install it: npm i -g @gitlawb/openclaude' : error.message;
      const errorSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : finalSessionId;
      ws.send(createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: errorSessionId, provider: 'openclaude' }));
      notifyTerminalState({ error });
      reject(error);
    });
  });
}

function abortOpenClaudeSession(sessionId) {
  let proc = activeOpenClaudeProcesses.get(sessionId);
  let processKey = sessionId;

  if (!proc) {
    for (const [key, p] of activeOpenClaudeProcesses.entries()) {
      if (p.sessionId === sessionId) {
        proc = p;
        processKey = key;
        break;
      }
    }
  }

  if (proc) {
    try {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (activeOpenClaudeProcesses.has(processKey)) {
          try { proc.kill('SIGKILL'); } catch (e) { }
        }
      }, 2000);
      return true;
    } catch (error) {
      return false;
    }
  }
  return false;
}

function isOpenClaudeSessionActive(sessionId) {
  return activeOpenClaudeProcesses.has(sessionId);
}

function getActiveOpenClaudeSessions() {
  return Array.from(activeOpenClaudeProcesses.keys());
}

export {
  spawnOpenClaude,
  abortOpenClaudeSession,
  isOpenClaudeSessionActive,
  getActiveOpenClaudeSessions,
  buildOpenClaudeArgs,
};
