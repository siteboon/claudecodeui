/**
 * OpenAI Codex SDK Integration
 * =============================
 *
 * This module provides integration with the OpenAI Codex SDK for non-interactive
 * chat sessions. It mirrors the pattern used in claude-sdk.js for consistency.
 *
 * ## Usage
 *
 * - queryCodex(command, options, ws) - Execute a prompt with streaming via WebSocket
 * - abortCodexSession(sessionId) - Cancel an active session
 * - isCodexSessionActive(sessionId) - Check if a session is running
 * - getActiveCodexSessions() - List all active sessions
 */

import { Codex } from '@openai/codex-sdk';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { createNormalizedMessage } from './shared/utils.js';

// Track active sessions
const activeCodexSessions = new Map();

/**
 * Transform Codex SDK event to WebSocket message format
 * @param {object} event - SDK event
 * @returns {object} - Transformed event for WebSocket
 */
function transformCodexEvent(event) {
  // Map SDK event types to a consistent format
  switch (event.type) {
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      const item = event.item;
      if (!item) {
        return { type: event.type, item: null };
      }

      // Transform based on item type
      switch (item.type) {
        case 'agent_message':
          return {
            type: 'item',
            itemType: 'agent_message',
            message: {
              role: 'assistant',
              content: item.text
            }
          };

        case 'reasoning':
          return {
            type: 'item',
            itemType: 'reasoning',
            message: {
              role: 'assistant',
              content: item.text,
              isReasoning: true
            }
          };

        case 'command_execution':
          return {
            type: 'item',
            itemType: 'command_execution',
            command: item.command,
            output: item.aggregated_output,
            exitCode: item.exit_code,
            status: item.status
          };

        case 'file_change':
          return {
            type: 'item',
            itemType: 'file_change',
            changes: item.changes,
            status: item.status
          };

        case 'mcp_tool_call':
          return {
            type: 'item',
            itemType: 'mcp_tool_call',
            server: item.server,
            tool: item.tool,
            arguments: item.arguments,
            result: item.result,
            error: item.error,
            status: item.status
          };

        case 'web_search':
          return {
            type: 'item',
            itemType: 'web_search',
            query: item.query
          };

        case 'todo_list':
          return {
            type: 'item',
            itemType: 'todo_list',
            items: item.items
          };

        case 'error':
          return {
            type: 'item',
            itemType: 'error',
            message: {
              role: 'error',
              content: item.message
            }
          };

        default:
          return {
            type: 'item',
            itemType: item.type,
            item: item
          };
      }

    case 'turn.started':
      return {
        type: 'turn_started'
      };

    case 'turn.completed':
      return {
        type: 'turn_complete',
        usage: event.usage
      };

    case 'turn.failed':
      return {
        type: 'turn_failed',
        error: event.error
      };

    case 'thread.started':
      return {
        type: 'thread_started',
        threadId: event.thread_id || event.id
      };

    case 'error':
      return {
        type: 'error',
        message: event.message
      };

    default:
      return {
        type: event.type,
        data: event
      };
  }
}

/**
 * Map permission mode to Codex SDK options
 * @param {string} permissionMode - 'default', 'acceptEdits', or 'bypassPermissions'
 * @returns {object} - { sandboxMode, approvalPolicy }
 */
function mapPermissionModeToCodexOptions(permissionMode) {
  switch (permissionMode) {
    case 'acceptEdits':
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never'
      };
    case 'bypassPermissions':
      return {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never'
      };
    case 'default':
    default:
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'untrusted'
      };
  }
}

/**
 * Execute a Codex query with streaming
 * @param {string} command - The prompt to send
 * @param {object} options - Options including cwd, sessionId, model, permissionMode
 * @param {WebSocket|object} ws - WebSocket connection or response writer
 */
export async function queryCodex(command, options = {}, ws) {
  const {
    sessionId,
    sessionSummary,
    cwd,
    projectPath,
    model,
    permissionMode = 'default'
  } = options;

  const workingDirectory = cwd || projectPath || process.cwd();
  const { sandboxMode, approvalPolicy } = mapPermissionModeToCodexOptions(permissionMode);

  let codex;
  let thread;
  let currentSessionId = sessionId;
  let announcedSession = false;
  let activeSessionKey = null;
  const streamedItemText = new Map();
  let terminalFailure = null;
  const abortController = new AbortController();

  const moveActiveSession = (nextSessionId) => {
    if (!nextSessionId || nextSessionId === currentSessionId) {
      return;
    }

    const previousKey = activeSessionKey || currentSessionId;
    const existing = previousKey ? activeCodexSessions.get(previousKey) : null;
    currentSessionId = nextSessionId;

    if (existing) {
      activeCodexSessions.delete(previousKey);
      activeCodexSessions.set(nextSessionId, existing);
      activeSessionKey = nextSessionId;
    }
  };

  const announceSession = (nextSessionId = currentSessionId) => {
    if (announcedSession || !nextSessionId || String(nextSessionId).startsWith('codex-pending-')) {
      return;
    }

    currentSessionId = nextSessionId;
    announcedSession = true;
    sendMessage(ws, createNormalizedMessage({ kind: 'session_created', newSessionId: currentSessionId, sessionId: currentSessionId, provider: 'codex' }));
  };

  const sendSyntheticStream = async (text) => {
    if (!text) {
      return;
    }

    const chars = Array.from(text);
    const chunkSize = chars.length > 600 ? 8 : chars.length > 160 ? 4 : 1;
    const delayMs = chars.length > 600 ? 8 : chars.length > 160 ? 18 : 45;

    for (let i = 0; i < chars.length; i += chunkSize) {
      const chunk = chars.slice(i, i + chunkSize).join('');
      sendMessage(ws, createNormalizedMessage({ kind: 'stream_delta', role: 'assistant', content: chunk, sessionId: currentSessionId, provider: 'codex' }));

      if (i + chunkSize < chars.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  };

  try {
    // Initialize Codex SDK
    codex = new Codex();

    // Thread options with sandbox and approval settings
    const threadOptions = {
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode,
      approvalPolicy,
      model
    };

    // Start or resume thread
    if (sessionId) {
      thread = codex.resumeThread(sessionId, threadOptions);
    } else {
      thread = codex.startThread(threadOptions);
    }

    // The Codex SDK may not expose the real thread id synchronously.
    // Keep an internal key for abort tracking, but only announce a real
    // session id to the UI once thread.started provides one.
    currentSessionId = sessionId || thread.id || null;
    activeSessionKey = currentSessionId || `codex-pending-${Date.now()}`;

    // Track the session
    activeCodexSessions.set(activeSessionKey, {
      thread,
      codex,
      status: 'running',
      abortController,
      startedAt: new Date().toISOString()
    });

    if (currentSessionId) {
      announceSession(currentSessionId);
    }

    // Execute with streaming
    const streamedTurn = await thread.runStreamed(command, {
      signal: abortController.signal
    });

    for await (const event of streamedTurn.events) {
      // Check if session was aborted
      const session = activeCodexSessions.get(activeSessionKey || currentSessionId);
      if (!session || session.status === 'aborted') {
        break;
      }

      if (event.type === 'thread.started' && (event.thread_id || event.id)) {
        const realSessionId = event.thread_id || event.id;
        moveActiveSession(realSessionId);
        announceSession(realSessionId);
        continue;
      }

      if (event.type === 'item.started') {
        continue;
      }

      if (event.type === 'item.updated') {
        const item = event.item;
        if (item?.type === 'agent_message') {
          announceSession(currentSessionId || activeSessionKey);
          const itemKey = item.id || 'agent_message';
          const nextText = item.text || '';
          const previousText = streamedItemText.get(itemKey) || '';
          const delta = nextText.startsWith(previousText)
            ? nextText.slice(previousText.length)
            : nextText;

          streamedItemText.set(itemKey, nextText);

          if (delta) {
            await sendSyntheticStream(delta);
          }
        }
        continue;
      }

      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        const itemKey = event.item.id || 'agent_message';
        announceSession(currentSessionId || activeSessionKey);

        if (streamedItemText.has(itemKey)) {
          sendMessage(ws, createNormalizedMessage({ kind: 'stream_end', sessionId: currentSessionId, provider: 'codex' }));
          continue;
        }

        await sendSyntheticStream(event.item.text || '');
        sendMessage(ws, createNormalizedMessage({ kind: 'stream_end', sessionId: currentSessionId, provider: 'codex' }));
        continue;
      }

      announceSession(currentSessionId || activeSessionKey);
      const transformed = transformCodexEvent(event);

      // Normalize the transformed event into NormalizedMessage(s) via adapter
      const normalizedMsgs = sessionsService.normalizeMessage('codex', transformed, currentSessionId);
      for (const msg of normalizedMsgs) {
        sendMessage(ws, msg);
      }

      if (event.type === 'turn.failed' && !terminalFailure) {
        terminalFailure = event.error || new Error('Turn failed');
        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: currentSessionId,
          sessionName: sessionSummary,
          error: terminalFailure
        });
      }

      // Extract and send token usage if available (normalized to match Claude format)
      if (event.type === 'turn.completed' && event.usage) {
        const totalTokens = (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0);
        sendMessage(ws, createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget: { used: totalTokens, total: 200000 }, sessionId: currentSessionId, provider: 'codex' }));
      }
    }

    // Send completion event
    if (!terminalFailure) {
      announceSession(currentSessionId || thread.id || activeSessionKey);
      sendMessage(ws, createNormalizedMessage({ kind: 'complete', actualSessionId: thread.id || currentSessionId, sessionId: currentSessionId, provider: 'codex' }));
      notifyRunStopped({
        userId: ws?.userId || null,
        provider: 'codex',
        sessionId: currentSessionId,
        sessionName: sessionSummary,
        stopReason: 'completed'
      });
    }

  } catch (error) {
    const lookupSessionId = activeSessionKey || currentSessionId;
    const session = lookupSessionId ? activeCodexSessions.get(lookupSessionId) : null;
    const wasAborted =
      session?.status === 'aborted' ||
      error?.name === 'AbortError' ||
      String(error?.message || '').toLowerCase().includes('aborted');

    if (!wasAborted) {
      console.error('[Codex] Error:', error);

      // Check if Codex SDK is available for a clearer error message
      const installed = await providerAuthService.isProviderInstalled('codex');
      const errorContent = !installed
        ? 'Codex CLI is not configured. Please set up authentication first.'
        : error.message;

      sendMessage(ws, createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: currentSessionId, provider: 'codex' }));
      if (!terminalFailure) {
        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: currentSessionId,
          sessionName: sessionSummary,
          error
        });
      }
    }

  } finally {
    // Update session status
    const lookupSessionId = activeSessionKey || currentSessionId;
    if (lookupSessionId) {
      const session = activeCodexSessions.get(lookupSessionId);
      if (session) {
        session.status = session.status === 'aborted' ? 'aborted' : 'completed';
      }
    }
  }
}

/**
 * Abort an active Codex session
 * @param {string} sessionId - Session ID to abort
 * @returns {boolean} - Whether abort was successful
 */
export function abortCodexSession(sessionId) {
  const session = activeCodexSessions.get(sessionId);

  if (!session) {
    return false;
  }

  session.status = 'aborted';
  try {
    session.abortController?.abort();
  } catch (error) {
    console.warn(`[Codex] Failed to abort session ${sessionId}:`, error);
  }

  return true;
}

/**
 * Check if a session is active
 * @param {string} sessionId - Session ID to check
 * @returns {boolean} - Whether session is active
 */
export function isCodexSessionActive(sessionId) {
  const session = activeCodexSessions.get(sessionId);
  return session?.status === 'running';
}

/**
 * Get all active sessions
 * @returns {Array} - Array of active session info
 */
export function getActiveCodexSessions() {
  const sessions = [];

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status === 'running') {
      sessions.push({
        id,
        status: session.status,
        startedAt: session.startedAt
      });
    }
  }

  return sessions;
}

/**
 * Helper to send message via WebSocket or writer
 * @param {WebSocket|object} ws - WebSocket or response writer
 * @param {object} data - Data to send
 */
function sendMessage(ws, data) {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      // Writer handles stringification (SSEStreamWriter or WebSocketWriter)
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      // Raw WebSocket - stringify here
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[Codex] Error sending message:', error);
  }
}

// Clean up old completed sessions periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status !== 'running') {
      const startedAt = new Date(session.startedAt).getTime();
      if (now - startedAt > maxAge) {
        activeCodexSessions.delete(id);
      }
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes
