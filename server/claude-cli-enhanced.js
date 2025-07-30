import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { parseAnsi } from './utils/ansi-parser.js';

// Track active processes
let activeClaudeProcesses = new Map();

// Enhanced spawn function that captures both JSON and raw terminal output
export async function spawnClaudeEnhanced(command, options = {}, ws) {
  return new Promise(async (resolve, reject) => {
    const { sessionId, projectPath, cwd, resume, toolsSettings, permissionMode, images } = options;
    let capturedSessionId = sessionId;
    let sessionCreatedSent = false;
    let currentOperation = null;
    let operationPhases = [];
    let metrics = {
      startTime: Date.now(),
      tokensUsed: 0,
      toolsExecuted: [],
      filesModified: new Set(),
      errors: []
    };
    
    const settings = toolsSettings || {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false
    };
    
    // Build Claude CLI command for BOTH streams
    const args = [];
    
    if (command && command.trim()) {
      args.push('--print', command);
    }
    
    const workingDir = cwd || process.cwd();
    
    // Handle images (existing code)
    const tempImagePaths = [];
    let tempDir = null;
    if (images && images.length > 0) {
      try {
        tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
        await fs.mkdir(tempDir, { recursive: true });
        
        for (const [index, image] of images.entries()) {
          const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
          if (!matches) continue;
          
          const [, mimeType, base64Data] = matches;
          const extension = mimeType.split('/')[1] || 'png';
          const filename = `image_${index}.${extension}`;
          const filepath = path.join(tempDir, filename);
          
          await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
          tempImagePaths.push(filepath);
        }
        
        if (tempImagePaths.length > 0 && command && command.trim()) {
          const imageNote = `\n\n[Images provided at: ${tempImagePaths.join(', ')}]`;
          const modifiedCommand = command + imageNote;
          const printIndex = args.indexOf('--print');
          if (printIndex !== -1 && args[printIndex + 1] === command) {
            args[printIndex + 1] = modifiedCommand;
          }
        }
      } catch (error) {
        console.error('Error processing images:', error);
      }
    }
    
    if (resume && sessionId) {
      args.push('--resume', sessionId);
    }
    
    // DUAL STREAM: Create TWO Claude processes
    // Stream 1: JSON for structured data
    const jsonArgs = [...args, '--output-format', 'stream-json', '--verbose'];
    
    // Stream 2: Raw terminal for visual output (only if not using --print)
    const terminalArgs = resume && sessionId ? 
      ['--resume', sessionId] : 
      (command ? ['--print', command] : []);
    
    // Add tool settings to both streams
    [jsonArgs, terminalArgs].forEach(streamArgs => {
      if (settings.skipPermissions && permissionMode !== 'plan') {
        streamArgs.push('--dangerously-skip-permissions');
      } else {
        let allowedTools = [...(settings.allowedTools || [])];
        
        if (permissionMode === 'plan') {
          const planModeTools = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite'];
          for (const tool of planModeTools) {
            if (!allowedTools.includes(tool)) {
              allowedTools.push(tool);
            }
          }
        }
        
        if (allowedTools.length > 0) {
          for (const tool of allowedTools) {
            streamArgs.push('--allowedTools', tool);
          }
        }
        
        if (settings.disallowedTools && settings.disallowedTools.length > 0) {
          for (const tool of settings.disallowedTools) {
            streamArgs.push('--disallowedTools', tool);
          }
        }
      }
      
      if (!resume) {
        streamArgs.push('--model', 'sonnet');
      }
      
      if (permissionMode && permissionMode !== 'default') {
        streamArgs.push('--permission-mode', permissionMode);
      }
    });
    
    console.log('🚀 Spawning enhanced Claude CLI with dual streams');
    console.log('📊 JSON Stream args:', jsonArgs);
    console.log('🖥️  Terminal Stream args:', terminalArgs);
    
    // Spawn JSON stream process
    const jsonProcess = spawn('claude', jsonArgs, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });
    
    // Spawn terminal stream process (only if it makes sense)
    let terminalProcess = null;
    if (!command || command.trim() === '') {
      // Only spawn terminal stream for interactive sessions
      terminalProcess = spawn('claude', terminalArgs, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { 
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        }
      });
    }
    
    // Store process references
    const processKey = capturedSessionId || sessionId || Date.now().toString();
    activeClaudeProcesses.set(processKey, { jsonProcess, terminalProcess });
    
    // Handle JSON stream
    jsonProcess.stdout.on('data', (data) => {
      const rawOutput = data.toString();
      const lines = rawOutput.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          
          // Capture session ID
          if (response.session_id && !capturedSessionId) {
            capturedSessionId = response.session_id;
            if (processKey !== capturedSessionId) {
              activeClaudeProcesses.delete(processKey);
              activeClaudeProcesses.set(capturedSessionId, { jsonProcess, terminalProcess });
            }
            
            if (!sessionId && !sessionCreatedSent) {
              sessionCreatedSent = true;
              ws.send(JSON.stringify({
                type: 'session-created',
                sessionId: capturedSessionId
              }));
            }
          }
          
          // Enhanced tool tracking
          if (response.type === 'tool_use') {
            const toolInfo = {
              name: response.name,
              parameters: response.parameters,
              timestamp: Date.now(),
              duration: 0
            };
            
            metrics.toolsExecuted.push(toolInfo);
            
            // Extract file paths from tool parameters
            if (response.parameters) {
              if (response.parameters.file_path) {
                metrics.filesModified.add(response.parameters.file_path);
              }
              if (response.parameters.pattern) {
                currentOperation = `Searching for: ${response.parameters.pattern}`;
              }
            }
            
            // Send enhanced tool information
            ws.send(JSON.stringify({
              type: 'tool-execution',
              tool: toolInfo,
              context: {
                operation: currentOperation,
                workingDir: workingDir,
                filesTracked: Array.from(metrics.filesModified)
              }
            }));
          }
          
          // Track tokens
          if (response.usage) {
            metrics.tokensUsed += response.usage.total_tokens || 0;
            
            ws.send(JSON.stringify({
              type: 'metrics-update',
              metrics: {
                tokensUsed: metrics.tokensUsed,
                estimatedCost: calculateCost(metrics.tokensUsed),
                duration: Date.now() - metrics.startTime,
                toolCount: metrics.toolsExecuted.length,
                filesModified: Array.from(metrics.filesModified).length
              }
            }));
          }
          
          // Send structured response
          ws.send(JSON.stringify({
            type: 'claude-response',
            data: response,
            stream: 'json'
          }));
          
        } catch (parseError) {
          // Non-JSON output
          ws.send(JSON.stringify({
            type: 'claude-output',
            data: line,
            stream: 'json-raw'
          }));
        }
      }
    });
    
    // Handle terminal stream (if exists)
    if (terminalProcess) {
      let terminalBuffer = '';
      
      terminalProcess.stdout.on('data', (data) => {
        const output = data.toString();
        terminalBuffer += output;
        
        // Parse ANSI codes and extract meaningful information
        const parsed = parseAnsi(output);
        
        // Detect operation phases
        if (output.includes('Phase') || output.includes('Step')) {
          const phaseMatch = output.match(/(Phase|Step)\s+(\d+)(?:\/(\d+))?\s*:\s*(.+)/);
          if (phaseMatch) {
            operationPhases.push({
              type: phaseMatch[1],
              current: parseInt(phaseMatch[2]),
              total: phaseMatch[3] ? parseInt(phaseMatch[3]) : null,
              description: phaseMatch[4].trim(),
              timestamp: Date.now()
            });
            
            ws.send(JSON.stringify({
              type: 'operation-phase',
              phase: operationPhases[operationPhases.length - 1]
            }));
          }
        }
        
        // Detect progress indicators
        if (output.includes('%') || output.includes('...')) {
          const progressMatch = output.match(/(\d+)%/);
          if (progressMatch) {
            ws.send(JSON.stringify({
              type: 'progress-update',
              progress: parseInt(progressMatch[1]),
              context: parsed.text
            }));
          }
        }
        
        // Send raw terminal output with ANSI codes
        ws.send(JSON.stringify({
          type: 'terminal-output',
          data: output,
          parsed: parsed
        }));
      });
      
      terminalProcess.stderr.on('data', (data) => {
        const error = data.toString();
        metrics.errors.push({
          message: error,
          timestamp: Date.now()
        });
        
        ws.send(JSON.stringify({
          type: 'terminal-error',
          error: error,
          context: currentOperation
        }));
      });
    }
    
    // Handle process completion
    const handleProcessClose = (code) => {
      console.log(`Claude CLI process exited with code ${code}`);
      
      // Clean up
      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeClaudeProcesses.delete(finalSessionId);
      
      // Clean up temp images
      if (tempDir) {
        fs.rm(tempDir, { recursive: true, force: true }).catch(console.error);
      }
      
      // Send final metrics
      ws.send(JSON.stringify({
        type: 'session-complete',
        metrics: {
          totalDuration: Date.now() - metrics.startTime,
          tokensUsed: metrics.tokensUsed,
          estimatedCost: calculateCost(metrics.tokensUsed),
          toolsExecuted: metrics.toolsExecuted.length,
          filesModified: Array.from(metrics.filesModified),
          errors: metrics.errors,
          exitCode: code
        }
      }));
      
      resolve();
    };
    
    jsonProcess.on('close', handleProcessClose);
    if (terminalProcess) {
      terminalProcess.on('close', () => {
        // Terminal process close is secondary
      });
    }
    
    // Handle errors
    jsonProcess.on('error', (error) => {
      console.error('JSON process error:', error);
      reject(error);
    });
    
    if (terminalProcess) {
      terminalProcess.on('error', (error) => {
        console.error('Terminal process error:', error);
        // Don't reject for terminal errors
      });
    }
  });
}

// Calculate estimated cost based on token usage
function calculateCost(tokens) {
  // Rough estimates - adjust based on actual pricing
  const costPer1kTokens = 0.01; // $0.01 per 1k tokens
  return (tokens / 1000 * costPer1kTokens).toFixed(4);
}

// Abort enhanced session
export function abortClaudeEnhancedSession(sessionId) {
  const processes = activeClaudeProcesses.get(sessionId);
  if (processes) {
    if (processes.jsonProcess && !processes.jsonProcess.killed) {
      processes.jsonProcess.kill('SIGTERM');
    }
    if (processes.terminalProcess && !processes.terminalProcess.killed) {
      processes.terminalProcess.kill('SIGTERM');
    }
    activeClaudeProcesses.delete(sessionId);
    return true;
  }
  return false;
}

// Export original functions for compatibility
export { spawnClaudeEnhanced as spawnClaude };
export { abortClaudeEnhancedSession as abortClaudeSession };