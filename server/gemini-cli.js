import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { getSessions, getSessionMessages } from './projects.js';
import sessionManager from './sessionManager.js';
import GeminiResponseHandler from './gemini-response-handler.js';

let activeGeminiProcesses = new Map(); // Track active processes by session ID

async function spawnGemini(command, options = {}, ws) {
    return new Promise(async (resolve, reject) => {
        const { sessionId, projectPath, cwd, resume, toolsSettings, permissionMode, images } = options;
        let capturedSessionId = sessionId; // Track session ID throughout the process
        let sessionCreatedSent = false; // Track if we've already sent session-created event
        let fullResponse = ''; // Accumulate the full response

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
            // If we have a sessionId, include conversation history
            if (sessionId) {
                const context = sessionManager.buildConversationContext(sessionId);
                if (context) {
                    // Combine context with current command
                    const fullPrompt = context + command;
                    args.push('--prompt', fullPrompt);
                } else {
                    args.push('--prompt', command);
                }
            } else {
                args.push('--prompt', command);
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
            const fsSync = await import('fs');
            const geminiConfigPath = path.join(os.homedir(), '.gemini.json');
            let hasMcpServers = false;

            if (fsSync.existsSync(geminiConfigPath)) {
                try {
                    const geminiConfig = JSON.parse(fsSync.readFileSync(geminiConfigPath, 'utf8'));

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
                } catch (e) { }
            }

            if (hasMcpServers) {
                let configPath = null;
                if (fsSync.existsSync(geminiConfigPath)) {
                    configPath = geminiConfigPath;
                }
                if (configPath) {
                    args.push('--mcp-config', configPath);
                }
            }
        } catch (error) { }

        // Add model for all sessions (both new and resumed)
        const modelToUse = options.model || 'gemini-2.5-flash';
        args.push('--model', modelToUse);

        // Add --yolo flag if skipPermissions is enabled
        if (settings.skipPermissions || options.skipPermissions) {
            args.push('--yolo');
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
            spawnArgs = ['-c', `"${geminiPath}" "$@"`, '--', ...args];
        }

        const geminiProcess = spawn(spawnCmd, spawnArgs, {
            cwd: workingDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env } // Inherit all environment variables
        });

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
        let hasReceivedOutput = false;
        const timeoutMs = 30000; // 30 seconds
        const timeout = setTimeout(() => {
            if (!hasReceivedOutput) {
                ws.send({
                    type: 'gemini-error',
                    error: 'Gemini CLI timeout - no response received'
                });
                geminiProcess.kill('SIGTERM');
            }
        }, timeoutMs);

        // Save user message to session when starting
        if (command && capturedSessionId) {
            sessionManager.addMessage(capturedSessionId, 'user', command);
        }

        // Create response handler for intelligent buffering
        let responseHandler;
        if (ws) {
            responseHandler = new GeminiResponseHandler(ws, {
                partialDelay: 300,
                maxWaitTime: 1500,
                minBufferSize: 30
            });
        }

        // Handle stdout (Gemini outputs plain text)
        geminiProcess.stdout.on('data', (data) => {
            const rawOutput = data.toString();
            hasReceivedOutput = true;
            clearTimeout(timeout);

            // Filter out debug messages and system messages
            const lines = rawOutput.split('\n');
            const filteredLines = lines.filter(line => {
                // Skip debug messages and "Loaded cached credentials"
                if (line.includes('[DEBUG]') ||
                    line.includes('Flushing log events') ||
                    line.includes('Clearcut response') ||
                    line.includes('[MemoryDiscovery]') ||
                    line.includes('[BfsFileSearch]') ||
                    line.includes('Loaded cached credentials')) {
                    return false;
                }
                return true;
            });

            const filteredOutput = filteredLines.join('\n').trim();

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

                ws.send({
                    type: 'session-created',
                    sessionId: capturedSessionId
                });
            }

            if (filteredOutput) {
                // Accumulate the full response
                fullResponse += (fullResponse ? '\n' : '') + filteredOutput;

                // Use response handler for intelligent buffering
                if (responseHandler) {
                    responseHandler.processData(filteredOutput);
                } else {
                    // Fallback to direct sending
                    const socketSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : (capturedSessionId || sessionId);
                    ws.send({
                        type: 'gemini-response',
                        sessionId: socketSessionId,
                        data: {
                            type: 'message',
                            content: filteredOutput
                        }
                    });
                }
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
            ws.send({
                type: 'gemini-error',
                sessionId: socketSessionId,
                error: errorMsg
            });
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
            if (finalSessionId && fullResponse) {
                sessionManager.addMessage(finalSessionId, 'assistant', fullResponse);
            }

            ws.send({
                type: 'claude-complete', // Use claude-complete for compatibility with UI
                sessionId: finalSessionId,
                exitCode: code,
                isNewSession: !sessionId && !!command // Flag to indicate this was a new session
            });

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
                resolve();
            } else {
                reject(new Error(`Gemini CLI exited with code ${code}`));
            }
        });

        // Handle process errors
        geminiProcess.on('error', (error) => {
            // Clean up process reference on error
            const finalSessionId = capturedSessionId || sessionId || processKey;
            activeGeminiProcesses.delete(finalSessionId);

            const errorSessionId = typeof ws.getSessionId === 'function' ? ws.getSessionId() : finalSessionId;
            ws.send({
                type: 'gemini-error',
                sessionId: errorSessionId,
                error: error.message
            });

            reject(error);
        });

    });
}

function abortGeminiSession(sessionId) {
    let process = activeGeminiProcesses.get(sessionId);
    let processKey = sessionId;

    if (!process) {
        for (const [key, proc] of activeGeminiProcesses.entries()) {
            if (key.includes(sessionId) || sessionId.includes(key)) {
                process = proc;
                processKey = key;
                break;
            }
        }
    }

    if (process) {
        try {
            process.kill('SIGTERM');
            setTimeout(() => {
                if (activeGeminiProcesses.has(processKey)) {
                    try {
                        process.kill('SIGKILL');
                    } catch (e) { }
                }
            }, 2000); // Wait 2 seconds before force kill

            activeGeminiProcesses.delete(processKey);
            return true;
        } catch (error) {
            activeGeminiProcesses.delete(processKey);
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
