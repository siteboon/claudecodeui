import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { cursorAdapter } from './providers/cursor/adapter.js';
import { createNormalizedMessage } from './providers/types.js';

// Use cross-spawn on Windows for better command execution
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

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
    const { sessionId, projectPath, cwd, resume, toolsSettings, skipPermissions, model, sessionSummary } = options;
    let capturedSessionId = sessionId; // Track session ID throughout the process
    let sessionCreatedSent = false; // Track if we've already sent session-created event
    let hasRetriedWithTrust = false;
    let settled = false;

    // Use tools settings passed from frontend, or defaults
    const settings = toolsSettings || {
      allowedShellCommands: [],
      skipPermissions: false
    };

    // Build Cursor CLI command
    const baseArgs = [];

    // Build flags allowing both resume and prompt together (reply in existing session)
    // Treat presence of sessionId as intention to resume, regardless of resume flag
    if (sessionId) {
      baseArgs.push('--resume=' + sessionId);
    }

    if (command && command.trim()) {
      // Provide a prompt (works for both new and resumed sessions)
      baseArgs.push('-p', command);

      // Add model flag if specified (only meaningful for new sessions; harmless on resume)
      if (!sessionId && model) {
        baseArgs.push('--model', model);
      }

      // Request streaming JSON when we are providing a prompt
      baseArgs.push('--output-format', 'stream-json');
    }

    // Add skip permissions flag if enabled
    if (skipPermissions || settings.skipPermissions) {
      baseArgs.push('-f');
      console.log('Using -f flag (skip permissions)');
    }

    // Use cwd (actual project directory) instead of projectPath
    const workingDir = cwd || projectPath || process.cwd();

    // Store process reference for potential abort
    const processKey = capturedSessionId || Date.now().toString();

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

        const finalSessionId = capturedSessionId || sessionId || processKey;
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

      console.log('Spawning Cursor CLI:', 'cursor-agent', args.join(' '));
      console.log('Working directory:', workingDir);
      console.log('Session info - Input sessionId:', sessionId, 'Resume:', resume);

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
          console.log('Parsed JSON response:', response);

          // Handle different message types
          switch (response.type) {
            case 'system':
              if (response.subtype === 'init') {
                // Capture session ID
                if (response.session_id && !capturedSessionId) {
                  capturedSessionId = response.session_id;
                  console.log('Captured session ID:', capturedSessionId);

                  // Update process key with captured session ID
                  if (processKey !== capturedSessionId) {
                    activeCursorProcesses.delete(processKey);
                    activeCursorProcesses.set(capturedSessionId, cursorProcess);
                  }

                  // Set session ID on writer (for API endpoint compatibility)
                  if (ws.setSessionId && typeof ws.setSessionId === 'function') {
                    ws.setSessionId(capturedSessionId);
                  }

                  // Send session-created event only once for new sessions
                  if (!sessionId && !sessionCreatedSent) {
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
                const normalized = cursorAdapter.normalizeMessage(response, capturedSessionId || sessionId || null);
                for (const msg of normalized) ws.send(msg);
              }
              break;

            case 'result': {
              // Session complete — send stream end + lifecycle complete with result payload
              console.log('Cursor session result:', response);
              const resultText = typeof response.result === 'string' ? response.result : '';
              ws.send(createNormalizedMessage({
                kind: 'complete',
                exitCode: response.subtype === 'success' ? 0 : 1,
                resultText,
                isError: response.subtype !== 'success',
                sessionId: capturedSessionId || sessionId, provider: 'cursor',
              }));
              break;
            }

            default:
              // Unknown message types — ignore.
          }
        } catch (parseError) {
          console.log('Non-JSON response:', line);

          if (shouldSuppressForTrustRetry(line)) {
            return;
          }

          // If not JSON, send as stream delta via adapter
          const normalized = cursorAdapter.normalizeMessage(line, capturedSessionId || sessionId || null);
          for (const msg of normalized) ws.send(msg);
        }
      };

      // Handle stdout (streaming JSON responses)
      cursorProcess.stdout.on('data', (data) => {
        const rawOutput = data.toString();
        console.log('Cursor CLI stdout:', rawOutput);

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
        console.log(`Cursor CLI process exited with code ${code}`);

        const finalSessionId = capturedSessionId || sessionId || processKey;
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

        ws.send(createNormalizedMessage({ kind: 'complete', exitCode: code, isNewSession: !sessionId && !!command, sessionId: finalSessionId, provider: 'cursor' }));

        if (code === 0) {
          notifyTerminalState({ code });
          settleOnce(() => resolve());
        } else {
          notifyTerminalState({ code });
          settleOnce(() => reject(new Error(`Cursor CLI exited with code ${code}`)));
        }
      });

      // Handle process errors
      cursorProcess.on('error', (error) => {
        console.error('Cursor CLI process error:', error);

        // Clean up process reference on error
        const finalSessionId = capturedSessionId || sessionId || processKey;
        activeCursorProcesses.delete(finalSessionId);

        ws.send(createNormalizedMessage({ kind: 'error', content: error.message, sessionId: capturedSessionId || sessionId || null, provider: 'cursor' }));
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

export {
  spawnCursor,
  abortCursorSession,
  isCursorSessionActive,
  getActiveCursorSessions
};
