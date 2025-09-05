import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Use cross-spawn on Windows for better command execution
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

let activeCodegenProcesses = new Map(); // Track active processes by session ID

async function spawnCodegen(command, options = {}, ws) {
  return new Promise(async (resolve, reject) => {
    const { sessionId, projectPath, cwd, resume, toolsSettings, permissionMode, images } = options;
    let capturedSessionId = sessionId; // Track session ID throughout the process
    let sessionCreatedSent = false; // Track if we've already sent session-created event
    
    // Use tools settings passed from frontend, or defaults
    const settings = toolsSettings || {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false
    };
    
    // Build Codegen CLI command
    const args = [];
    
    // Add command if we have one
    if (command && command.trim()) {
      args.push('--message');
      args.push(command);
    }
    
    // Use cwd (actual project directory) instead of projectPath
    const workingDir = cwd || process.cwd();
    
    // Handle images by saving them to temporary files and passing paths to Codegen
    const tempImagePaths = [];
    let tempDir = null;
    if (images && images.length > 0) {
      try {
        // Create temp directory in the project directory so Codegen can access it
        tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
        await fs.mkdir(tempDir, { recursive: true });
        
        // Save each image to a temp file
        for (const [index, image] of images.entries()) {
          const imageBuffer = Buffer.from(image.data, 'base64');
          const extension = image.type.split('/')[1] || 'png';
          const filename = `image_${index}.${extension}`;
          const imagePath = path.join(tempDir, filename);
          
          await fs.writeFile(imagePath, imageBuffer);
          tempImagePaths.push(imagePath);
        }
        
        // Add image paths to Codegen command
        if (tempImagePaths.length > 0) {
          args.push('--images');
          args.push(tempImagePaths.join(','));
        }
      } catch (error) {
        console.error('Error handling images:', error);
        ws?.send(JSON.stringify({
          type: 'error',
          data: `Error processing images: ${error.message}`
        }));
      }
    }
    
    // Add resume flag if resuming
    if (resume && sessionId) {
      args.push('--resume');
      args.push(sessionId);
    }
    
    // Add project path if specified
    if (projectPath) {
      args.push('--project');
      args.push(projectPath);
    }
    
    // Add tools configuration
    if (settings.allowedTools && settings.allowedTools.length > 0) {
      args.push('--allow-tools');
      args.push(settings.allowedTools.join(','));
    }
    
    if (settings.disallowedTools && settings.disallowedTools.length > 0) {
      args.push('--deny-tools');
      args.push(settings.disallowedTools.join(','));
    }
    
    if (settings.skipPermissions) {
      args.push('--auto-approve');
    }
    
    console.log('Spawning Codegen with args:', args);
    console.log('Working directory:', workingDir);
    
    // Get Codegen CLI path from environment or use default
    const codegenPath = process.env.CODEGEN_CLI_PATH || 'codegen';
    
    // Spawn the Codegen process
    const child = spawnFunction(codegenPath, args, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        TERM: 'xterm-256color'
      }
    });
    
    // Store the process for potential abortion
    if (capturedSessionId) {
      activeCodegenProcesses.set(capturedSessionId, child);
    }
    
    let outputBuffer = '';
    let errorBuffer = '';
    let isSessionActive = false;
    
    // Handle stdout
    child.stdout.on('data', (data) => {
      const output = data.toString();
      outputBuffer += output;
      
      // Send real-time output to WebSocket
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'codegen-output',
          data: output,
          sessionId: capturedSessionId
        }));
      }
      
      // Parse Codegen output for session information
      const lines = output.split('\n');
      for (const line of lines) {
        // Look for session ID in output
        const sessionMatch = line.match(/Session ID: ([a-zA-Z0-9-]+)/);
        if (sessionMatch && !capturedSessionId) {
          capturedSessionId = sessionMatch[1];
          activeCodegenProcesses.set(capturedSessionId, child);
          
          if (ws && ws.readyState === ws.OPEN && !sessionCreatedSent) {
            ws.send(JSON.stringify({
              type: 'session-created',
              sessionId: capturedSessionId,
              projectPath: projectPath || workingDir
            }));
            sessionCreatedSent = true;
          }
        }
        
        // Check if session is active
        if (line.includes('Codegen is ready') || line.includes('Session started')) {
          isSessionActive = true;
        }
      }
    });
    
    // Handle stderr
    child.stderr.on('data', (data) => {
      const error = data.toString();
      errorBuffer += error;
      
      // Send error output to WebSocket
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'codegen-error',
          data: error,
          sessionId: capturedSessionId
        }));
      }
    });
    
    // Handle process exit
    child.on('close', async (code, signal) => {
      console.log(`Codegen process exited with code ${code}, signal ${signal}`);
      
      // Clean up temporary images
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
          console.error('Error cleaning up temp images:', error);
        }
      }
      
      // Remove from active processes
      if (capturedSessionId) {
        activeCodegenProcesses.delete(capturedSessionId);
      }
      
      // Send completion message to WebSocket
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'codegen-complete',
          code,
          signal,
          sessionId: capturedSessionId,
          output: outputBuffer,
          error: errorBuffer
        }));
      }
      
      if (code === 0) {
        resolve({
          success: true,
          output: outputBuffer,
          sessionId: capturedSessionId,
          isSessionActive
        });
      } else {
        reject(new Error(`Codegen process failed with code ${code}: ${errorBuffer}`));
      }
    });
    
    // Handle process error
    child.on('error', (error) => {
      console.error('Codegen process error:', error);
      
      // Remove from active processes
      if (capturedSessionId) {
        activeCodegenProcesses.delete(capturedSessionId);
      }
      
      // Send error to WebSocket
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'codegen-error',
          data: error.message,
          sessionId: capturedSessionId
        }));
      }
      
      reject(error);
    });
    
    // Send initial input if we have a command
    if (command && command.trim()) {
      child.stdin.write(command + '\n');
    }
  });
}

// Function to abort a Codegen session
function abortCodegenSession(sessionId) {
  const process = activeCodegenProcesses.get(sessionId);
  if (process) {
    console.log(`Aborting Codegen session: ${sessionId}`);
    process.kill('SIGTERM');
    activeCodegenProcesses.delete(sessionId);
    return true;
  }
  return false;
}

// Function to get active Codegen sessions
function getActiveCodegenSessions() {
  return Array.from(activeCodegenProcesses.keys());
}

// Function to send input to an active Codegen session
function sendInputToCodegenSession(sessionId, input) {
  const process = activeCodegenProcesses.get(sessionId);
  if (process && process.stdin && process.stdin.writable) {
    process.stdin.write(input + '\n');
    return true;
  }
  return false;
}

export { 
  spawnCodegen, 
  abortCodegenSession, 
  getActiveCodegenSessions, 
  sendInputToCodegenSession 
};
