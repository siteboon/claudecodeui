import crossSpawn from 'cross-spawn';

import { appendImagesInputTag } from '@/shared/image-attachments.js';
import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { providerAuthService } from '@/modules/providers/services/provider-auth.service.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import { createCompleteMessage, createNormalizedMessage, flattenPromptForWindowsShell } from '@/shared/utils.js';

// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;

let activeCursorProcesses = new Map(); // Track active processes by session ID

const WORKSPACE_TRUST_PATTERNS = [
  /workspace trust required/i,
  /do you trust the contents of this directory/i,
  /working with untrusted contents/i,
  /pass --trust,\s*--yolo,\s*or -f/i
];

function isWorkspaceTrustPrompt(text = '') {
  if (!text || typeof text !== 'string') {
    return false;
  }

  return WORKSPACE_TRUST_PATTERNS.some((pattern) => pattern.test(text));
}

async function spawnCursor(command, options = {}, ws) {
  return new Promise(async (resolve, reject) => {
    const { sessionId, projectPath, cwd, toolsSettings, skipPermissions, model, sessionSummary, images } = options;
    // Callers pass the stable app session id; the CLI resumes with the
    // provider-native id recorded on the session row.
    const providerSessionId = sessionsService.resolveProviderSessionId(sessionId);
    const resolvedModel = await providerModelsService.resolveResumeModel('cursor', sessionId, model);
    let capturedSessionId = providerSessionId; // Track the provider-native session id throughout the process
    let sessionCreatedSent = false; // Track if we've already sent session-created event
    let hasRetriedWithTrust = false;
    let settled = false;
    // The unified lifecycle contract requires exactly one terminal `complete`
    // per run. Cursor surfaces completion twice (the `result` JSON line and
    // the process close), so the first emission wins.
    let completeSent = false;

    // Use tools settings passed from frontend, or defaults
    const settings = toolsSettings || {
      allowedShellCommands: [],
      skipPermissions: false
    };

    // Build Cursor CLI command
    const baseArgs = [];

    // Build flags allowing both resume and prompt together (reply in existing session)
    // Treat a known provider-native id as intention to resume
    if (providerSessionId) {
      baseArgs.push('--resume=' + providerSessionId);
    }

    if (command && command.trim()) {
      // Provide a prompt (works for both new and resumed sessions). Image
      // attachments ride along as an <images_input> path list appended to the
      // prompt; the session history reader strips the tag back out for display.
      // cursor-agent is a .cmd shim on Windows, so the whole argument must be
      // newline-free or cmd.exe silently truncates it at the first newline.
      baseArgs.push('-p', flattenPromptForWindowsShell(appendImagesInputTag(command, images)));

      // Model overrides are applied to both new and resumed sessions so a
      // session-scoped change request can take effect on the next turn.
      if (resolvedModel) {
        baseArgs.push('--model', resolvedModel);
      }

      // Request streaming JSON when we are providing a prompt
      baseArgs.push('--output-format', 'stream-json');
    }

    // Add skip permissions flag if enabled
    if (skipPermissions || settings.skipPermissions) {
      baseArgs.push('-f');
    }

    // Use cwd (actual project directory) instead of projectPath
    const workingDir = cwd || projectPath || process.cwd();

    // Store process reference for potential abort — keyed by the app session
    // id when the caller supplied one, so abort-by-app-id always works.
    const processKey = sessionId || Date.now().toString();

    const settleOnce = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      callback();
    };

    const runCursorProcess = (args, runReason = 'initial') => {
      const isTrustRetry = runReason === 'trust-retry';
      let runSawWorkspaceTrustPrompt = false;
      let stdoutLineBuffer = '';
      let terminalNotificationSent = false;

      const notifyTerminalState = ({ code = null, error = null } = {}) => {
        if (terminalNotificationSent) {
          return;
        }

        terminalNotificationSent = true;

        // Notifications are app-facing, so they carry the app session id.
        const finalSessionId = sessionId || capturedSessionId || processKey;
        if (code === 0 && !error) {
          notifyRunStopped({
            userId: ws?.userId || null,
            provider: 'cursor',
            sessionId: finalSessionId,
            sessionName: sessionSummary,
            stopReason: 'completed'
          });
          return;
        }

        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'cursor',
          sessionId: finalSessionId,
          sessionName: sessionSummary,
          error: error || `Cursor CLI exited with code ${code}`
        });
      };

      if (isTrustRetry) {
        console.log('Retrying Cursor CLI with --trust after workspace trust prompt');
      }

      const cursorProcess = spawnFunction('cursor-agent', args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env } // Inherit all environment variables
      });

      activeCursorProcesses.set(processKey, cursorProcess);

      const shouldSuppressForTrustRetry = (text) => {
        if (hasRetriedWithTrust || args.includes('--trust')) {
          return false;
        }
        if (!isWorkspaceTrustPrompt(text)) {
          return false;
        }

        runSawWorkspaceTrustPrompt = true;
        return true;
      };

      const processCursorOutputLine = (line) => {
        if (!line || !line.trim()) {
          return;
        }

        try {
          const response = JSON.parse(line);

          // Handle different message types
          switch (response.type) {
            case 'system':
              if (response.subtype === 'init') {
                // Capture session ID
                if (response.session_id && !capturedSessionId) {
                  capturedSessionId = response.session_id;

                  // Legacy/direct callers without an app session id re-key the
                  // process under the provider-native id once it is known.
                  if (!sessionId && processKey !== capturedSessionId) {
                    activeCursorProcesses.delete(processKey);
                    activeCursorProcesses.set(capturedSessionId, cursorProcess);
                  }

                  // Set session ID on writer (for API endpoint compatibility)
                  if (ws.setSessionId && typeof ws.setSessionId === 'function') {
                    ws.setSessionId(capturedSessionId);
                  }

                  // Send session-created event only once for sessions with nothing to resume
                  if (!providerSessionId && !sessionCreatedSent) {
                    sessionCreatedSent = true;
                    ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, model: response.model, cwd: response.cwd, sessionId: capturedSessionId, provider: 'cursor' }));
                  }
                }

                // System info — no longer needed by the frontend (session-lifecycle 'created' handles nav).
              }
              break;

            case 'user':
              // User messages are not displayed in the UI — skip.
              break;

            case 'assistant':
              // Accumulate assistant message chunks
              if (response.message && response.message.content && response.message.content.length > 0) {
                const normalized = sessionsService.normalizeMessage('cursor', response, capturedSessionId || sessionId || null);
                for (const msg of normalized) ws.send(msg);
              }
              break;

            case 'result': {
              // Session complete — terminal lifecycle event for this run
              if (!completeSent) {
                completeSent = true;
                ws.send(createCompleteMessage({
                  provider: 'cursor',
                  sessionId: capturedSessionId || sessionId || null,
                  exitCode: response.subtype === 'success' ? 0 : 1,
                }));
              }
              break;
            }

            default:
              // Unknown message types — ignore.
          }
        } catch (parseError) {
          if (shouldSuppressForTrustRetry(line)) {
            return;
          }

          // If not JSON, send as stream delta via adapter
          const normalized = sessionsService.normalizeMessage('cursor', line, capturedSessionId || sessionId || null);
          for (const msg of normalized) ws.send(msg);
        }
      };

      // Handle stdout (streaming JSON responses)
      cursorProcess.stdout.on('data', (data) => {
        const rawOutput = data.toString();

        // Stream chunks can split JSON objects across packets; keep trailing partial line.
        stdoutLineBuffer += rawOutput;
        const completeLines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = completeLines.pop() || '';

        completeLines.forEach((line) => {
          processCursorOutputLine(line.trim());
        });
      });

      // Handle stderr
      cursorProcess.stderr.on('data', (data) => {
        const stderrText = data.toString();
        console.error('Cursor CLI stderr:', stderrText);

        if (shouldSuppressForTrustRetry(stderrText)) {
          return;
        }

        ws.send(createNormalizedMessage({ kind: 'error', content: stderrText, sessionId: capturedSessionId || sessionId || null, provider: 'cursor' }));
      });

      // Handle process completion
      cursorProcess.on('close', async (code) => {
        // The process map is keyed by the app session id when one was given,
        // otherwise by the captured provider id (or the timestamp fallback).
        const finalSessionId = sessionId || capturedSessionId || processKey;
        activeCursorProcesses.delete(finalSessionId);

        // Flush any final unterminated stdout line before completion handling.
        if (stdoutLineBuffer.trim()) {
          processCursorOutputLine(stdoutLineBuffer.trim());
          stdoutLineBuffer = '';
        }

        if (
          runSawWorkspaceTrustPrompt &&
          code !== 0 &&
          !hasRetriedWithTrust &&
          !args.includes('--trust')
        ) {
          hasRetriedWithTrust = true;
          runCursorProcess([...args, '--trust'], 'trust-retry');
          return;
        }

        // Terminal complete — unless the `result` line already sent it, or the
        // run was aborted (abort-session sent the aborted complete).
        if (!completeSent && !cursorProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'cursor', sessionId: finalSessionId, exitCode: code }));
        }

        if (code === 0) {
          notifyTerminalState({ code });
          settleOnce(() => resolve());
        } else {
          notifyTerminalState({ code });
          settleOnce(() => reject(new Error(`Cursor CLI exited with code ${code}`)));
        }
      });

      // Handle process errors
      cursorProcess.on('error', async (error) => {
        console.error('Cursor CLI process error:', error);

        // Clean up process reference on error
        const finalSessionId = sessionId || capturedSessionId || processKey;
        activeCursorProcesses.delete(finalSessionId);

        // Check if Cursor CLI is installed for a clearer error message
        const installed = await providerAuthService.isProviderInstalled('cursor');
        const errorContent = !installed
          ? 'Cursor CLI is not installed. Please install it from https://cursor.com'
          : error.message;

        ws.send(createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'cursor' }));
        if (!completeSent && !cursorProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'cursor', sessionId: capturedSessionId || sessionId || null, exitCode: 1 }));
        }
        notifyTerminalState({ error });

        settleOnce(() => reject(error));
      });

      // Close stdin since Cursor doesn't need interactive input
      cursorProcess.stdin.end();
    };

    runCursorProcess(baseArgs, 'initial');
  });
}

function abortCursorSession(sessionId) {
  const process = activeCursorProcesses.get(sessionId);
  if (process) {
    console.log(`Aborting Cursor session: ${sessionId}`);
    // The abort handler sends the terminal complete (aborted: true); flag the
    // process so its close handler does not emit a second one.
    process.aborted = true;
    process.kill('SIGTERM');
    activeCursorProcesses.delete(sessionId);
    return true;
  }
  return false;
}

function isCursorSessionActive(sessionId) {
  return activeCursorProcesses.has(sessionId);
}

function getActiveCursorSessions() {
  return Array.from(activeCursorProcesses.keys());
}

export const cursorRuntime = {
  run: spawnCursor,
  abort: abortCursorSession,
};

export {
  spawnCursor,
  abortCursorSession,
  isCursorSessionActive,
  getActiveCursorSessions
};
