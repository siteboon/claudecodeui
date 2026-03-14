/**
 * Claude CLI Query Runner (Full REPL Mode v2)
 *
 * Spawns the native `claude` CLI with `--output-format stream-json`
 * via node-pty (pseudo-terminal) and maps the streaming JSON events
 * to the same WebSocket message format the Chat UI already expects.
 *
 * The claude binary requires a TTY to produce output, so we must use
 * node-pty instead of child_process.spawn.
 */

import pty from 'node-pty';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const activeCliSessions = new Map();

/**
 * Maps projectPath → last CLI session UUID.
 * Used for bidirectional session sync between Chat and Shell tabs.
 */
const projectSessionRegistry = new Map();

export function getProjectSessionId(projectPath) {
  return projectSessionRegistry.get(projectPath) || null;
}

export function setProjectSessionId(projectPath, sessionId) {
  if (projectPath && sessionId) {
    projectSessionRegistry.set(projectPath, sessionId);
    console.log(`[Full REPL v2] Registry: ${projectPath} → ${sessionId}`);
  }
}

/**
 * Scans ~/.claude/projects/ for the most recently modified session file
 * for a given project path. Returns the session UUID or null.
 */
export async function findLatestSessionForProject(projectPath) {
  try {
    // Claude encodes project paths by replacing / with -
    const encoded = projectPath.replace(/\//g, '-');
    const projectDir = path.join(os.homedir(), '.claude', 'projects', encoded);

    const entries = await fs.readdir(projectDir);
    const jsonlFiles = entries.filter(e => e.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) return null;

    // Find the most recently modified
    let latest = null;
    let latestMtime = 0;

    for (const file of jsonlFiles) {
      const filePath = path.join(projectDir, file);
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latest = file.replace('.jsonl', '');
      }
    }

    return latest;
  } catch {
    return null;
  }
}

let cachedClaudeBin = null;

/**
 * Finds the actual claude binary path, skipping shell functions/aliases.
 */
async function resolveClaudeBinary() {
  if (cachedClaudeBin) return cachedClaudeBin;

  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      cachedClaudeBin = candidate;
      console.log(`[Full REPL v2] Resolved claude binary: ${cachedClaudeBin}`);
      return cachedClaudeBin;
    } catch {
      // Not found, try next
    }
  }

  console.log('[Full REPL v2] Could not resolve claude binary, falling back to PATH');
  cachedClaudeBin = 'claude';
  return cachedClaudeBin;
}

/**
 * Spawns the native claude CLI and streams structured JSON events to the WebSocket.
 */
export async function queryClaudeCLI(command, options = {}, ws) {
  const { sessionId, cwd, model, permissionMode, images } = options;

  const args = ['--output-format', 'stream-json', '--verbose'];

  // Resume: explicit session ID > registry > none
  const isValidUUID = sessionId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);
  const resolvedCwd = cwd || process.env.HOME;
  let resumeId = isValidUUID ? sessionId : null;

  if (!resumeId) {
    // Check registry for a session created by Shell or a previous Chat query
    const registryId = getProjectSessionId(resolvedCwd);
    if (registryId) {
      resumeId = registryId;
      console.log(`[Full REPL v2] Chat resuming session from registry: ${resumeId}`);
    }
  }

  if (resumeId) {
    args.push('--resume', resumeId);
  }

  if (model) {
    args.push('--model', model);
  }

  if (permissionMode === 'plan') {
    args.push('--permission-mode', 'plan');
  } else if (permissionMode && permissionMode !== 'default') {
    args.push('--permission-mode', permissionMode);
  }

  // Handle images
  let finalCommand = command;
  let tempImagePaths = [];
  let tempDir = null;

  if (images && images.length > 0) {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-img-'));
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (img.data && img.mediaType) {
        const ext = img.mediaType.split('/')[1] || 'png';
        const imgPath = path.join(tempDir, `image_${i}.${ext}`);
        const buffer = Buffer.from(img.data, 'base64');
        await fs.writeFile(imgPath, buffer);
        tempImagePaths.push(imgPath);
      }
    }
    if (tempImagePaths.length > 0) {
      const imageRefs = tempImagePaths.map(p => `[Image: ${p}]`).join(' ');
      finalCommand = `${imageRefs}\n\n${command}`;
    }
  }

  args.push('--print', finalCommand);

  // Build the full command string for bash -c.
  // The claude binary is a Bun executable that requires a proper shell
  // environment (same way the Shell tab spawns it).
  const escapedArgs = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
  const shellCommand = `claude ${escapedArgs}`;

  console.log(`[Full REPL v2] Spawning via bash: claude ${args.slice(0, 6).join(' ')}...`);
  console.log(`[Full REPL v2] cwd: ${resolvedCwd}`);

  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
  const shellArgs = os.platform() === 'win32' ? ['-Command', shellCommand] : ['-c', shellCommand];

  const cliProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd: resolvedCwd,
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
  });

  let capturedSessionId = sessionId || null;
  let partialLine = '';
  let sessionCreatedSent = false;
  let bufferedMessages = [];

  const session = {
    process: cliProcess,
    startTime: Date.now(),
    sessionId: capturedSessionId,
  };

  const sessionKey = sessionId || `pending_${Date.now()}`;
  activeCliSessions.set(sessionKey, session);

  console.log(`[Full REPL v2] Process PID: ${cliProcess.pid}`);

  // Parse PTY output as JSONL
  cliProcess.onData((rawData) => {
    partialLine += rawData;
    const lines = partialLine.split('\n');
    partialLine = lines.pop(); // Keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Strip any ANSI escape sequences that might leak through
      const cleaned = trimmed.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
      if (!cleaned || cleaned[0] !== '{') continue;

      try {
        const event = JSON.parse(cleaned);
        console.log(`[Full REPL v2] Event: ${event.type}/${event.subtype || ''}`);
        // Capture session ID from init event BEFORE mapping messages
        if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
          capturedSessionId = event.session_id;
          session.sessionId = capturedSessionId;

          // Store in registry for Shell tab to pick up
          setProjectSessionId(resolvedCwd, capturedSessionId);

          if (sessionKey !== capturedSessionId) {
            activeCliSessions.delete(sessionKey);
            activeCliSessions.set(capturedSessionId, session);
          }
        }

        const wsMessages = mapCliEventToWsMessages(event, session);
        for (const msg of wsMessages) {
          if (msg.type === 'session-created') {
            // Send session-created immediately, then flush buffered messages
            // after a short delay so the UI has time to update activeViewSessionId
            console.log(`[Full REPL v2] Sending WS: ${JSON.stringify(msg)}`);
            ws.send(msg);
            sessionCreatedSent = true;

            // Flush any buffered messages after a tick
            setTimeout(() => {
              for (const buffered of bufferedMessages) {
                console.log(`[Full REPL v2] Flushing buffered WS: ${JSON.stringify(buffered).substring(0, 200)}`);
                ws.send(buffered);
              }
              bufferedMessages = [];
            }, 100);
          } else if (!sessionCreatedSent) {
            // Buffer messages until session-created has been sent
            bufferedMessages.push(msg);
          } else {
            console.log(`[Full REPL v2] Sending WS: ${JSON.stringify(msg).substring(0, 200)}`);
            ws.send(msg);
          }
        }
      } catch {
        // Not valid JSON, skip
      }
    }
  });

  cliProcess.onExit(({ exitCode }) => {
    console.log(`[Full REPL v2] CLI process exited with code ${exitCode}`);

    // Process any remaining partial line
    if (partialLine.trim()) {
      const cleaned = partialLine.trim().replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
      if (cleaned && cleaned[0] === '{') {
        try {
          const event = JSON.parse(cleaned);
          const wsMessages = mapCliEventToWsMessages(event, session);
          for (const msg of wsMessages) {
            ws.send(msg);
          }
        } catch {
          // ignore
        }
      }
    }

    ws.send({
      type: 'claude-complete',
      sessionId: capturedSessionId,
      exitCode: exitCode || 0,
      isNewSession: !sessionId,
    });

    activeCliSessions.delete(capturedSessionId || sessionKey);

    // Clean up temp images
    if (tempImagePaths.length > 0) {
      for (const p of tempImagePaths) {
        fs.unlink(p).catch(() => {});
      }
      if (tempDir) {
        fs.rmdir(tempDir).catch(() => {});
      }
    }
  });
}

/**
 * Maps a CLI stream-json event to WebSocket messages the Chat UI expects.
 */
function mapCliEventToWsMessages(event, session) {
  const sid = session.sessionId;
  const messages = [];

  switch (event.type) {
    case 'system': {
      if (event.subtype === 'init') {
        messages.push({
          type: 'session-created',
          sessionId: event.session_id,
        });
      }
      break;
    }

    case 'assistant': {
      const msg = event.message;
      if (msg) {
        messages.push({
          type: 'claude-response',
          data: {
            message: msg,
            parent_tool_use_id: event.parent_tool_use_id || null,
          },
          sessionId: sid,
        });
      }
      break;
    }

    case 'user': {
      const msg = event.message;
      if (msg) {
        messages.push({
          type: 'claude-response',
          data: {
            message: msg,
            parent_tool_use_id: event.parent_tool_use_id || null,
            tool_use_result: event.tool_use_result || null,
          },
          sessionId: sid,
        });
      }
      break;
    }

    case 'result': {
      if (event.modelUsage) {
        const models = Object.keys(event.modelUsage);
        if (models.length > 0) {
          const usage = event.modelUsage[models[0]];
          messages.push({
            type: 'token-budget',
            data: {
              used: (usage.inputTokens || 0) + (usage.outputTokens || 0) +
                    (usage.cacheReadInputTokens || 0) + (usage.cacheCreationInputTokens || 0),
              total: usage.contextWindow || 200000,
            },
            sessionId: sid,
          });
        }
      }
      break;
    }

    case 'rate_limit_event':
      break;

    default: {
      if (event.message) {
        messages.push({
          type: 'claude-response',
          data: { message: event.message },
          sessionId: sid,
        });
      }
      break;
    }
  }

  return messages;
}

/**
 * Aborts an active CLI session.
 */
export function abortClaudeCLISession(sessionId) {
  const session = activeCliSessions.get(sessionId);
  if (session?.process) {
    session.process.write('\x03'); // Ctrl+C
    setTimeout(() => {
      try { session.process.kill(); } catch { /* already dead */ }
    }, 1000);
    activeCliSessions.delete(sessionId);
    return true;
  }
  return false;
}

export function isClaudeCLISessionActive(sessionId) {
  return activeCliSessions.has(sessionId);
}

export function getActiveClaudeCLISessions() {
  return Array.from(activeCliSessions.keys());
}

export { activeCliSessions };
