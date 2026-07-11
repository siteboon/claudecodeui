import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import crossSpawn from 'cross-spawn';

import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { buildProviderCliEnv, createCompleteMessage, createNormalizedMessage, flattenPromptForWindowsShell } from './shared/utils.js';

const spawnFunction = crossSpawn;

const activeAntigravityProcesses = new Map();
function getAntigravityConversationsDir() {
  return process.env.ANTIGRAVITY_CONVERSATIONS_DIR
    || path.join(os.homedir(), '.gemini', 'antigravity-cli', 'conversations');
}

export function resolveAntigravityPermissionArgs(permissionMode) {
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

function sendAntigravityText(ws, text, sessionId) {
  const normalized = sessionsService.normalizeMessage('antigravity', text, sessionId);
  for (const message of normalized) {
    ws.send(message);
  }
}

function readAntigravityConversationDbFiles() {
  try {
    const conversationsDir = getAntigravityConversationsDir();
    return fs.readdirSync(conversationsDir)
      .filter((fileName) => fileName.endsWith('.db'))
      .map((fileName) => {
        const absolutePath = path.join(conversationsDir, fileName);
        const id = fileName.slice(0, -'.db'.length);
        const stat = fs.statSync(absolutePath);
        return { id, mtimeMs: stat.mtimeMs };
      });
  } catch {
    return [];
  }
}

function findNewAntigravityConversationId(previousIds, startedAtMs) {
  return readAntigravityConversationDbFiles()
    .filter((entry) => !previousIds.has(entry.id) && entry.mtimeMs >= startedAtMs - 1000)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.id || null;
}

function announceAntigravityConversation(ws, conversationId) {
  if (!conversationId) {
    return;
  }

  if (ws.setSessionId && typeof ws.setSessionId === 'function') {
    ws.setSessionId(conversationId);
  }

  ws.send(createNormalizedMessage({
    kind: 'session_created',
    newSessionId: conversationId,
    sessionId: conversationId,
    provider: 'antigravity',
  }));
}

async function spawnAntigravity(command, options = {}, ws) {
  return new Promise((resolve, reject) => {
    const {
      appSessionId,
      sessionId,
      projectPath,
      cwd,
      model,
      sessionSummary,
      permissionMode,
    } = options;
    const workingDir = cwd || projectPath || process.cwd();
    const resumeConversationId = sessionId || null;
    const fallbackSessionId = appSessionId || resumeConversationId || Date.now().toString();
    const processKey = resumeConversationId || fallbackSessionId;
    const startedAtMs = Date.now();
    const previousConversationIds = new Set(readAntigravityConversationDbFiles().map((entry) => entry.id));
    let antigravityProcess = null;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let completeSent = false;
    let terminalNotificationSent = false;

    const notifyTerminalState = ({ code = null, error = null } = {}) => {
      if (terminalNotificationSent) {
        return;
      }

      terminalNotificationSent = true;
      if (code === 0 && !error) {
        notifyRunStopped({
          userId: ws?.userId || null,
          provider: 'antigravity',
          sessionId: processKey,
          sessionName: sessionSummary,
          stopReason: 'completed',
        });
        return;
      }

      notifyRunFailed({
        userId: ws?.userId || null,
        provider: 'antigravity',
        sessionId: processKey,
        sessionName: sessionSummary,
        error: error || `Antigravity CLI exited with code ${code}`,
      });
    };

    void providerModelsService.resolveResumeModel('antigravity', resumeConversationId || fallbackSessionId, model).then((resolvedModel) => {
      const args = [];
      if (resumeConversationId) {
        args.push('--conversation', resumeConversationId);
      }
      if (resolvedModel) {
        args.push('--model', resolvedModel);
      }
      args.push(...resolveAntigravityPermissionArgs(permissionMode));
      args.push('--print');
      if (command && command.trim()) {
        args.push(flattenPromptForWindowsShell(command.trim()));
      } else {
        args.push('');
      }

      antigravityProcess = spawnFunction('agy', args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: buildProviderCliEnv(),
      });

      activeAntigravityProcesses.set(processKey, antigravityProcess);
      antigravityProcess.sessionId = processKey;
      antigravityProcess.stdin.end();

      antigravityProcess.stdout.on('data', (data) => {
        stdoutBuffer += data.toString();
      });

      antigravityProcess.stderr.on('data', (data) => {
        stderrBuffer += data.toString();
      });

      antigravityProcess.on('close', async (code) => {
        activeAntigravityProcesses.delete(processKey);
        const finalConversationId = resumeConversationId || findNewAntigravityConversationId(previousConversationIds, startedAtMs);
        const outputSessionId = finalConversationId || fallbackSessionId;

        if (finalConversationId) {
          announceAntigravityConversation(ws, finalConversationId);
        }

        const stdoutText = stdoutBuffer.trim();
        if (stdoutText) {
          sendAntigravityText(ws, stdoutText, outputSessionId);
        }

        const stderrText = stderrBuffer.trim();
        if (stderrText) {
          ws.send(createNormalizedMessage({
            kind: code === 0 ? 'stream_delta' : 'error',
            content: stderrText,
            sessionId: outputSessionId,
            provider: 'antigravity',
          }));
        }

        if (!completeSent && !antigravityProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'antigravity', sessionId: outputSessionId, exitCode: code }));
        }

        if (code === 0) {
          notifyTerminalState({ code });
          resolve();
          return;
        }

        if (code === 127 || code === null) {
          const installed = await providerAuthService.isProviderInstalled('antigravity');
          if (!installed) {
            ws.send(createNormalizedMessage({
              kind: 'error',
              content: 'Antigravity CLI is not installed. Install it from https://antigravity.google/cli/install.sh',
              sessionId: outputSessionId,
              provider: 'antigravity',
            }));
          }
        }

        notifyTerminalState({ code });
        reject(new Error(code === null ? 'Antigravity CLI process was terminated' : `Antigravity CLI exited with code ${code}`));
      });

      antigravityProcess.on('error', async (error) => {
        activeAntigravityProcesses.delete(processKey);

        const installed = await providerAuthService.isProviderInstalled('antigravity');
        const errorContent = !installed
          ? 'Antigravity CLI is not installed. Install it from https://antigravity.google/cli/install.sh'
          : error.message;

        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: fallbackSessionId,
          provider: 'antigravity',
        }));
        if (!completeSent && !antigravityProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'antigravity', sessionId: fallbackSessionId, exitCode: 1 }));
        }
        notifyTerminalState({ error });
        reject(error);
      });
    }).catch(reject);
  });
}

function abortAntigravitySession(sessionId) {
  const process = activeAntigravityProcesses.get(sessionId);
  if (!process) {
    return false;
  }

  process.aborted = true;
  process.kill('SIGTERM');
  activeAntigravityProcesses.delete(sessionId);
  return true;
}

function isAntigravitySessionActive(sessionId) {
  return activeAntigravityProcesses.has(sessionId);
}

function getActiveAntigravitySessions() {
  return Array.from(activeAntigravityProcesses.keys());
}

export {
  spawnAntigravity,
  abortAntigravitySession,
  isAntigravitySessionActive,
  getActiveAntigravitySessions,
};
