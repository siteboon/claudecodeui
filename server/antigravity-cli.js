import crossSpawn from 'cross-spawn';

import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { createCompleteMessage, createNormalizedMessage, flattenPromptForWindowsShell } from './shared/utils.js';

const spawnFunction = crossSpawn;

const activeAntigravityProcesses = new Map();

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
    const conversationId = sessionId || appSessionId || Date.now().toString();
    const processKey = conversationId;
    let antigravityProcess = null;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let completeSent = false;
    let terminalNotificationSent = false;

    if (ws.setSessionId && typeof ws.setSessionId === 'function') {
      ws.setSessionId(conversationId);
    }

    ws.send(createNormalizedMessage({
      kind: 'session_created',
      newSessionId: conversationId,
      sessionId: conversationId,
      provider: 'antigravity',
    }));

    const notifyTerminalState = ({ code = null, error = null } = {}) => {
      if (terminalNotificationSent) {
        return;
      }

      terminalNotificationSent = true;
      if (code === 0 && !error) {
        notifyRunStopped({
          userId: ws?.userId || null,
          provider: 'antigravity',
          sessionId: conversationId,
          sessionName: sessionSummary,
          stopReason: 'completed',
        });
        return;
      }

      notifyRunFailed({
        userId: ws?.userId || null,
        provider: 'antigravity',
        sessionId: conversationId,
        sessionName: sessionSummary,
        error: error || `Antigravity CLI exited with code ${code}`,
      });
    };

    void providerModelsService.resolveResumeModel('antigravity', conversationId, model).then((resolvedModel) => {
      const args = ['--print', '--conversation', conversationId];
      if (resolvedModel) {
        args.push('--model', resolvedModel);
      }
      args.push(...resolveAntigravityPermissionArgs(permissionMode));
      if (command && command.trim()) {
        args.push(flattenPromptForWindowsShell(command.trim()));
      }

      antigravityProcess = spawnFunction('agy', args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      activeAntigravityProcesses.set(processKey, antigravityProcess);
      antigravityProcess.sessionId = conversationId;
      antigravityProcess.stdin.end();

      antigravityProcess.stdout.on('data', (data) => {
        stdoutBuffer += data.toString();
      });

      antigravityProcess.stderr.on('data', (data) => {
        stderrBuffer += data.toString();
      });

      antigravityProcess.on('close', async (code) => {
        activeAntigravityProcesses.delete(processKey);

        const stdoutText = stdoutBuffer.trim();
        if (stdoutText) {
          sendAntigravityText(ws, stdoutText, conversationId);
        }

        const stderrText = stderrBuffer.trim();
        if (stderrText) {
          ws.send(createNormalizedMessage({
            kind: code === 0 ? 'stream_delta' : 'error',
            content: stderrText,
            sessionId: conversationId,
            provider: 'antigravity',
          }));
        }

        if (!completeSent && !antigravityProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'antigravity', sessionId: conversationId, exitCode: code }));
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
              sessionId: conversationId,
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
          sessionId: conversationId,
          provider: 'antigravity',
        }));
        if (!completeSent && !antigravityProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'antigravity', sessionId: conversationId, exitCode: 1 }));
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
