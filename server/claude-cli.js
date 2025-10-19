import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Use cross-spawn on Windows for better command execution
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

let activeClaudeProcesses = new Map(); // Track active processes by session ID

// Auto-compact constants
const TOKEN_BUDGET_TOTAL = 200000;
let tokenCriticalThreshold = 30000; // Auto-compact trigger threshold (configurable)
const AUTO_COMPACT_COOLDOWN = 300000; // 5 minutes cooldown to prevent loops

// Track token usage and auto-compact state per session
const sessionTokenUsage = new Map();

// Track in-progress auto-compact operations to prevent double-trigger
const activeAutoCompacts = new Set();

/**
 * Parse system warnings from Claude output for token budget information
 * Example: <system_warning>Token usage: 95000/200000; 105000 remaining</system_warning>
 * Example with commas: <system_warning>Token usage: 95,000/200,000; 105,000 remaining</system_warning>
 * @param {string} output - Raw output string from Claude CLI
 * @returns {object|null} Token data object with used, total, remaining or null if not found
 */
function parseSystemWarnings(output) {
  // Make regex more robust: handle commas in numbers, case-insensitive matching
  const warningMatch = output.match(/Token usage:\s*([\d,]+)\s*\/\s*([\d,]+);\s*([\d,]+)\s+remaining/i);
  if (warningMatch) {
    return {
      used: parseInt(warningMatch[1].replace(/,/g, '')),
      total: parseInt(warningMatch[2].replace(/,/g, '')),
      remaining: parseInt(warningMatch[3].replace(/,/g, ''))
    };
  }
  return null;
}

/**
 * Check if auto-compact should trigger based on token threshold and cooldown
 * @param {string} sessionId - Current Claude session ID
 * @param {object} tokenData - Token budget data from parseSystemWarnings
 * @returns {boolean} True if auto-compact should trigger
 */
function shouldTriggerAutoCompact(sessionId, tokenData) {
  // Check if already compacting for this session (prevent double-trigger)
  if (activeAutoCompacts.has(sessionId)) {
    console.log(`⏸️ Auto-compact skipped: already in progress for session ${sessionId}`);
    return false;
  }

  // Check if remaining tokens below critical threshold
  if (tokenData.remaining < tokenCriticalThreshold) {
    // Check if we haven't auto-compacted recently (avoid loops)
    const sessionData = sessionTokenUsage.get(sessionId);
    const lastCompactTime = sessionData?.lastCompactTime;
    const now = Date.now();

    if (!lastCompactTime || (now - lastCompactTime) > AUTO_COMPACT_COOLDOWN) {
      console.log(`⚡ Auto-compact trigger conditions met: ${tokenData.remaining} tokens remaining, cooldown satisfied`);
      return true;
    } else {
      const timeSinceLastCompact = Math.floor((now - lastCompactTime) / 1000);
      console.log(`⏸️ Auto-compact skipped: in cooldown period (${timeSinceLastCompact}s since last compact)`);
    }
  }
  return false;
}

/**
 * Execute /context save command to compress conversation context
 * @param {string} sessionId - Claude session ID to compact
 * @returns {Promise<object>} Result object with tokensSaved count
 */
async function executeContextSave(sessionId) {
  return new Promise((resolve, reject) => {
    console.log(`📦 Executing /context save for session ${sessionId}`);

    const args = [
      '--resume', sessionId,
      '--output-format', 'stream-json',
      '--print',
      '--',
      '/context save'
    ];

    // Honor CLAUDE_CLI_PATH environment variable
    const claudePath = process.env.CLAUDE_CLI_PATH || 'claude';
    console.log('🔍 Using Claude CLI path for context save:', claudePath);

    const compactProcess = spawnFunction(claudePath, args, {
      cwd: process.cwd(),
      env: process.env
    });

    let compactOutput = '';

    compactProcess.stdout.on('data', (data) => {
      compactOutput += data.toString();
      console.log('📤 Context save output:', data.toString());
    });

    compactProcess.stderr.on('data', (data) => {
      console.error('❌ Context save error:', data.toString());
    });

    compactProcess.on('close', (code) => {
      if (code === 0) {
        // Parse output to extract tokens saved
        const tokensSaved = parseTokensSavedFromOutput(compactOutput);
        console.log(`✅ Context save completed: ${tokensSaved !== null ? tokensSaved + ' tokens saved' : 'tokens saved unknown'}`);
        resolve({ tokensSaved });
      } else {
        reject(new Error(`Context save failed with exit code ${code}`));
      }
    });

    compactProcess.on('error', (error) => {
      console.error('❌ Context save process error:', error);
      reject(error);
    });
  });
}

/**
 * Parse tokens saved from /context save command output
 * @param {string} output - Raw output from /context save command
 * @returns {number|null} Tokens saved count or null if not found
 */
function parseTokensSavedFromOutput(output) {
  // Look for token count in output (Claude may report this)
  const tokenMatch = output.match(/Saved ([\d,]+) tokens|Compressed ([\d,]+) tokens/i);
  if (tokenMatch) {
    const tokensStr = tokenMatch[1] || tokenMatch[2];
    return parseInt(tokensStr.replace(/,/g, ''));
  }

  // Return null if we can't determine actual tokens saved
  // Don't inflate expectations with guesses
  return null;
}

/**
 * Trigger auto-compact workflow: notify frontend, execute /context save, report results
 * @param {string} sessionId - Claude session ID
 * @param {object} tokenData - Current token budget data
 * @param {object} ws - WebSocket connection to frontend
 */
async function triggerAutoCompact(sessionId, tokenData, ws) {
  console.log(`⚡ Auto-compact triggered for session ${sessionId}: ${tokenData.remaining} tokens remaining`);

  // Mark as in-progress to prevent double-trigger
  activeAutoCompacts.add(sessionId);

  // Record compact time to prevent loops
  const sessionData = sessionTokenUsage.get(sessionId) || {};
  sessionData.lastCompactTime = Date.now();
  sessionTokenUsage.set(sessionId, sessionData);

  // Notify frontend that auto-compact is starting
  ws.send(JSON.stringify({
    type: 'auto-compact-triggered',
    data: {
      sessionId,
      remainingTokens: tokenData.remaining,
      message: `⚡ Auto-compressing context (${tokenData.remaining.toLocaleString()} tokens remaining)...`
    }
  }));

  // Execute /context save command
  try {
    const compactResult = await executeContextSave(sessionId);

    // Build message based on whether we know tokens saved
    const message = compactResult.tokensSaved !== null
      ? `✅ Context compressed → Saved ${compactResult.tokensSaved.toLocaleString()} tokens → Continuing workflow`
      : `✅ Context compressed → Continuing workflow`;

    ws.send(JSON.stringify({
      type: 'auto-compact-complete',
      data: {
        sessionId,
        tokensSaved: compactResult.tokensSaved,
        message
      }
    }));
  } catch (error) {
    console.error('❌ Auto-compact failed:', error);
    ws.send(JSON.stringify({
      type: 'auto-compact-error',
      data: {
        sessionId,
        error: error.message,
        message: `❌ Auto-compact failed: ${error.message}`
      }
    }));
  } finally {
    // Remove in-progress flag after completion (success or failure)
    activeAutoCompacts.delete(sessionId);
  }
}

async function spawnClaude(command, options = {}, ws) {
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

    // Apply auto-compact settings from toolsSettings if provided
    if (toolsSettings?.autoCompactEnabled !== undefined && toolsSettings?.autoCompactThreshold !== undefined) {
      tokenCriticalThreshold = Math.max(10000, Math.min(100000, toolsSettings.autoCompactThreshold));
      console.log('🔧 Auto-compact threshold set to:', tokenCriticalThreshold);
    }
    
    // Build Claude CLI command - start with print/resume flags first
    const args = [];
    
    // Use cwd (actual project directory) instead of projectPath (Claude's metadata directory)
    const workingDir = cwd || process.cwd();
    
    // Handle images by saving them to temporary files and passing paths to Claude
    const tempImagePaths = [];
    let tempDir = null;
    if (images && images.length > 0) {
      try {
        // Create temp directory in the project directory so Claude can access it
        tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
        await fs.mkdir(tempDir, { recursive: true });
        
        // Save each image to a temp file
        for (const [index, image] of images.entries()) {
          // Extract base64 data and mime type
          const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
          if (!matches) {
            console.error('Invalid image data format');
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
        
        // Include the full image paths in the prompt for Claude to reference
        // Only modify the command if we actually have images and a command
        if (tempImagePaths.length > 0 && command && command.trim()) {
          const imageNote = `\n\n[Images provided at the following paths:]\n${tempImagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
          const modifiedCommand = command + imageNote;
          
          // Update the command in args - now that --print and command are separate
          const printIndex = args.indexOf('--print');
          if (printIndex !== -1 && printIndex + 1 < args.length && args[printIndex + 1] === command) {
            args[printIndex + 1] = modifiedCommand;
          }
        }
        
        
      } catch (error) {
        console.error('Error processing images for Claude:', error);
      }
    }
    
    // Add resume flag if resuming
    if (resume && sessionId) {
      args.push('--resume', sessionId);
    }
    
    // Add basic flags
    args.push('--output-format', 'stream-json', '--verbose');
    
    // Add MCP config flag only if MCP servers are configured
    try {
      console.log('🔍 Starting MCP config check...');
      // Use already imported modules (fs.promises is imported as fs, path, os)
      const fsSync = await import('fs'); // Import synchronous fs methods
      console.log('✅ Successfully imported fs sync methods');
      
      // Check for MCP config in ~/.claude.json
      const claudeConfigPath = path.join(os.homedir(), '.claude.json');
      
      console.log(`🔍 Checking for MCP configs in: ${claudeConfigPath}`);
      console.log(`  Claude config exists: ${fsSync.existsSync(claudeConfigPath)}`);
      
      let hasMcpServers = false;
      
      // Check Claude config for MCP servers
      if (fsSync.existsSync(claudeConfigPath)) {
        try {
          const claudeConfig = JSON.parse(fsSync.readFileSync(claudeConfigPath, 'utf8'));
          
          // Check global MCP servers
          if (claudeConfig.mcpServers && Object.keys(claudeConfig.mcpServers).length > 0) {
            console.log(`✅ Found ${Object.keys(claudeConfig.mcpServers).length} global MCP servers`);
            hasMcpServers = true;
          }
          
          // Check project-specific MCP servers
          if (!hasMcpServers && claudeConfig.claudeProjects) {
            const currentProjectPath = process.cwd();
            const projectConfig = claudeConfig.claudeProjects[currentProjectPath];
            if (projectConfig && projectConfig.mcpServers && Object.keys(projectConfig.mcpServers).length > 0) {
              console.log(`✅ Found ${Object.keys(projectConfig.mcpServers).length} project MCP servers`);
              hasMcpServers = true;
            }
          }
        } catch (e) {
          console.log(`❌ Failed to parse Claude config:`, e.message);
        }
      }
      
      console.log(`🔍 hasMcpServers result: ${hasMcpServers}`);
      
      if (hasMcpServers) {
        // Use Claude config file if it has MCP servers
        let configPath = null;
        
        if (fsSync.existsSync(claudeConfigPath)) {
          try {
            const claudeConfig = JSON.parse(fsSync.readFileSync(claudeConfigPath, 'utf8'));
            
            // Check if we have any MCP servers (global or project-specific)
            const hasGlobalServers = claudeConfig.mcpServers && Object.keys(claudeConfig.mcpServers).length > 0;
            const currentProjectPath = process.cwd();
            const projectConfig = claudeConfig.claudeProjects && claudeConfig.claudeProjects[currentProjectPath];
            const hasProjectServers = projectConfig && projectConfig.mcpServers && Object.keys(projectConfig.mcpServers).length > 0;
            
            if (hasGlobalServers || hasProjectServers) {
              configPath = claudeConfigPath;
            }
          } catch (e) {
            // No valid config found
          }
        }
        
        if (configPath) {
          console.log(`📡 Adding MCP config: ${configPath}`);
          args.push('--mcp-config', configPath);
        } else {
          console.log('⚠️ MCP servers detected but no valid config file found');
        }
      }
    } catch (error) {
      // If there's any error checking for MCP configs, don't add the flag
      console.log('❌ MCP config check failed:', error.message);
      console.log('📍 Error stack:', error.stack);
      console.log('Note: MCP config check failed, proceeding without MCP support');
    }
    
    // Add model for new sessions
    if (!resume) {
      args.push('--model', 'sonnet');
    }
    
    // Add permission mode if specified (works for both new and resumed sessions)
    if (permissionMode && permissionMode !== 'default') {
      args.push('--permission-mode', permissionMode);
      console.log('🔒 Using permission mode:', permissionMode);
    }
    
    // Add tools settings flags
    // Don't use --dangerously-skip-permissions when in plan mode
    if (settings.skipPermissions && permissionMode !== 'plan') {
      args.push('--dangerously-skip-permissions');
      console.log('⚠️  Using --dangerously-skip-permissions (skipping other tool settings)');
    } else {
      // Only add allowed/disallowed tools if not skipping permissions
      
      // Collect all allowed tools, including plan mode defaults
      let allowedTools = [...(settings.allowedTools || [])];
      
      // Add plan mode specific tools
      if (permissionMode === 'plan') {
        const planModeTools = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite'];
        // Add plan mode tools that aren't already in the allowed list
        for (const tool of planModeTools) {
          if (!allowedTools.includes(tool)) {
            allowedTools.push(tool);
          }
        }
        console.log('📝 Plan mode: Added default allowed tools:', planModeTools);
      }
      
      // Add allowed tools
      if (allowedTools.length > 0) {
        for (const tool of allowedTools) {
          args.push('--allowedTools', tool);
          console.log('✅ Allowing tool:', tool);
        }
      }
      
      // Add disallowed tools
      if (settings.disallowedTools && settings.disallowedTools.length > 0) {
        for (const tool of settings.disallowedTools) {
          args.push('--disallowedTools', tool);
          console.log('❌ Disallowing tool:', tool);
        }
      }
      
      // Log when skip permissions is disabled due to plan mode
      if (settings.skipPermissions && permissionMode === 'plan') {
        console.log('📝 Skip permissions disabled due to plan mode');
      }
    }

    // Add print flag with command if we have a command
    if (command && command.trim()) {

      // Separate arguments for better cross-platform compatibility
      // This prevents issues with spaces and quotes on Windows
      args.push('--print');
      // Use `--` so user input is always treated as text, not options
      args.push('--');
      args.push(command);
    }
    
    console.log('Spawning Claude CLI:', 'claude', args.map(arg => {
      const cleanArg = arg.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
      return cleanArg.includes(' ') ? `"${cleanArg}"` : cleanArg;
    }).join(' '));
    console.log('Working directory:', workingDir);
    console.log('Session info - Input sessionId:', sessionId, 'Resume:', resume);
    console.log('🔍 Full command args:', JSON.stringify(args, null, 2));
    console.log('🔍 Final Claude command will be: claude ' + args.join(' '));
    
    // Use Claude CLI from environment variable or default to 'claude'
    const claudePath = process.env.CLAUDE_CLI_PATH || 'claude';
    console.log('🔍 Using Claude CLI path:', claudePath);
    
    const claudeProcess = spawnFunction(claudePath, args, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env } // Inherit all environment variables
    });
    
    // Attach temp file info to process for cleanup later
    claudeProcess.tempImagePaths = tempImagePaths;
    claudeProcess.tempDir = tempDir;
    
    // Store process reference for potential abort
    const processKey = capturedSessionId || sessionId || Date.now().toString();
    activeClaudeProcesses.set(processKey, claudeProcess);
    
    // Handle stdout (streaming JSON responses)
    claudeProcess.stdout.on('data', (data) => {
      const rawOutput = data.toString();
      console.log('📤 Claude CLI stdout:', rawOutput);

      // Parse system warnings for token budget BEFORE JSON parsing
      const tokenData = parseSystemWarnings(rawOutput);
      if (tokenData && capturedSessionId) {
        console.log(`💰 Token budget update: ${tokenData.used}/${tokenData.total} (${tokenData.remaining} remaining)`);

        // Send token budget update to frontend with sessionId
        ws.send(JSON.stringify({
          type: 'token-budget-update',
          data: {
            ...tokenData,
            sessionId: capturedSessionId
          }
        }));

        // Check if auto-compact should trigger (respect user settings)
        const autoCompactEnabled = toolsSettings?.autoCompactEnabled !== false; // default true
        if (autoCompactEnabled && shouldTriggerAutoCompact(capturedSessionId, tokenData)) {
          triggerAutoCompact(capturedSessionId, tokenData, ws);
        }
      }

      const lines = rawOutput.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          console.log('📄 Parsed JSON response:', response);

          // Capture session ID if it's in the response
          if (response.session_id && !capturedSessionId) {
            capturedSessionId = response.session_id;
            console.log('📝 Captured session ID:', capturedSessionId);

            // Update process key with captured session ID
            if (processKey !== capturedSessionId) {
              activeClaudeProcesses.delete(processKey);
              activeClaudeProcesses.set(capturedSessionId, claudeProcess);
            }

            // Send session-created event only once for new sessions
            if (!sessionId && !sessionCreatedSent) {
              sessionCreatedSent = true;
              ws.send(JSON.stringify({
                type: 'session-created',
                sessionId: capturedSessionId
              }));
            }
          }

          // Send parsed response to WebSocket
          ws.send(JSON.stringify({
            type: 'claude-response',
            data: response
          }));
        } catch (parseError) {
          console.log('📄 Non-JSON response:', line);
          // If not JSON, send as raw text
          ws.send(JSON.stringify({
            type: 'claude-output',
            data: line
          }));
        }
      }
    });
    
    // Handle stderr
    claudeProcess.stderr.on('data', (data) => {
      console.error('Claude CLI stderr:', data.toString());
      ws.send(JSON.stringify({
        type: 'claude-error',
        error: data.toString()
      }));
    });
    
    // Handle process completion
    claudeProcess.on('close', async (code) => {
      console.log(`Claude CLI process exited with code ${code}`);
      
      // Clean up process reference
      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeClaudeProcesses.delete(finalSessionId);
      
      ws.send(JSON.stringify({
        type: 'claude-complete',
        exitCode: code,
        isNewSession: !sessionId && !!command // Flag to indicate this was a new session
      }));
      
      // Clean up temporary image files if any
      if (claudeProcess.tempImagePaths && claudeProcess.tempImagePaths.length > 0) {
        for (const imagePath of claudeProcess.tempImagePaths) {
          await fs.unlink(imagePath).catch(err => 
            console.error(`Failed to delete temp image ${imagePath}:`, err)
          );
        }
        if (claudeProcess.tempDir) {
          await fs.rm(claudeProcess.tempDir, { recursive: true, force: true }).catch(err => 
            console.error(`Failed to delete temp directory ${claudeProcess.tempDir}:`, err)
          );
        }
      }
      
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Claude CLI exited with code ${code}`));
      }
    });
    
    // Handle process errors
    claudeProcess.on('error', (error) => {
      console.error('Claude CLI process error:', error);
      
      // Clean up process reference on error
      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeClaudeProcesses.delete(finalSessionId);
      
      ws.send(JSON.stringify({
        type: 'claude-error',
        error: error.message
      }));
      
      reject(error);
    });
    
    // Handle stdin for interactive mode
    if (command) {
      // For --print mode with arguments, we don't need to write to stdin
      claudeProcess.stdin.end();
    } else {
      // For interactive mode, we need to write the command to stdin if provided later
      // Keep stdin open for interactive session
      if (command !== undefined) {
        claudeProcess.stdin.write(command + '\n');
        claudeProcess.stdin.end();
      }
      // If no command provided, stdin stays open for interactive use
    }
  });
}

function abortClaudeSession(sessionId) {
  const process = activeClaudeProcesses.get(sessionId);
  if (process) {
    console.log(`🛑 Aborting Claude session: ${sessionId}`);
    process.kill('SIGTERM');
    activeClaudeProcesses.delete(sessionId);
    return true;
  }
  return false;
}

export {
  spawnClaude,
  abortClaudeSession
};
