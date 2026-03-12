/**
 * HTTP Polling Fallback for Chat and Shell
 *
 * Provides transparent HTTP polling transport when WebSocket connections
 * are blocked by corporate proxies or firewalls.
 *
 * Chat endpoints:
 *   POST /api/poll/connect       — register a polling connection
 *   GET  /api/poll/messages      — drain queued chat messages
 *   POST /api/poll/send          — send a chat command
 *   POST /api/poll/disconnect    — cleanup
 *
 * Shell endpoints:
 *   POST /api/poll/shell/connect    — register + spawn PTY via handleShellConnection
 *   GET  /api/poll/shell/output     — drain queued PTY output
 *   POST /api/poll/shell/send       — forward init/input/resize to PTY
 *   POST /api/poll/shell/disconnect — cleanup
 */

import crypto from 'crypto';
import { EventEmitter } from 'events';
import { Router } from 'express';

// ──────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────

/** Generate a cryptographically random connection ID on the server side. */
function generateConnectionId(prefix = 'poll') {
  return `${prefix}-${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Verify the authenticated user owns the connection.
 * Returns the connection entry or sends an error response.
 */
function getOwnedConnection(map, connectionId, req, res) {
  const conn = map.get(connectionId);
  if (!conn) {
    res.status(410).json({ error: 'No active connection' });
    return null;
  }
  if (conn.ownerId !== req.user?.id) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return conn;
}

// ──────────────────────────────────────────────────────────────
//  Chat Polling
// ──────────────────────────────────────────────────────────────

const pollConnections = new Map(); // connectionId → { writer, ownerId, messages[], lastActivity }

class PollingWriter {
  constructor(connectionId) {
    this._connectionId = connectionId;
    this.sessionId = null;
    this.isWebSocketWriter = true; // compatibility with WebSocketWriter
  }

  send(data) {
    const conn = pollConnections.get(this._connectionId);
    if (conn) {
      conn.messages.push(data);
      conn.lastActivity = Date.now();
    }
  }

  /**
   * Retarget this writer to a new polling connection.
   * Called by reconnectSessionWriter() when the client reconnects.
   */
  updateWebSocket(newConnectionId) {
    if (typeof newConnectionId === 'string') {
      this._connectionId = newConnectionId;
    }
  }

  setSessionId(id) { this.sessionId = id; }
  getSessionId() { return this.sessionId; }
}

// ──────────────────────────────────────────────────────────────
//  Shell Polling
// ──────────────────────────────────────────────────────────────

const pollShellConnections = new Map(); // connectionId → { fakeWs, ownerId, outputQueue[], lastActivity }

/**
 * FakeShellWs — an EventEmitter that implements the subset of
 * the WebSocket interface that handleShellConnection relies on:
 *   .on('message', cb), .on('close', cb), .send(data), .readyState
 */
class FakeShellWs extends EventEmitter {
  constructor(connectionId) {
    super();
    this._connectionId = connectionId;
    this.readyState = 1; // WebSocket.OPEN
  }

  send(data) {
    const conn = pollShellConnections.get(this._connectionId);
    if (conn) {
      conn.outputQueue.push(data);
      conn.lastActivity = Date.now();
    }
  }

  close() {
    this.readyState = 3; // WebSocket.CLOSED
    this.emit('close');
  }
}

// ──────────────────────────────────────────────────────────────
//  Stale connection cleanup (runs every 60 s, 5-min idle timeout)
// ──────────────────────────────────────────────────────────────

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, conn] of pollConnections) {
    if (now - conn.lastActivity > IDLE_TIMEOUT_MS) {
      pollConnections.delete(id);
      console.log('[Poll] Cleaned up stale chat connection:', id);
    }
  }
  for (const [id, conn] of pollShellConnections) {
    if (now - conn.lastActivity > IDLE_TIMEOUT_MS) {
      conn.fakeWs.close();
      pollShellConnections.delete(id);
      console.log('[Poll] Cleaned up stale shell connection:', id);
    }
  }
}, 60_000);

// ──────────────────────────────────────────────────────────────
//  Build Express router
// ──────────────────────────────────────────────────────────────

/**
 * @param {object} deps  Injected dependencies
 * @param {Function} deps.authenticateToken  Express auth middleware
 * @param {Function} deps.queryClaudeSDK
 * @param {Function} deps.spawnCursor
 * @param {Function} deps.queryCodex
 * @param {Function} deps.spawnGemini
 * @param {Function} deps.abortClaudeSDKSession
 * @param {Function} deps.abortCursorSession
 * @param {Function} deps.abortCodexSession
 * @param {Function} deps.abortGeminiSession
 * @param {Function} deps.isClaudeSDKSessionActive
 * @param {Function} deps.isCursorSessionActive
 * @param {Function} deps.isCodexSessionActive
 * @param {Function} deps.isGeminiSessionActive
 * @param {Function} deps.getActiveClaudeSDKSessions
 * @param {Function} deps.getActiveCursorSessions
 * @param {Function} deps.getActiveCodexSessions
 * @param {Function} deps.getActiveGeminiSessions
 * @param {Function} deps.resolveToolApproval
 * @param {Function} deps.getPendingApprovalsForSession
 * @param {Function} deps.reconnectSessionWriter
 * @param {Function} deps.handleShellConnection
 */
export function createPollingRouter(deps) {
  const router = Router();
  const {
    authenticateToken,
    queryClaudeSDK,
    spawnCursor,
    queryCodex,
    spawnGemini,
    abortClaudeSDKSession,
    abortCursorSession,
    abortCodexSession,
    abortGeminiSession,
    isClaudeSDKSessionActive,
    isCursorSessionActive,
    isCodexSessionActive,
    isGeminiSessionActive,
    getActiveClaudeSDKSessions,
    getActiveCursorSessions,
    getActiveCodexSessions,
    getActiveGeminiSessions,
    resolveToolApproval,
    getPendingApprovalsForSession,
    reconnectSessionWriter,
    handleShellConnection,
  } = deps;

  // ── Chat: connect ────────────────────────────────────────
  router.post('/connect', authenticateToken, (req, res) => {
    const connectionId = generateConnectionId('poll');
    const writer = new PollingWriter(connectionId);
    pollConnections.set(connectionId, {
      writer,
      ownerId: req.user?.id,
      messages: [],
      lastActivity: Date.now(),
    });
    console.log('[Poll] Chat client connected:', connectionId);
    res.json({ ok: true, connectionId });
  });

  // ── Chat: poll messages ──────────────────────────────────
  router.get('/messages', authenticateToken, (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('ETag', `"${Date.now()}"`);

    const { connectionId } = req.query;
    const conn = getOwnedConnection(pollConnections, connectionId, req, res);
    if (!conn) return;

    conn.lastActivity = Date.now();
    const msgs = conn.messages.splice(0);
    res.json(msgs);
  });

  // ── Chat: send command ───────────────────────────────────
  router.post('/send', authenticateToken, async (req, res) => {
    const { connectionId, ...data } = req.body;
    const conn = getOwnedConnection(pollConnections, connectionId, req, res);
    if (!conn) return;

    conn.lastActivity = Date.now();
    const { writer } = conn;

    // Acknowledge immediately so the client is not blocked
    res.json({ ok: true });

    try {
      if (data.type === 'claude-command') {
        await queryClaudeSDK(data.command, data.options, writer);
      } else if (data.type === 'cursor-command') {
        await spawnCursor(data.command, data.options, writer);
      } else if (data.type === 'codex-command') {
        await queryCodex(data.command, data.options, writer);
      } else if (data.type === 'gemini-command') {
        await spawnGemini(data.command, data.options, writer);
      } else if (data.type === 'abort-session') {
        const provider = data.provider || 'claude';
        let success;
        if (provider === 'cursor') success = abortCursorSession(data.sessionId);
        else if (provider === 'codex') success = abortCodexSession(data.sessionId);
        else if (provider === 'gemini') success = abortGeminiSession(data.sessionId);
        else success = await abortClaudeSDKSession(data.sessionId);
        writer.send({ type: 'session-aborted', sessionId: data.sessionId, provider, success });
      } else if (data.type === 'claude-permission-response') {
        if (data.requestId) {
          resolveToolApproval(data.requestId, {
            allow: Boolean(data.allow),
            updatedInput: data.updatedInput,
            message: data.message,
            rememberEntry: data.rememberEntry,
          });
        }
      } else if (data.type === 'check-session-status') {
        const provider = data.provider || 'claude';
        const { sessionId } = data;
        let isActive;
        if (provider === 'cursor') isActive = isCursorSessionActive(sessionId);
        else if (provider === 'codex') isActive = isCodexSessionActive(sessionId);
        else if (provider === 'gemini') isActive = isGeminiSessionActive(sessionId);
        else isActive = isClaudeSDKSessionActive(sessionId);
        // Rebind in-flight session to this polling connection (mirrors WebSocket reconnect)
        if (isActive && reconnectSessionWriter) {
          reconnectSessionWriter(sessionId, connectionId);
        }
        writer.send({ type: 'session-status', sessionId, provider, isProcessing: isActive });
      } else if (data.type === 'get-pending-permissions') {
        const { sessionId } = data;
        if (sessionId && isClaudeSDKSessionActive(sessionId)) {
          const pending = getPendingApprovalsForSession(sessionId);
          writer.send({ type: 'pending-permissions-response', sessionId, data: pending });
        }
      } else if (data.type === 'get-active-sessions') {
        const activeSessions = {
          claude: getActiveClaudeSDKSessions(),
          cursor: getActiveCursorSessions(),
          codex: getActiveCodexSessions(),
          gemini: getActiveGeminiSessions(),
        };
        writer.send({ type: 'active-sessions', sessions: activeSessions });
      }
    } catch (error) {
      console.error('[Poll] Chat send error:', error.message);
      writer.send({ type: 'error', error: error.message });
    }
  });

  // ── Chat: disconnect ─────────────────────────────────────
  router.post('/disconnect', authenticateToken, (req, res) => {
    const { connectionId } = req.body;
    const conn = getOwnedConnection(pollConnections, connectionId, req, res);
    if (!conn) return;

    pollConnections.delete(connectionId);
    console.log('[Poll] Chat client disconnected:', connectionId);
    res.json({ ok: true });
  });

  // ── Shell: connect ───────────────────────────────────────
  router.post('/shell/connect', authenticateToken, (req, res) => {
    const connectionId = generateConnectionId('shell-poll');
    const fakeWs = new FakeShellWs(connectionId);
    pollShellConnections.set(connectionId, {
      fakeWs,
      ownerId: req.user?.id,
      outputQueue: [],
      lastActivity: Date.now(),
    });
    handleShellConnection(fakeWs);
    console.log('[Poll] Shell client connected:', connectionId);
    res.json({ ok: true, connectionId });
  });

  // ── Shell: poll output ───────────────────────────────────
  router.get('/shell/output', authenticateToken, (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('ETag', `"${Date.now()}"`);

    const { connectionId } = req.query;
    const conn = getOwnedConnection(pollShellConnections, connectionId, req, res);
    if (!conn) return;

    conn.lastActivity = Date.now();
    const msgs = conn.outputQueue.splice(0);
    res.json(msgs);
  });

  // ── Shell: send input ────────────────────────────────────
  router.post('/shell/send', authenticateToken, (req, res) => {
    const { connectionId, ...data } = req.body;
    const conn = getOwnedConnection(pollShellConnections, connectionId, req, res);
    if (!conn) return;

    conn.lastActivity = Date.now();
    conn.fakeWs.emit('message', JSON.stringify(data));
    res.json({ ok: true });
  });

  // ── Shell: disconnect ────────────────────────────────────
  router.post('/shell/disconnect', authenticateToken, (req, res) => {
    const { connectionId } = req.body;
    const conn = getOwnedConnection(pollShellConnections, connectionId, req, res);
    if (!conn) return;

    conn.fakeWs.close();
    pollShellConnections.delete(connectionId);
    console.log('[Poll] Shell client disconnected:', connectionId);
    res.json({ ok: true });
  });

  return router;
}
