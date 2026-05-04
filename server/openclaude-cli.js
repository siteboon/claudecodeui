import { spawn } from 'child_process';

import crossSpawn from 'cross-spawn';

import { sessionsService } from './modules/providers/services/sessions.service.js';
import { createNormalizedMessage } from './shared/utils.js';

const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

let activeOpenClaudeProcesses = new Map();

export async function spawnOpenClaude(command, options = {}, ws) {
  return new Promise(async (resolve, reject) => {
    const { sessionId, projectPath, cwd, resume, model, agentsPath, agentName } = options;
    let capturedSessionId = sessionId || `occ-${Date.now()}`;
    let settled = false;

    const baseArgs = [];

    if (resume && sessionId) {
      baseArgs.push('--resume', sessionId);
    }

    if (command && command.trim()) {
      baseArgs.push('-p', command);
    }

    if (model) {
      baseArgs.push('--model', model);
    }

    if (agentsPath || process.env.OCC_AGENTS_PATH) {
      baseArgs.push('--agents', agentsPath || process.env.OCC_AGENTS_PATH);
    }

    if (agentName) {
      baseArgs.push('--agent', agentName);
    }

    baseArgs.push('--output-format', 'stream-json');

    const workingDir = cwd || projectPath || process.cwd();
    const occBin = process.env.OCC_PATH || 'occ';

    const spawnEnv = { ...process.env };
    if (process.env.OPENAI_API_BASE) {
      spawnEnv.ANTHROPIC_BASE_URL = process.env.OPENAI_API_BASE.replace('/v1', '');
    }

    const processKey = capturedSessionId;

    const settleOnce = (callback) => {
      if (settled) return;
      settled = true;
      activeOpenClaudeProcesses.delete(processKey);
      callback();
    };

    try {
      const occProcess = spawnFunction(occBin, baseArgs, {
        cwd: workingDir,
        env: spawnEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      activeOpenClaudeProcesses.set(processKey, occProcess);

      if (!sessionId) {
        try {
          await sessionsService.ensureSessionAndProject(capturedSessionId, 'openclaude', workingDir);
        } catch { /* best-effort */ }
      }

      ws.send(createNormalizedMessage({
        kind: 'session_created',
        sessionId: capturedSessionId,
        provider: 'openclaude',
      }));

      let lineBuffer = '';

      occProcess.stdout.on('data', (chunk) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            const msg = normalizeOccEvent(event, capturedSessionId);
            if (msg) ws.send(msg);
          } catch {
            ws.send(createNormalizedMessage({
              kind: 'text',
              content: line,
              sessionId: capturedSessionId,
              provider: 'openclaude',
              role: 'assistant',
            }));
          }
        }
      });

      occProcess.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        ws.send(createNormalizedMessage({
          kind: 'error',
          content: text,
          isError: true,
          sessionId: capturedSessionId,
          provider: 'openclaude',
        }));
      });

      occProcess.on('close', (code) => {
        ws.send(createNormalizedMessage({
          kind: 'complete',
          exitCode: code,
          sessionId: capturedSessionId,
          provider: 'openclaude',
        }));
        settleOnce(() => resolve({ exitCode: code, sessionId: capturedSessionId }));
      });

      occProcess.on('error', (err) => {
        ws.send(createNormalizedMessage({
          kind: 'error',
          content: `Failed to start occ: ${err.message}`,
          isError: true,
          sessionId: capturedSessionId,
          provider: 'openclaude',
        }));
        settleOnce(() => reject(err));
      });
    } catch (err) {
      settleOnce(() => reject(err));
    }
  });
}

function normalizeOccEvent(event, sessionId) {
  const base = { sessionId, provider: 'openclaude' };

  switch (event.type) {
    case 'stream_event':
      return createNormalizedMessage({ ...base, kind: 'stream_delta', content: event.text, role: 'assistant' });

    case 'tool_use':
      return createNormalizedMessage({ ...base, kind: 'tool_use', toolName: event.name, toolInput: event.input, toolId: event.tool_use_id });

    case 'tool_result':
      return createNormalizedMessage({ ...base, kind: 'tool_result', toolId: event.tool_use_id, toolResult: { content: event.content, isError: event.is_error } });

    case 'thinking':
      return createNormalizedMessage({ ...base, kind: 'thinking', content: event.content, role: 'assistant' });

    case 'error':
      return createNormalizedMessage({ ...base, kind: 'error', content: event.message, isError: true });

    case 'stop':
      return createNormalizedMessage({ ...base, kind: 'complete', reason: event.reason });

    case 'stream_request_start':
      return createNormalizedMessage({ ...base, kind: 'status', status: 'thinking', content: `Turn ${event.turn || 1}` });

    case 'compaction':
      return createNormalizedMessage({ ...base, kind: 'status', status: 'compacting', content: `Compacted ${event.count} messages` });

    default:
      return null;
  }
}

export function abortOpenClaudeSession(sessionId) {
  const proc = activeOpenClaudeProcesses.get(sessionId);
  if (!proc) return false;
  try {
    proc.kill('SIGTERM');
    activeOpenClaudeProcesses.delete(sessionId);
    return true;
  } catch {
    return false;
  }
}

export function isOpenClaudeSessionActive(sessionId) {
  return activeOpenClaudeProcesses.has(sessionId);
}

export function getActiveOpenClaudeSessions() {
  return activeOpenClaudeProcesses;
}
