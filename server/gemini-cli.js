import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import crossSpawn from 'cross-spawn';

import sessionManager from './sessionManager.js';
import GeminiResponseHandler from './gemini-response-handler.js';
import { appendImagesInputTag } from './shared/image-attachments.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { createCompleteMessage, createNormalizedMessage, flattenPromptForWindowsShell } from './shared/utils.js';

// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;

let activeGeminiProcesses = new Map(); // Track active processes by session ID

function mapGeminiExitCodeToMessage(exitCode) {
    switch (exitCode) {
        case 42:
            return 'Gemini rejected the request input (exit code 42).';
        case 44:
            return 'Gemini sandbox error (exit code 44). Check local sandbox/container settings.';
        case 52:
            return 'Gemini configuration error (exit code 52). Check your Gemini settings files for invalid JSON/config.';
        case 53:
            return 'Gemini conversation turn limit reached (exit code 53). Start a new Gemini session.';
        default:
            return null;
    }
}

const GEMINI_AUTH_ENV_KEYS = [
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_CLOUD_PROJECT_ID',
    'GOOGLE_CLOUD_LOCATION',
    'GOOGLE_APPLICATION_CREDENTIALS'
];

function parseEnvFileContent(content) {
    const parsed = {};

    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }

        const exportPrefix = 'export ';
        const normalizedLine = line.startsWith(exportPrefix) ? line.slice(exportPrefix.length).trim() : line;
        const separatorIndex = normalizedLine.indexOf('=');

        if (separatorIndex <= 0) {
            continue;
        }

        const key = normalizedLine.slice(0, separatorIndex).trim();
        if (!key) {
            continue;
        }

        let value = normalizedLine.slice(separatorIndex + 1).trim();
        const hasDoubleQuotes = value.startsWith('"') && value.endsWith('"');
        const hasSingleQuotes = value.startsWith('\'') && value.endsWith('\'');

        if (hasDoubleQuotes || hasSingleQuotes) {
            value = value.slice(1, -1);
        } else {
            // Support inline comments in unquoted values: KEY=value # comment
            value = value.replace(/\s+#.*$/, '').trim();
        }

        parsed[key] = value;
    }

    return parsed;
}

async function loadGeminiUserLevelEnv() {
    const geminiCliHome = (process.env.GEMINI_CLI_HOME || '').trim() || os.homedir();
    const envCandidates = [
        path.join(geminiCliHome, '.gemini', '.env'),
        path.join(geminiCliHome, '.env')
    ];

    for (const envPath of envCandidates) {
        try {
            await fs.access(envPath);
            const content = await fs.readFile(envPath, 'utf8');
            return parseEnvFileContent(content);
        } catch {
            // Keep scanning for the next candidate.
        }
    }

    return {};
}

async function buildGeminiProcessEnv() {
    const processEnv = { ...process.env };
    if (processEnv.GEMINI_API_KEY || processEnv.GOOGLE_API_KEY || processEnv.GOOGLE_APPLICATION_CREDENTIALS) {
        return processEnv;
    }

    // Gemini CLI docs recommend ~/.gemini/.env for persistent headless auth settings.
    // When the server process was launched without shell profile variables, we still
    // want the spawned CLI process to inherit those user-level credentials.
    const userEnv = await loadGeminiUserLevelEnv();
    for (const key of GEMINI_AUTH_ENV_KEYS) {
        if (!processEnv[key] && userEnv[key]) {
            processEnv[key] = userEnv[key];
        }
    }

    return processEnv;
}

async function spawnGemini(command, options = {}, ws) {
    const { sessionId, projectPath, cwd, toolsSettings, permissionMode, images, sessionSummary } = options;
    const resolvedModel = await providerModelsService.resolveResumeModel(
        'gemini',
        sessionId,
        options.model
    );
    let capturedSessionId = sessionId; // Track session ID throughout the process
    let sessionCreatedSent = false; // Track if we've already sent session-created event
    let assistantBlocks = []; // Accumulate the full response blocks including tools
    // Unified lifecycle contract: exactly one terminal `complete` per run
    // (close and error handlers can both fire for spawn failures).
    let completeSent = false;

    // Use tools settings passed from frontend, or defaults
    const settings = toolsSettings || {
        allowedTools: [],
        disallowedTools: [],
        skipPermissions: false
    };

    // Build Gemini CLI command - start with print/resume flags first
    const args = [];

    // Image attachments ride along as an <images_input> path list appended to
    // the prompt; session history readers strip the tag back out for display.
    // gemini is a .cmd shim on Windows, so the whole argument must be
    // newline-free or cmd.exe silently truncates it at the first newline.
    const finalCommand = command && command.trim()
        ? flattenPromptForWindowsShell(appendImagesInputTag(command, images))
        : command;

    // Add prompt flag with command if we have a command
    if (finalCommand && finalCommand.trim()) {
        args.push('--prompt', finalCommand);
    }

    // If we have a sessionId, we want to resume
    if (sessionId) {
        const session = sessionManager.getSession(sessionId);
        if (session && session.cliSessionId) {
            args.push('--resume', session.cliSessionId);
        }
    }

    // Use cwd (actual project directory) instead of projectPath (Gemini's metadata directory)
    // Clean the path by removing any non-printable characters
    const cleanPath = (cwd || projectPath || process.cwd()).replace(/[^\x20-\x7E]/g, '').trim();
    const workingDir = cleanPath;

    // Add basic flags for Gemini
    if (options.debug) {
        args.push('--debug');
    }

    // This integration runs Gemini in headless mode and cannot answer trust prompts.
    // Skip folder-trust interactivity so authenticated runs don't fail with
    // FatalUntrustedWorkspaceError in previously unseen directories.
    args.push('--skip-trust');

    // Add MCP config flag only if MCP servers are configured
    try {
        const geminiConfigPath = path.join(os.homedir(), '.gemini.json');
        let hasMcpServers = false;

        try {
            await fs.access(geminiConfigPath);
            const geminiConfigRaw = await fs.readFile(geminiConfigPath, 'utf8');
            const geminiConfig = JSON.parse(geminiConfigRaw);

            // Check global MCP servers
            if (geminiConfig.mcpServers && Object.keys(geminiConfig.mcpServers).length > 0) {
                hasMcpServers = true;
            }

            // Check project-specific MCP servers
            if (!hasMcpServers && geminiConfig.geminiProjects) {
                const currentProjectPath = process.cwd();
                const projectConfig = geminiConfig.geminiProjects[currentProjectPath];
                if (projectConfig && projectConfig.mcpServers && Object.keys(projectConfig.mcpServers).length > 0) {
                    hasMcpServers = true;
                }
            }
        } catch (e) {
            // Ignore if file doesn't exist or isn't parsable
        }

        if (hasMcpServers) {
            args.push('--mcp-config', geminiConfigPath);
        }
    } catch (error) {
        // Ignore outer errors
    }

    // Add model for all sessions (both new and resumed)
    let modelToUse = resolvedModel || 'gemini-2.5-flash';
    args.push('--model', modelToUse);
    args.push('--output-format', 'stream-json');

    // Handle approval modes and allowed tools
    if (settings.skipPermissions || options.skipPermissions || permissionMode === 'yolo') {
        args.push('--yolo');
    } else if (permissionMode === 'auto_edit') {
        args.push('--approval-mode', 'auto_edit');
    } else if (permissionMode === 'plan') {
        args.push('--approval-mode', 'plan');
    }

    if (settings.allowedTools && settings.allowedTools.length > 0) {
        args.push('--allowed-tools', settings.allowedTools.join(','));
    }

    // Try to find gemini in PATH first, then fall back to environment variable
    const geminiPath = process.env.GEMINI_PATH || 'gemini';
    let spawnCmd = geminiPath;
    let spawnArgs = args;

    // On non-Windows platforms, wrap the execution in a shell to avoid ENOEXEC
    // which happens when the target is a script lacking a shebang.
    if (os.platform() !== 'win32') {
        spawnCmd = 'sh';
        // Use exec to replace the shell process, ensuring signals hit gemini directly
        spawnArgs = ['-c', 'exec "$0" "$@"', geminiPath, ...args];
    }

    const spawnEnv = await buildGeminiProcessEnv();

    return new Promise((resolve, reject) => {
        const geminiProcess = spawnFunction(spawnCmd, spawnArgs, {
            cwd: workingDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: spawnEnv
        });
        let terminalNotificationSent = false;
        let terminalFailureReason = null;

        const notifyTerminalState = ({ code = null, error = null } = {}) => {
            if (terminalNotificationSent) {
                return;
            }

            terminalNotificationSent = true;

            const finalSessionId = capturedSessionId || sessionId || processKey;
            if (code === 0 && !error) {
                notifyRunStopped({
                    userId: ws?.userId || null,
                    provider: 'gemini',
                    sessionId: finalSessionId,
                    sessionName: sessionSummary,
                    stopReason: 'completed'
                });
                return;
            }

            notifyRunFailed({
                userId: ws?.userId || null,
                provider: 'gemini',
                sessionId: finalSessionId,
                sessionName: sessionSummary,
                error: error || terminalFailureReason || `Gemini CLI exited with code ${code}`
            });
        };

        // Store process reference for potential abort
        const processKey = capturedSessionId || sessionId || Date.now().toString();
        activeGeminiProcesses.set(processKey, geminiProcess);

        // Store sessionId on the process object for debugging
        geminiProcess.sessionId = processKey;

        // Close stdin to signal we're done sending input
        geminiProcess.stdin.end();

        // Add timeout handler
        const timeoutMs = 120000; // 120 seconds for slower models
        let timeout;

        const startTimeout = () => {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => {
                const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : (capturedSessionId || sessionId || processKey);
                terminalFailureReason = `Gemini CLI timeout - no response received for ${timeoutMs / 1000} seconds`;
                ws.send(createNormalizedMessage({ kind: 'error', content: terminalFailureReason, sessionId: socketSessionId, provider: 'gemini' }));
                try {
                    geminiProcess.kill('SIGTERM');
                } catch (e) { }
            }, timeoutMs);
        };

        startTimeout();

        // Save user message to session when starting
        if (command && capturedSessionId) {
            sessionManager.addMessage(capturedSessionId, 'user', command);
        }

        // Create response handler for NDJSON buffering
        let responseHandler;
        if (ws) {
            responseHandler = new GeminiResponseHandler(ws, {
                onContentFragment: (content) => {
                    if (assistantBlocks.length > 0 && assistantBlocks[assistantBlocks.length - 1].type === 'text') {
                        assistantBlocks[assistantBlocks.length - 1].text += content;
                    } else {
                        assistantBlocks.push({ type: 'text', text: content });
                    }
                },
                onToolUse: (event) => {
                    assistantBlocks.push({
                        type: 'tool_use',
                        id: event.tool_id,
                        name: event.tool_name,
                        input: event.parameters
                    });
                },
                onToolResult: (event) => {
                    if (capturedSessionId) {
                        if (assistantBlocks.length > 0) {
                            sessionManager.addMessage(capturedSessionId, 'assistant', [...assistantBlocks]);
                            assistantBlocks = [];
                        }
                        sessionManager.addMessage(capturedSessionId, 'user', [{
                            type: 'tool_result',
                            tool_use_id: event.tool_id,
                            content: event.output === undefined ? null : event.output,
                            is_error: event.status === 'error'
                        }]);
                    }
                },
                onInit: (event) => {
                    const discoveredSessionId = event?.session_id;
                    if (!discoveredSessionId) {
                        return;
                    }

                    // New Gemini sessions announce their canonical ID asynchronously via the
                    // initial `init` stream event. Avoid synthetic IDs and only register
                    // the session once that real ID is known (same model used by Claude/Codex).
                    if (!capturedSessionId) {
                        capturedSessionId = discoveredSessionId;

                        sessionManager.createSession(capturedSessionId, cwd || process.cwd());
                        if (command) {
                            sessionManager.addMessage(capturedSessionId, 'user', command);
                        }

                        if (processKey !== capturedSessionId) {
                            activeGeminiProcesses.delete(processKey);
                            activeGeminiProcesses.set(capturedSessionId, geminiProcess);
                        }

                        geminiProcess.sessionId = capturedSessionId;

                        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
                            ws.setSessionId(capturedSessionId);
                        }

                        if (!sessionId && !sessionCreatedSent) {
                            sessionCreatedSent = true;
                            ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'gemini' }));
                        }
                    }

                    const sess = sessionManager.getSession(capturedSessionId);
                    if (sess && !sess.cliSessionId) {
                        sess.cliSessionId = discoveredSessionId;
                        sessionManager.saveSession(capturedSessionId);
                    }
                }
            });
        }

        // Handle stdout
        geminiProcess.stdout.on('data', (data) => {
            const rawOutput = data.toString();
            startTimeout(); // Re-arm the timeout

            if (responseHandler) {
                responseHandler.processData(rawOutput);
            } else if (rawOutput) {
                // Fallback to direct sending for raw CLI mode without WS
                if (assistantBlocks.length > 0 && assistantBlocks[assistantBlocks.length - 1].type === 'text') {
                    assistantBlocks[assistantBlocks.length - 1].text += rawOutput;
                } else {
                    assistantBlocks.push({ type: 'text', text: rawOutput });
                }
                const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : (capturedSessionId || sessionId);
                ws.send(createNormalizedMessage({ kind: 'stream_delta', content: rawOutput, sessionId: socketSessionId, provider: 'gemini' }));
            }
        });

        // Handle stderr
        geminiProcess.stderr.on('data', (data) => {
            const errorMsg = data.toString();

            // Filter out deprecation warnings and "Loaded cached credentials" message
            if (errorMsg.includes('[DEP0040]') ||
                errorMsg.includes('DeprecationWarning') ||
                errorMsg.includes('--trace-deprecation') ||
                errorMsg.includes('Loaded cached credentials')) {
                return;
            }

            const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : (capturedSessionId || sessionId);
            ws.send(createNormalizedMessage({ kind: 'error', content: errorMsg, sessionId: socketSessionId, provider: 'gemini' }));
        });

        // Handle process completion
        geminiProcess.on('close', async (code) => {
            clearTimeout(timeout);

            // Flush any remaining buffered content
            if (responseHandler) {
                responseHandler.forceFlush();
                responseHandler.destroy();
            }

            // Clean up process reference
            const finalSessionId = capturedSessionId || sessionId || processKey;
            activeGeminiProcesses.delete(finalSessionId);

            // Save assistant response to session if we have one
            if (finalSessionId && assistantBlocks.length > 0) {
                sessionManager.addMessage(finalSessionId, 'assistant', assistantBlocks);
            }

            // Terminal complete — skipped for aborted runs (abort-session
            // already sent the aborted complete on this run's behalf).
            if (!completeSent && !geminiProcess.aborted) {
                completeSent = true;
                ws.send(createCompleteMessage({ provider: 'gemini', sessionId: finalSessionId, exitCode: code }));
            }

            if (code === 0) {
                notifyTerminalState({ code });
                resolve();
            } else {
                const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : finalSessionId;

                // code 127 = shell "command not found" - check installation
                if (code === 127) {
                    const installed = await providerAuthService.isProviderInstalled('gemini');
                    if (!installed) {
                        terminalFailureReason = 'Gemini CLI is not installed. Please install it first: https://github.com/google-gemini/gemini-cli';
                        ws.send(createNormalizedMessage({ kind: 'error', content: terminalFailureReason, sessionId: socketSessionId, provider: 'gemini' }));
                    }
                } else if (code === 41) {
                    // Gemini CLI documents exit code 41 as FatalAuthenticationError.
                    // Surface an actionable auth error instead of a generic exit-code message.
                    let authErrorSuffix = '';
                    try {
                        const authStatus = await providerAuthService.getProviderAuthStatus('gemini');
                        if (!authStatus?.authenticated && authStatus?.error) {
                            authErrorSuffix = ` Details: ${authStatus.error}`;
                        }
                    } catch {
                        // Keep base remediation text when auth status lookup fails.
                    }

                    terminalFailureReason =
                        'Gemini authentication failed (exit code 41). '
                        + 'Run `gemini` in a terminal to choose an auth method, or configure a valid `GEMINI_API_KEY`.'
                        + authErrorSuffix;
                    ws.send(createNormalizedMessage({ kind: 'error', content: terminalFailureReason, sessionId: socketSessionId, provider: 'gemini' }));
                } else {
                    const mappedError = mapGeminiExitCodeToMessage(code);
                    if (mappedError) {
                        terminalFailureReason = mappedError;
                        ws.send(createNormalizedMessage({ kind: 'error', content: terminalFailureReason, sessionId: socketSessionId, provider: 'gemini' }));
                    }
                }

                notifyTerminalState({
                    code,
                    error: code === null ? 'Gemini CLI process was terminated or timed out' : null
                });
                reject(
                    new Error(
                        terminalFailureReason
                        || (code === null
                            ? 'Gemini CLI process was terminated or timed out'
                            : `Gemini CLI exited with code ${code}`)
                    )
                );
            }
        });

        // Handle process errors
        geminiProcess.on('error', async (error) => {
            // Clean up process reference on error
            const finalSessionId = capturedSessionId || sessionId || processKey;
            activeGeminiProcesses.delete(finalSessionId);

            // Check if Gemini CLI is installed for a clearer error message
            const installed = await providerAuthService.isProviderInstalled('gemini');
            const errorContent = !installed
                ? 'Gemini CLI is not installed. Please install it first: https://github.com/google-gemini/gemini-cli'
                : error.message;

            const errorSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : finalSessionId;
            ws.send(createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: errorSessionId, provider: 'gemini' }));
            if (!completeSent && !geminiProcess.aborted) {
                completeSent = true;
                ws.send(createCompleteMessage({ provider: 'gemini', sessionId: errorSessionId, exitCode: 1 }));
            }
            notifyTerminalState({ error });

            reject(error);
        });

    });
}

function abortGeminiSession(sessionId) {
    let geminiProc = activeGeminiProcesses.get(sessionId);
    let processKey = sessionId;

    if (!geminiProc) {
        for (const [key, proc] of activeGeminiProcesses.entries()) {
            if (proc.sessionId === sessionId) {
                geminiProc = proc;
                processKey = key;
                break;
            }
        }
    }

    if (geminiProc) {
        try {
            // The abort handler sends the terminal complete (aborted: true);
            // flag the process so its close handler does not emit a second one.
            geminiProc.aborted = true;
            geminiProc.kill('SIGTERM');
            setTimeout(() => {
                if (activeGeminiProcesses.has(processKey)) {
                    try {
                        geminiProc.kill('SIGKILL');
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

function isGeminiSessionActive(sessionId) {
    return activeGeminiProcesses.has(sessionId);
}

function getActiveGeminiSessions() {
    return Array.from(activeGeminiProcesses.keys());
}

export {
    spawnGemini,
    abortGeminiSession,
    isGeminiSessionActive,
    getActiveGeminiSessions
};
