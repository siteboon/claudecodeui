import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';

// Use cross-spawn on Windows for correct .cmd resolution (same pattern as cursor-cli.js)
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

import os from 'os';
import sessionManager from './sessionManager.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { createNormalizedMessage } from './providers/types.js';

let activeKiroProcesses = new Map(); // Track active processes by session ID

async function spawnKiro(command, options = {}, ws) {
    const { sessionId, projectPath, cwd, toolsSettings, permissionMode, sessionSummary } = options;
    let capturedSessionId = sessionId; // Track session ID throughout the process
    let sessionCreatedSent = false; // Track if we've already sent session-created event
    let assistantBlocks = []; // Accumulate the full response blocks including tools

    // Use tools settings passed from frontend, or defaults
    const settings = toolsSettings || {
        allowedTools: [],
        disallowedTools: [],
        skipPermissions: false
    };

    // Build Kiro CLI command arguments
    // Real Kiro CLI interface: kiro chat --no-interactive [--resume <id>] [--agent <name>] <message>
    const args = ['chat', '--no-interactive'];

    // If we have a sessionId, attempt to resume
    if (sessionId) {
        const session = sessionManager.getSession(sessionId);
        if (session && session.cliSessionId) {
            args.push('--resume', session.cliSessionId);
        } else {
            // TODO: verify native Kiro session ID format to confirm direct resume is valid
            // Sessions discovered from disk by getKiroSessions() are not in sessionManager,
            // so use sessionId directly as the resume value for disk-discovered sessions.
            args.push('--resume', sessionId);
        }
    }

    // Use cwd (actual project directory) instead of projectPath (metadata directory)
    // Clean the path by removing any non-printable characters
    const cleanPath = (cwd || projectPath || process.cwd()).replace(/[^\x20-\x7E]/g, '').trim();
    const workingDir = cleanPath;

    // Use --agent flag if a model/agent name is specified
    if (options.model) {
        args.push('--agent', options.model);
    }

    // Pass the user message as a positional argument
    if (command && command.trim()) {
        args.push(command);
    }

    // Try to find kiro in PATH first, then fall back to environment variable
    const kiroPath = process.env.KIRO_PATH || 'kiro';
    console.log('Spawning Kiro CLI:', kiroPath, args.join(' '));
    console.log('Working directory:', workingDir);

    let spawnCmd = kiroPath;
    let spawnArgs = args;

    // On non-Windows platforms, wrap the execution in a shell to avoid ENOEXEC
    // which happens when the target is a script lacking a shebang.
    if (os.platform() !== 'win32') {
        spawnCmd = 'sh';
        // Use exec to replace the shell process, ensuring signals hit kiro directly
        spawnArgs = ['-c', 'exec "$0" "$@"', kiroPath, ...args];
    }

    return new Promise((resolve, reject) => {
        const kiroProcess = spawnFunction(spawnCmd, spawnArgs, {
            cwd: workingDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env } // Inherit all environment variables
        });
        let terminalNotificationSent = false;
        let terminalFailureReason = null;

        // Store process reference for potential abort
        // processKey is declared before notifyTerminalState so the closure captures a stable variable
        const processKey = capturedSessionId || sessionId || Date.now().toString();

        const notifyTerminalState = ({ code = null, error = null } = {}) => {
            if (terminalNotificationSent) {
                return;
            }

            terminalNotificationSent = true;

            const finalSessionId = capturedSessionId || sessionId || processKey;
            if (code === 0 && !error) {
                notifyRunStopped({
                    userId: ws?.userId || null,
                    provider: 'kiro',
                    sessionId: finalSessionId,
                    sessionName: sessionSummary,
                    stopReason: 'completed'
                });
                return;
            }

            notifyRunFailed({
                userId: ws?.userId || null,
                provider: 'kiro',
                sessionId: finalSessionId,
                sessionName: sessionSummary,
                error: error || terminalFailureReason || `Kiro CLI exited with code ${code}`
            });
        };
        activeKiroProcesses.set(processKey, kiroProcess);

        // Store sessionId on the process object for debugging
        kiroProcess.sessionId = processKey;

        // Close stdin to signal we're done sending input
        kiroProcess.stdin.end();

        // Add timeout handler
        const timeoutMs = 120000; // 120 seconds for slower models
        let timeout;

        const startTimeout = () => {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => {
                const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : (capturedSessionId || sessionId || processKey);
                terminalFailureReason = `Kiro CLI timeout - no response received for ${timeoutMs / 1000} seconds`;
                ws.send(createNormalizedMessage({ kind: 'error', content: terminalFailureReason, sessionId: socketSessionId, provider: 'kiro' }));
                try {
                    kiroProcess.kill('SIGTERM');
                } catch (e) { }
            }, timeoutMs);
        };

        startTimeout();

        // Save user message to session when starting
        if (command && capturedSessionId) {
            sessionManager.addMessage(capturedSessionId, 'user', command);
        }

        // Handle stdout
        // TODO: verify Kiro CLI output format — modeled after Gemini CLI (NDJSON/JSON lines)
        // The current implementation assumes JSON-lines output. Adjust parseKiroLine() if format differs.
        let lineBuffer = '';
        kiroProcess.stdout.on('data', (data) => {
            lineBuffer += data.toString();
            startTimeout(); // Re-arm the timeout

            // For new sessions, create a session ID FIRST
            if (!sessionId && !sessionCreatedSent && !capturedSessionId) {
                capturedSessionId = `kiro_${Date.now()}`;
                sessionCreatedSent = true;

                // Create session in session manager
                sessionManager.createSession(capturedSessionId, cwd || process.cwd());

                // Save the user message now that we have a session ID
                if (command) {
                    sessionManager.addMessage(capturedSessionId, 'user', command);
                }

                // Update process key with captured session ID
                if (processKey !== capturedSessionId) {
                    activeKiroProcesses.delete(processKey);
                    activeKiroProcesses.set(capturedSessionId, kiroProcess);
                }

                ws.setSessionId && typeof ws.setSessionId === 'function' && ws.setSessionId(capturedSessionId);

                ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'kiro' }));
            }

            // Split on newlines and keep any incomplete last fragment in the buffer.
            // This handles partial JSON lines split across TCP chunks.
            const lines = lineBuffer.split('\n');
            lineBuffer = lines.pop(); // keep incomplete last line for next data event

            // TODO: verify Kiro CLI output format and update this parsing logic accordingly.
            // Currently treating each complete line as a potential JSON object (NDJSON), falling back to raw text.
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line);
                    // TODO: map actual Kiro CLI JSON event types to NormalizedMessage kinds
                    // For now, extract text content from common fields
                    const content = parsed.content || parsed.text || parsed.message || parsed.output || '';
                    if (content) {
                        if (assistantBlocks.length > 0 && assistantBlocks[assistantBlocks.length - 1].type === 'text') {
                            assistantBlocks[assistantBlocks.length - 1].text += content;
                        } else {
                            assistantBlocks.push({ type: 'text', text: content });
                        }
                        const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : (capturedSessionId || sessionId);
                        ws.send(createNormalizedMessage({ kind: 'stream_delta', content, sessionId: socketSessionId, provider: 'kiro' }));
                    }
                } catch {
                    // Not JSON — treat as raw text output
                    if (line.trim()) {
                        if (assistantBlocks.length > 0 && assistantBlocks[assistantBlocks.length - 1].type === 'text') {
                            assistantBlocks[assistantBlocks.length - 1].text += line;
                        } else {
                            assistantBlocks.push({ type: 'text', text: line });
                        }
                        const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : (capturedSessionId || sessionId);
                        ws.send(createNormalizedMessage({ kind: 'stream_delta', content: line, sessionId: socketSessionId, provider: 'kiro' }));
                    }
                }
            }
        });

        // Handle stderr
        kiroProcess.stderr.on('data', (data) => {
            const errorMsg = data.toString();

            // Filter out common non-error messages
            // TODO: add Kiro-specific stderr filters once CLI output is known
            if (errorMsg.includes('[DEP0040]') ||
                errorMsg.includes('DeprecationWarning') ||
                errorMsg.includes('--trace-deprecation')) {
                return;
            }

            const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : (capturedSessionId || sessionId);
            ws.send(createNormalizedMessage({ kind: 'error', content: errorMsg, sessionId: socketSessionId, provider: 'kiro' }));
        });

        // Handle process completion
        kiroProcess.on('close', async (code) => {
            clearTimeout(timeout);

            // Flush any remaining lineBuffer content that wasn't terminated by a newline
            if (lineBuffer.trim()) {
                const content = lineBuffer.trim();
                lineBuffer = '';
                // treat as raw text - send as stream_delta
                const socketSessionId = capturedSessionId || sessionId;
                ws.send(createNormalizedMessage({ kind: 'stream_delta', content, sessionId: socketSessionId, provider: 'kiro' }));
            }

            // Clean up process reference
            const finalSessionId = capturedSessionId || sessionId || processKey;
            activeKiroProcesses.delete(finalSessionId);

            // Save assistant response to session if we have one
            if (finalSessionId && assistantBlocks.length > 0) {
                sessionManager.addMessage(finalSessionId, 'assistant', assistantBlocks);
            }

            ws.send(createNormalizedMessage({ kind: 'complete', exitCode: code, isNewSession: !sessionId && !!command, sessionId: finalSessionId, provider: 'kiro' }));

            if (code === 0) {
                notifyTerminalState({ code });
                resolve();
            } else {
                notifyTerminalState({
                    code,
                    error: code === null ? 'Kiro CLI process was terminated or timed out' : null
                });
                reject(new Error(code === null ? 'Kiro CLI process was terminated or timed out' : `Kiro CLI exited with code ${code}`));
            }
        });

        // Handle process errors
        kiroProcess.on('error', (error) => {
            // Clean up process reference on error
            const finalSessionId = capturedSessionId || sessionId || processKey;
            activeKiroProcesses.delete(finalSessionId);

            const errorSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : finalSessionId;
            ws.send(createNormalizedMessage({ kind: 'error', content: error.message, sessionId: errorSessionId, provider: 'kiro' }));
            notifyTerminalState({ error });

            reject(error);
        });

    });
}

function abortKiroSession(sessionId) {
    let kiroProc = activeKiroProcesses.get(sessionId);
    let processKey = sessionId;

    if (!kiroProc) {
        for (const [key, proc] of activeKiroProcesses.entries()) {
            if (proc.sessionId === sessionId) {
                kiroProc = proc;
                processKey = key;
                break;
            }
        }
    }

    if (kiroProc) {
        try {
            kiroProc.kill('SIGTERM');
            setTimeout(() => {
                if (activeKiroProcesses.has(processKey)) {
                    try {
                        kiroProc.kill('SIGKILL');
                    } catch (e) { }
                }
            }, 2000); // Wait 2 seconds before force kill

            return true;
        } catch (error) {
            return false;
        }
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
    getActiveKiroSessions
};
