/**
 * Claude CLI Query Runner (Full REPL Mode v2)
 *
 * Spawns the native `claude` CLI with `--output-format stream-json`
 * and maps the streaming JSON events to the same WebSocket message
 * format the Chat UI already expects.
 *
 * This replaces the SDK-based queryClaudeSDK() when Full REPL Mode is active.
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const activeCliSessions = new Map();

/**
 * Spawns the native claude CLI and streams structured JSON events to the WebSocket.
 */
export async function queryClaudeCLI(command, options = {}, ws) {
  const { sessionId, cwd, model, permissionMode, images, sessionSummary } = options;

  const args = ['--output-format', 'stream-json', '--verbose'];

  // Resume existing session
  if (sessionId) {
    args.push('--resume', sessionId);
  }

  // Model selection
  if (model) {
    args.push('--model', model);
  }

  // Permission mode
  if (permissionMode === 'plan') {
    args.push('--permission-mode', 'plan');
  } else if (permissionMode && permissionMode !== 'default') {
    args.push('--permission-mode', permissionMode);
  }

  // Handle images: save to temp files and prepend to prompt
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
    // Prepend image paths to the prompt
    if (tempImagePaths.length > 0) {
      const imageRefs = tempImagePaths.map(p => `[Image: ${p}]`).join(' ');
      finalCommand = `${imageRefs}\n\n${command}`;
    }
  }

  // Non-interactive mode: send prompt via --print
  args.push('--print', finalCommand);

  const resolvedCwd = cwd || process.env.HOME;

  console.log(`[Full REPL v2] Spawning: claude ${args.slice(0, 4).join(' ')}... (cwd: ${resolvedCwd})`);

  const cliProcess = spawn('claude', args, {
    cwd: resolvedCwd,
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let capturedSessionId = sessionId || null;
  let partialLine = '';

  const session = {
    process: cliProcess,
    startTime: Date.now(),
    sessionId: capturedSessionId,
  };

  // Track session
  const sessionKey = sessionId || `pending_${Date.now()}`;
  activeCliSessions.set(sessionKey, session);

  // Parse stdout JSONL
  cliProcess.stdout.on('data', (chunk) => {
    partialLine += chunk.toString();
    const lines = partialLine.split('\n');
    partialLine = lines.pop(); // Keep incomplete line for next chunk

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed);
        const wsMessages = mapCliEventToWsMessages(event, session);
        for (const msg of wsMessages) {
          ws.send(msg);
        }

        // Capture session ID from init event
        if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
          capturedSessionId = event.session_id;
          session.sessionId = capturedSessionId;

          // Re-key the session map
          if (sessionKey !== capturedSessionId) {
            activeCliSessions.delete(sessionKey);
            activeCliSessions.set(capturedSessionId, session);
          }
        }
      } catch {
        // Not valid JSON, skip (startup noise, etc.)
      }
    }
  });

  // Forward stderr as status messages
  cliProcess.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      console.log(`[Full REPL v2 stderr] ${text}`);
    }
  });

  cliProcess.on('error', (err) => {
    console.error('[Full REPL v2] Failed to spawn claude CLI:', err.message);
    ws.send({
      type: 'claude-error',
      error: `Failed to spawn claude CLI: ${err.message}. Is claude installed and in PATH?`,
      sessionId: capturedSessionId,
    });
    activeCliSessions.delete(capturedSessionId || sessionKey);
  });

  cliProcess.on('close', (exitCode) => {
    console.log(`[Full REPL v2] CLI process exited with code ${exitCode}`);

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
 * Maps a CLI stream-json event to one or more WebSocket messages
 * in the format the Chat UI expects.
 */
function mapCliEventToWsMessages(event, session) {
  const sid = session.sessionId;
  const messages = [];

  switch (event.type) {
    case 'system': {
      if (event.subtype === 'init') {
        // Emit session-created
        messages.push({
          type: 'session-created',
          sessionId: event.session_id,
        });
      }
      break;
    }

    case 'assistant': {
      // The CLI emits the full assistant message with content array.
      // The Chat UI expects: { type: 'claude-response', data: { message: {...}, ... }, sessionId }
      // where data.message has { role, content: [...] }
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
      // Tool results come as user messages with role: 'user' and content array
      // containing tool_result blocks. The Chat UI handles this via:
      // structuredMessageData?.role === 'user' && Array.isArray(structuredMessageData.content)
      const msg = event.message;
      if (msg) {
        messages.push({
          type: 'claude-response',
          data: {
            message: msg,
            parent_tool_use_id: event.parent_tool_use_id || null,
            // Include tool_use_result for richer rendering
            tool_use_result: event.tool_use_result || null,
          },
          sessionId: sid,
        });
      }
      break;
    }

    case 'result': {
      // Final result with usage/cost info
      // Emit token budget from the result
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

    case 'rate_limit_event': {
      // Could emit as status, but not critical for rendering
      break;
    }

    default: {
      // Forward any unknown event types as generic claude-response
      // so the UI can at least try to render them
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
 * Aborts an active CLI session by killing the process.
 */
export function abortClaudeCLISession(sessionId) {
  const session = activeCliSessions.get(sessionId);
  if (session?.process) {
    session.process.kill('SIGINT');
    activeCliSessions.delete(sessionId);
    return true;
  }
  return false;
}

/**
 * Checks if a CLI session is currently active.
 */
export function isClaudeCLISessionActive(sessionId) {
  return activeCliSessions.has(sessionId);
}

/**
 * Returns all active CLI sessions.
 */
export function getActiveClaudeCLISessions() {
  return Array.from(activeCliSessions.keys());
}

export { activeCliSessions };
