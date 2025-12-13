import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Use cross-spawn on Windows for better command execution
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

let activeCursorProcesses = new Map(); // Track active processes by session ID

async function spawnCursor(command, options = {}, ws) {
  return new Promise(async (resolve, reject) => {
    const { sessionId, projectPath, cwd, resume, toolsSettings, skipPermissions, model, images } = options;
    let capturedSessionId = sessionId; // Track session ID throughout the process
    let sessionCreatedSent = false; // Track if we've already sent session-created event
    let messageBuffer = ''; // Buffer for accumulating assistant messages
    
    // Use tools settings passed from frontend, or defaults
    const settings = toolsSettings || {
      allowedShellCommands: [],
      skipPermissions: false
    };
    
    // Build Cursor CLI command
    const args = [];
    
    // Build flags allowing both resume and prompt together (reply in existing session)
    // Treat presence of sessionId as intention to resume, regardless of resume flag
    if (sessionId) {
      args.push('--resume=' + sessionId);
    }

    if (command && command.trim()) {
      // Provide a prompt (works for both new and resumed sessions)
      args.push('-p', command);

      // Add model flag if specified (only meaningful for new sessions; harmless on resume)
      if (!sessionId && model) {
        args.push('--model', model);
      }

      // Request streaming JSON when we are providing a prompt
      args.push('--output-format', 'stream-json');
    }
    
    // Add skip permissions flag if enabled
    if (skipPermissions || settings.skipPermissions) {
      args.push('-f');
      console.log('⚠️  Using -f flag (skip permissions)');
    }
    
    // Use cwd (actual project directory) instead of projectPath
    const workingDir = cwd || projectPath || process.cwd();
    
    console.log('Spawning Cursor CLI:', 'cursor-agent', args.join(' '));
    console.log('Working directory:', workingDir);
    console.log('Session info - Input sessionId:', sessionId, 'Resume:', resume);
    
    const cursorProcess = spawnFunction('cursor-agent', args, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env } // Inherit all environment variables
    });
    
    // Store process reference for potential abort
    const processKey = capturedSessionId || Date.now().toString();
    activeCursorProcesses.set(processKey, cursorProcess);
    
    // Handle stdout (streaming JSON responses)
    cursorProcess.stdout.on('data', (data) => {
      const rawOutput = data.toString();
      console.log('📤 Cursor CLI stdout:', rawOutput);
      
      const lines = rawOutput.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          console.log('📄 Parsed JSON response:', response);
          
          // Handle different message types
          switch (response.type) {
            case 'system':
              if (response.subtype === 'init') {
                // Capture session ID
                if (response.session_id && !capturedSessionId) {
                  capturedSessionId = response.session_id;
                  console.log('📝 Captured session ID:', capturedSessionId);
                  
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
                    ws.send(JSON.stringify({
                      type: 'session-created',
                      sessionId: capturedSessionId,
                      model: response.model,
                      cwd: response.cwd
                    }));
                  }
                }
                
                // Send system info to frontend
                ws.send(JSON.stringify({
                  type: 'cursor-system',
                  data: response
                }));
              }
              break;
              
            case 'user':
              // Forward user message
              ws.send(JSON.stringify({
                type: 'cursor-user',
                data: response
              }));
              break;
              
            case 'assistant':
              // Accumulate assistant message chunks
              if (response.message && response.message.content && response.message.content.length > 0) {
                const textContent = response.message.content[0].text;
                messageBuffer += textContent;
                
                // Send as Claude-compatible format for frontend
                ws.send(JSON.stringify({
                  type: 'claude-response',
                  data: {
                    type: 'content_block_delta',
                    delta: {
                      type: 'text_delta',
                      text: textContent
                    }
                  }
                }));
              }
              break;
              
            case 'result':
              // Session complete
              console.log('Cursor session result:', response);
              
              // Send final message if we have buffered content
              if (messageBuffer) {
                ws.send(JSON.stringify({
                  type: 'claude-response',
                  data: {
                    type: 'content_block_stop'
                  }
                }));
              }
              
              // Send completion event
              ws.send(JSON.stringify({
                type: 'cursor-result',
                sessionId: capturedSessionId || sessionId,
                data: response,
                success: response.subtype === 'success'
              }));
              break;
              
            default:
              // Forward any other message types
              ws.send(JSON.stringify({
                type: 'cursor-response',
                data: response
              }));
          }
        } catch (parseError) {
          console.log('📄 Non-JSON response:', line);
          // If not JSON, send as raw text
          ws.send(JSON.stringify({
            type: 'cursor-output',
            data: line
          }));
        }
      }
    });
    
    // Handle stderr
    cursorProcess.stderr.on('data', (data) => {
      console.error('Cursor CLI stderr:', data.toString());
      ws.send(JSON.stringify({
        type: 'cursor-error',
        error: data.toString()
      }));
    });
    
    // Handle process completion
    cursorProcess.on('close', async (code) => {
      console.log(`Cursor CLI process exited with code ${code}`);
      
      // Clean up process reference
      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeCursorProcesses.delete(finalSessionId);

      ws.send(JSON.stringify({
        type: 'claude-complete',
        sessionId: finalSessionId,
        exitCode: code,
        isNewSession: !sessionId && !!command // Flag to indicate this was a new session
      }));
      
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Cursor CLI exited with code ${code}`));
      }
    });
    
    // Handle process errors
    cursorProcess.on('error', (error) => {
      console.error('Cursor CLI process error:', error);
      
      // Clean up process reference on error
      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeCursorProcesses.delete(finalSessionId);
      
      ws.send(JSON.stringify({
        type: 'cursor-error',
        error: error.message
      }));
      
      reject(error);
    });
    
    // Close stdin since Cursor doesn't need interactive input
    cursorProcess.stdin.end();
  });
}

function abortCursorSession(sessionId) {
  const process = activeCursorProcesses.get(sessionId);
  if (process) {
    console.log(`🛑 Aborting Cursor session: ${sessionId}`);
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