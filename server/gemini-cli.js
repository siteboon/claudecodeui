import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';

// Use cross-spawn on Windows for correct .cmd resolution (same pattern as cursor-cli.js)
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import sessionManager from './sessionManager.js';
import GeminiResponseHandler from './gemini-response-handler.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { createNormalizedMessage } from './providers/types.js';
import { getStatusChecker } from './providers/registry.js';

let activeGeminiProcesses = new Map(); // Track active processes by session ID

async function spawnGemini(command, options = {}, ws) {
    const { sessionId, projectPath, cwd, toolsSettings, permissionMode, images, sessionSummary } = options;
    let capturedSessionId = sessionId; // Track session ID throughout the process
    let sessionCreatedSent = false; // Track if we've already sent session-created event
    let assistantBlocks = []; // Accumulate the full response blocks including tools

    // Use tools settings passed from frontend, or defaults
    const settings = toolsSettings || {
        allowedTools: [],
        disallowedTools: [],
        skipPermissions: false
    };

    // Build Gemini CLI command - start with print/resume flags first
    const args = [];

    // Add prompt flag with command if we have a command
    if (command && command.trim()) {
        args.push('--prompt', command);
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

    // Handle images by saving them to temporary files and passing paths to Gemini
    const tempImagePaths = [];
    let tempDir = null;
    if (images && images.length > 0) {
        try {
            // Create temp directory in the project directory so Gemini can access it
            tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
            await fs.mkdir(tempDir, { recursive: true });

            // Save each image to a temp file
            for (const [index, image] of images.entries()) {
                // Extract base64 data and mime type
                const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
                if (!matches) {
                    continue;
                }

                const [, mimeType, base64Data] = matches;
                const extension = mimeType.split('/')[1] || 'png';
                const filename = `image_${index}.${extension}`;
                const filepath = path.join(tempDir, filename);

                // Write base64 data to file
                await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
                tempImagePaths.push(filepath);
            }

            // Include the full image paths in the prompt for Gemini to reference
            // Gemini CLI can read images from file paths in the prompt
            if (tempImagePaths.length > 0 && command && command.trim()) {
                const imageNote = `\n\n[Images given: ${tempImagePaths.length} images are located at the following paths:]\n${tempImagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
                const modifiedCommand = command + imageNote;

                // Update the command in args
                const promptIndex = args.indexOf('--prompt');
                if (promptIndex !== -1 && args[promptIndex + 1] === command) {
                    args[promptIndex + 1] = modifiedCommand;
                } else if (promptIndex !== -1) {
                    // If we're using context, update the full prompt
                    args[promptIndex + 1] = args[promptIndex + 1] + imageNote;
                }
            }
        } catch (error) {
            console.error('Error processing images for Gemini:', error);
        }
    }

    // Add basic flags for Gemini
    if (options.debug) {
        args.push('--debug');
    }

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
    let modelToUse = options.model || 'gemini-2.5-flash';
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
    console.log('Spawning Gemini CLI:', geminiPath, args.join(' '));
    console.log('Working directory:', workingDir);

    let spawnCmd = geminiPath;
    let spawnArgs = args;

    // On non-Windows platforms, wrap the execution in a shell to avoid ENOEXEC
    // which happens when the target is a script lacking a shebang.
    if (os.platform() !== 'win32') {
        spawnCmd = 'sh';
        // Use exec to replace the shell process, ensuring signals hit gemini directly
        spawnArgs = ['-c', 'exec "$0" "$@"', geminiPath, ...args];
    }

    return new Promise((resolve, reject) => {
        const geminiProcess = spawnFunction(spawnCmd, spawnArgs, {
            cwd: workingDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env } // Inherit all environment variables
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

        // Attach temp file info to process for cleanup later
        geminiProcess.tempImagePaths = tempImagePaths;
        geminiProcess.tempDir = tempDir;

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
                    if (capturedSessionId) {
                        const sess = sessionManager.getSession(capturedSessionId);
                        if (sess && !sess.cliSessionId) {
                            sess.cliSessionId = event.session_id;
                            sessionManager.saveSession(capturedSessionId);
                        }
                    }
                }
            });
        }

        // Handle stdout
        geminiProcess.stdout.on('data', (data) => {
            const rawOutput = data.toString();
            startTimeout(); // Re-arm the timeout

            // For new sessions, create a session ID FIRST
            if (!sessionId && !sessionCreatedSent && !capturedSessionId) {
                capturedSessionId = `gemini_${Date.now()}`;
                sessionCreatedSent = true;

                // Create session in session manager
                sessionManager.createSession(capturedSessionId, cwd || process.cwd());

                // Save the user message now that we have a session ID
                if (command) {
                    sessionManager.addMessage(capturedSessionId, 'user', command);
                }

                // Update process key with captured session ID
                if (processKey !== capturedSessionId) {
                    activeGeminiProcesses.delete(processKey);
                    activeGeminiProcesses.set(capturedSessionId, geminiProcess);
                }

                ws.setSessionId && typeof ws.setSessionId === 'function' && ws.setSessionId(capturedSessionId);

                ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'gemini' }));
            }

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

            ws.send(createNormalizedMessage({ kind: 'complete', exitCode: code, isNewSession: !sessionId && !!command, sessionId: finalSessionId, provider: 'gemini' }));

            // Clean up temporary image files if any
            if (geminiProcess.tempImagePaths && geminiProcess.tempImagePaths.length > 0) {
                for (const imagePath of geminiProcess.tempImagePaths) {
                    await fs.unlink(imagePath).catch(err => { });
                }
                if (geminiProcess.tempDir) {
                    await fs.rm(geminiProcess.tempDir, { recursive: true, force: true }).catch(err => { });
                }
            }

            if (code === 0) {
                notifyTerminalState({ code });
                resolve();
            } else {
                // code 127 = shell "command not found" — check installation
                if (code === 127) {
                    const installed = getStatusChecker('gemini')?.checkInstalled() ?? true;
                    if (!installed) {
                        const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : finalSessionId;
                        ws.send(createNormalizedMessage({ kind: 'error', content: 'Gemini CLI is not installed. Please install it first: https://github.com/google-gemini/gemini-cli', sessionId: socketSessionId, provider: 'gemini' }));
                    }
                }

                notifyTerminalState({
                    code,
                    error: code === null ? 'Gemini CLI process was terminated or timed out' : null
                });
                reject(new Error(code === null ? 'Gemini CLI process was terminated or timed out' : `Gemini CLI exited with code ${code}`));
            }
        });

        // Handle process errors
        geminiProcess.on('error', (error) => {
            // Clean up process reference on error
            const finalSessionId = capturedSessionId || sessionId || processKey;
            activeGeminiProcesses.delete(finalSessionId);

            // Check if Gemini CLI is installed for a clearer error message
            const installed = getStatusChecker('gemini')?.checkInstalled() ?? true;
            const errorContent = !installed
                ? 'Gemini CLI is not installed. Please install it first: https://github.com/google-gemini/gemini-cli'
                : error.message;

            const errorSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : finalSessionId;
            ws.send(createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: errorSessionId, provider: 'gemini' }));
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
