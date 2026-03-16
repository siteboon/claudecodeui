import { spawn, execSync } from 'child_process';
import crossSpawn from 'cross-spawn';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';

// Use cross-spawn on Windows for better command execution
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

let activeCopilotProcesses = new Map(); // Track active processes by session ID
const copilotSessionOwners = new Map(); // Track session-to-userId mapping for ownership checks

/**
 * Resolve the copilot binary path.
 * Checks COPILOT_CLI_PATH env, then PATH lookup, then official install locations.
 */
function getCopilotBinaryPath() {
  // 1. Explicit override via environment variable
  if (process.env.COPILOT_CLI_PATH) {
    return process.env.COPILOT_CLI_PATH;
  }

  // 2. Try to find copilot on PATH
  try {
    const cmd = process.platform === 'win32' ? 'where copilot' : 'which copilot';
    const result = execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
    if (result) {
      return result.split('\n')[0]; // Use first match
    }
  } catch {
    // Not found on PATH, try fallback locations
  }

  // 3. Check official installation locations
  if (process.platform !== 'win32') {
    const homeBinPath = path.join(os.homedir(), '.local', 'bin', 'copilot');
    if (fs.existsSync(homeBinPath)) {
      return homeBinPath;
    }

    if (fs.existsSync('/usr/local/bin/copilot')) {
      return '/usr/local/bin/copilot';
    }
  }

  // 4. Fall back to bare command name (let shell resolve)
  return 'copilot';
}

async function spawnCopilot(command, options = {}, ws) {
  return new Promise((resolve, reject) => {
    const { sessionId, projectPath, cwd, resume, toolsSettings, permissionMode, model, sessionSummary } = options;
    let capturedSessionId = sessionId; // Track session ID throughout the process
    let sessionCreatedSent = false; // Track if we've already sent session-created event
    let settled = false;

    // Use tools settings passed from frontend, or defaults
    const settings = toolsSettings || {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false
    };

    // Build Copilot CLI command arguments
    const baseArgs = [];

    // Handle session resumption
    if (sessionId) {
      baseArgs.push('--resume=' + sessionId);
    }

    if (command && command.trim()) {
      // Provide a prompt (works for both new and resumed sessions)
      baseArgs.push('-p', command);

      // Add model flag if specified (only meaningful for new sessions)
      if (!sessionId && model) {
        baseArgs.push('--model', model);
      }

      // Request JSONL output for parsing
      baseArgs.push('--output-format', 'json');
    }

    // Handle permission modes
    if (permissionMode === 'bypassPermissions' || settings.skipPermissions) {
      baseArgs.push('--yolo');
      console.log('Using --yolo flag (bypass permissions)');
    } else if (permissionMode === 'acceptEdits') {
      baseArgs.push('--allow-all-tools');
      console.log('Using --allow-all-tools flag (accept edits)');
    }

    // Suppress auto-update in server context
    baseArgs.push('--no-auto-update');

    // Disable the alternate screen buffer for non-interactive mode
    baseArgs.push('--no-alt-screen');

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

    const runCopilotProcess = (args) => {
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
            provider: 'copilot',
            sessionId: finalSessionId,
            sessionName: sessionSummary,
            stopReason: 'completed'
          });
          return;
        }

        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'copilot',
          sessionId: finalSessionId,
          sessionName: sessionSummary,
          error: error || `Copilot CLI exited with code ${code}`
        });
      };

      const copilotPath = getCopilotBinaryPath();
      console.log('Spawning Copilot CLI:', copilotPath, args.join(' '));
      console.log('Working directory:', workingDir);
      console.log('Session info - Input sessionId:', sessionId, 'Resume:', resume);

      const copilotProcess = spawnFunction(copilotPath, args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env } // Inherit all environment variables
      });

      activeCopilotProcesses.set(processKey, copilotProcess);

      const processCopilotOutputLine = (line) => {
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
                  console.log('Captured Copilot session ID:', capturedSessionId);

                  // Update process key with captured session ID
                  if (processKey !== capturedSessionId) {
                    activeCopilotProcesses.delete(processKey);
                    activeCopilotProcesses.set(capturedSessionId, copilotProcess);
                  }

                  // Track session ownership for authorization checks
                  const ownerId = ws?.userId || null;
                  if (ownerId) {
                    copilotSessionOwners.set(capturedSessionId, ownerId);
                  }

                  // Set session ID on writer (for API endpoint compatibility)
                  if (ws?.setSessionId && typeof ws.setSessionId === 'function') {
                    ws.setSessionId(capturedSessionId);
                  }

                  // Send session-created event only once for new sessions
                  if (!sessionId && !sessionCreatedSent) {
                    sessionCreatedSent = true;
                    ws.send({
                      type: 'session-created',
                      sessionId: capturedSessionId,
                      model: response.model,
                      cwd: response.cwd
                    });
                  }
                }

                // Send system info to frontend
                ws.send({
                  type: 'copilot-system',
                  data: response,
                  sessionId: capturedSessionId || sessionId || null
                });
              }
              break;

            case 'user':
              // Forward user message
              ws.send({
                type: 'copilot-user',
                data: response,
                sessionId: capturedSessionId || sessionId || null
              });
              break;

            case 'assistant':
              // Accumulate assistant message chunks
              if (response.message && response.message.content && response.message.content.length > 0) {
                const contentBlock = response.message.content[0];
                const textContent = contentBlock.text || '';

                // Send as Claude-compatible format for frontend
                ws.send({
                  type: 'claude-response',
                  data: {
                    type: 'content_block_delta',
                    delta: {
                      type: 'text_delta',
                      text: textContent
                    }
                  },
                  sessionId: capturedSessionId || sessionId || null
                });
              }
              break;

            case 'result':
              // Session complete
              console.log('Copilot session result:', response);

              ws.send({
                type: 'copilot-result',
                sessionId: capturedSessionId || sessionId,
                data: response,
                success: response.subtype === 'success'
              });
              break;

            default:
              // Forward any other message types
              ws.send({
                type: 'copilot-response',
                data: response,
                sessionId: capturedSessionId || sessionId || null
              });
          }
        } catch (parseError) {
          console.log('Copilot non-JSON response:', line);

          // If not JSON, send as raw text
          ws.send({
            type: 'copilot-output',
            data: line,
            sessionId: capturedSessionId || sessionId || null
          });
        }
      };

      // Handle stdout (streaming JSONL responses)
      copilotProcess.stdout.on('data', (data) => {
        const rawOutput = data.toString();
        console.log('Copilot CLI stdout:', rawOutput);

        // Stream chunks can split JSON objects across packets; keep trailing partial line.
        stdoutLineBuffer += rawOutput;
        const completeLines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = completeLines.pop() || '';

        completeLines.forEach((line) => {
          processCopilotOutputLine(line.trim());
        });
      });

      // Handle stderr
      copilotProcess.stderr.on('data', (data) => {
        const stderrText = data.toString();
        console.error('Copilot CLI stderr:', stderrText);

        // Filter out deprecation warnings and update notices
        if (/deprecat/i.test(stderrText) || /update available/i.test(stderrText)) {
          return;
        }

        ws.send({
          type: 'copilot-error',
          error: stderrText,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'copilot'
        });
      });

      // Handle process completion
      copilotProcess.on('close', async (code) => {
        console.log(`Copilot CLI process exited with code ${code}`);

        const finalSessionId = capturedSessionId || sessionId || processKey;
        activeCopilotProcesses.delete(finalSessionId);

        // Flush any final unterminated stdout line before completion handling.
        if (stdoutLineBuffer.trim()) {
          processCopilotOutputLine(stdoutLineBuffer.trim());
          stdoutLineBuffer = '';
        }

        ws.send({
          type: 'claude-complete',
          sessionId: finalSessionId,
          exitCode: code,
          provider: 'copilot',
          isNewSession: !sessionId && !!command
        });

        if (code === 0) {
          notifyTerminalState({ code });
          settleOnce(() => resolve());
        } else {
          notifyTerminalState({ code });
          settleOnce(() => reject(new Error(`Copilot CLI exited with code ${code}`)));
        }
      });

      // Handle process errors
      copilotProcess.on('error', (error) => {
        console.error('Copilot CLI process error:', error);

        // Clean up process reference on error
        const finalSessionId = capturedSessionId || sessionId || processKey;
        activeCopilotProcesses.delete(finalSessionId);

        ws.send({
          type: 'copilot-error',
          error: error.message,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'copilot'
        });
        notifyTerminalState({ error });

        settleOnce(() => reject(error));
      });

      // Close stdin since Copilot doesn't need interactive input in prompt mode
      copilotProcess.stdin.end();
    };

    runCopilotProcess(baseArgs);
  });
}

function abortCopilotSession(sessionId) {
  const process = activeCopilotProcesses.get(sessionId);
  if (process) {
    console.log(`Aborting Copilot session: ${sessionId}`);
    process.kill('SIGTERM');
    activeCopilotProcesses.delete(sessionId);
    return true;
  }
  return false;
}

function isCopilotSessionActive(sessionId) {
  return activeCopilotProcesses.has(sessionId);
}

function getActiveCopilotSessions() {
  return Array.from(activeCopilotProcesses.keys());
}

function getCopilotSessionOwner(sessionId) {
  return copilotSessionOwners.get(sessionId) || null;
}

function removeCopilotSessionOwner(sessionId) {
  copilotSessionOwners.delete(sessionId);
}

export {
  spawnCopilot,
  abortCopilotSession,
  isCopilotSessionActive,
  getActiveCopilotSessions,
  getCopilotSessionOwner,
  removeCopilotSessionOwner
};
