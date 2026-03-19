import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';

const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;
import os from 'os';
import sessionManager from './sessionManager.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';

let activeKimiProcesses = new Map();

async function spawnKimi(command, options = {}, ws) {
    const { sessionId, projectPath, cwd, resume, toolsSettings, permissionMode, sessionSummary } = options;
    let capturedSessionId = sessionId;
    let sessionCreatedSent = false;
    let assistantBlocks = [];

    const settings = toolsSettings || {
        allowedTools: [],
        disallowedTools: [],
        skipPermissions: false
    };

    // Build the kimi CLI args
    const args = [];

    // Non-interactive mode for programmatic usage
    args.push('--print');

    if (command && command.trim()) {
        args.push('-p', command);
    }

    const cleanPath = (cwd || projectPath || process.cwd()).replace(/[^\x20-\x7E]/g, '').trim();
    const workingDir = cleanPath;

    // Set workspace directory
    args.push('-w', workingDir);

    if (options.debug) {
        args.push('--debug');
    }

    // Permission handling
    if (settings.skipPermissions || options.skipPermissions || permissionMode === 'yolo') {
        args.push('--yolo');
    }

    const kimiPath = process.env.KIMI_PATH || 'kimi';
    console.log('Spawning Kimi CLI:', kimiPath, args.join(' '));
    console.log('Working directory:', workingDir);

    let spawnCmd = kimiPath;
    let spawnArgs = args;

    // Wrap in shell on non-Windows to avoid ENOEXEC for scripts without shebang
    if (os.platform() !== 'win32') {
        spawnCmd = 'sh';
        spawnArgs = ['-c', 'exec "$0" "$@"', kimiPath, ...args];
    }

    return new Promise((resolve, reject) => {
        const kimiProcess = spawnFunction(spawnCmd, spawnArgs, {
            cwd: workingDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env }
        });
        let terminalNotificationSent = false;
        let terminalFailureReason = null;

        const notifyTerminalState = ({ code = null, error = null } = {}) => {
            if (terminalNotificationSent) return;
            terminalNotificationSent = true;

            const finalSessionId = capturedSessionId || sessionId || processKey;
            if (code === 0 && !error) {
                notifyRunStopped({
                    userId: ws?.userId || null,
                    provider: 'kimi',
                    sessionId: finalSessionId,
                    sessionName: sessionSummary,
                    stopReason: 'completed'
                });
                return;
            }

            notifyRunFailed({
                userId: ws?.userId || null,
                provider: 'kimi',
                sessionId: finalSessionId,
                sessionName: sessionSummary,
                error: error || terminalFailureReason || `Kimi CLI exited with code ${code}`
            });
        };

        const processKey = capturedSessionId || sessionId || Date.now().toString();
        activeKimiProcesses.set(processKey, kimiProcess);
        kimiProcess.sessionId = processKey;

        kimiProcess.stdin.end();

        // Timeout for unresponsive sessions
        let hasReceivedOutput = false;
        const timeoutMs = 120000;
        let timeout;

        const startTimeout = () => {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => {
                const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : (capturedSessionId || sessionId || processKey);
                terminalFailureReason = `Kimi CLI timeout - no response received for ${timeoutMs / 1000} seconds`;
                ws.send({
                    type: 'kimi-error',
                    sessionId: socketSessionId,
                    error: terminalFailureReason,
                    provider: 'kimi'
                });
                try { kimiProcess.kill('SIGTERM'); } catch (e) { }
            }, timeoutMs);
        };

        startTimeout();

        if (command && capturedSessionId) {
            sessionManager.addMessage(capturedSessionId, 'user', command);
        }

        // Accumulate text output (kimi --print writes plain text to stdout)
        let accumulatedText = '';

        kimiProcess.stdout.on('data', (data) => {
            const rawOutput = data.toString();
            hasReceivedOutput = true;
            startTimeout();

            // For new sessions, create a session ID on first output
            if (!sessionId && !sessionCreatedSent && !capturedSessionId) {
                capturedSessionId = `kimi_${Date.now()}`;
                sessionCreatedSent = true;

                sessionManager.createSession(capturedSessionId, cwd || process.cwd());

                if (command) {
                    sessionManager.addMessage(capturedSessionId, 'user', command);
                }

                if (processKey !== capturedSessionId) {
                    activeKimiProcesses.delete(processKey);
                    activeKimiProcesses.set(capturedSessionId, kimiProcess);
                }

                ws.setSessionId && typeof ws.setSessionId === 'function' && ws.setSessionId(capturedSessionId);

                ws.send({ type: 'session-created', sessionId: capturedSessionId });

                // Fake init event so frontend navigates and saves the session
                ws.send({
                    type: 'claude-response',
                    sessionId: capturedSessionId,
                    data: { type: 'system', subtype: 'init', session_id: capturedSessionId }
                });
            }

            accumulatedText += rawOutput;

            // Stream text chunks to the frontend
            const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : (capturedSessionId || sessionId);
            ws.send({
                type: 'kimi-response',
                sessionId: socketSessionId,
                data: { type: 'message', content: rawOutput }
            });
        });

        kimiProcess.stderr.on('data', (data) => {
            const errorMsg = data.toString();

            // Filter out common non-error output
            if (errorMsg.includes('[DEP0040]') ||
                errorMsg.includes('DeprecationWarning') ||
                errorMsg.includes('--trace-deprecation')) {
                return;
            }

            const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : (capturedSessionId || sessionId);
            ws.send({
                type: 'kimi-error',
                sessionId: socketSessionId,
                error: errorMsg,
                provider: 'kimi'
            });
        });

        kimiProcess.on('close', async (code) => {
            clearTimeout(timeout);

            const finalSessionId = capturedSessionId || sessionId || processKey;
            activeKimiProcesses.delete(finalSessionId);

            // Save full response to session
            if (finalSessionId && accumulatedText.trim()) {
                sessionManager.addMessage(finalSessionId, 'assistant', accumulatedText.trim());
            }

            ws.send({
                type: 'claude-complete',
                sessionId: finalSessionId,
                exitCode: code,
                provider: 'kimi',
                isNewSession: !sessionId && !!command
            });

            if (code === 0) {
                notifyTerminalState({ code });
                resolve();
            } else {
                notifyTerminalState({
                    code,
                    error: code === null ? 'Kimi CLI process was terminated or timed out' : null
                });
                reject(new Error(code === null ? 'Kimi CLI process was terminated or timed out' : `Kimi CLI exited with code ${code}`));
            }
        });

        kimiProcess.on('error', (error) => {
            const finalSessionId = capturedSessionId || sessionId || processKey;
            activeKimiProcesses.delete(finalSessionId);

            const errorSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : finalSessionId;
            ws.send({
                type: 'kimi-error',
                sessionId: errorSessionId,
                error: error.message,
                provider: 'kimi'
            });
            notifyTerminalState({ error });
            reject(error);
        });
    });
}

function abortKimiSession(sessionId) {
    let kimiProc = activeKimiProcesses.get(sessionId);
    let processKey = sessionId;

    if (!kimiProc) {
        for (const [key, proc] of activeKimiProcesses.entries()) {
            if (proc.sessionId === sessionId) {
                kimiProc = proc;
                processKey = key;
                break;
            }
        }
    }

    if (kimiProc) {
        try {
            kimiProc.kill('SIGTERM');
            setTimeout(() => {
                if (activeKimiProcesses.has(processKey)) {
                    try { kimiProc.kill('SIGKILL'); } catch (e) { }
                }
            }, 2000);
            return true;
        } catch (error) {
            return false;
        }
    }
    return false;
}

function isKimiSessionActive(sessionId) {
    return activeKimiProcesses.has(sessionId);
}

function getActiveKimiSessions() {
    return Array.from(activeKimiProcesses.keys());
}

export {
    spawnKimi,
    abortKimiSession,
    isKimiSessionActive,
    getActiveKimiSessions
};
