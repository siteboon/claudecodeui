/**
 * Kiro CLI Integration via Agent Client Protocol (ACP)
 *
 * Spawns `kiro-cli acp` as a long-lived process and communicates via JSON-RPC 2.0 over stdio.
 * ACP methods: initialize, session/new, session/load, session/prompt, session/cancel, session/set_model
 * Notifications arrive via session/notification with types: AgentMessageChunk, ToolCall, ToolCallUpdate, TurnEnd
 */

import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import os from 'os';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { createNormalizedMessage } from './providers/types.js';

const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

const activeSessions = new Map(); // sessionId -> { process, sessionId, writer, status }
let acpProcess = null;
let acpReady = false;
let rpcId = 0;
const pendingRequests = new Map(); // rpc id -> { resolve, reject, timeout }
let lineBuffer = '';

function nextId() { return ++rpcId; }

function sendRpc(method, params = {}) {
    return new Promise((resolve, reject) => {
        if (!acpProcess || !acpReady) {
            return reject(new Error('ACP process not ready'));
        }
        const id = nextId();
        const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
        const timeout = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error(`RPC timeout for ${method}`));
        }, 120000);
        pendingRequests.set(id, { resolve, reject, timeout });
        acpProcess.stdin.write(msg);
    });
}

function handleRpcLine(line) {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }

    // Response to a request
    if (msg.id != null && pendingRequests.has(msg.id)) {
        const { resolve, reject, timeout } = pendingRequests.get(msg.id);
        clearTimeout(timeout);
        pendingRequests.delete(msg.id);
        if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
            resolve(msg.result);
        }
        return;
    }

    // Notification (no id)
    if (msg.method) {
        handleNotification(msg.method, msg.params || {});
    }
}

function handleNotification(method, params) {
    const sessionId = params.sessionId;
    const session = sessionId ? findSessionByAcpId(sessionId) : null;
    const ws = session?.writer;
    const wsSessionId = session?.wsSessionId || sessionId;

    if (!ws) return;

    if (method === 'session/notification') {
        const update = params.update || params;
        const type = update.type || update.kind;

        if (type === 'AgentMessageChunk') {
            const content = update.text || update.content || '';
            if (content) {
                ws.send(createNormalizedMessage({ kind: 'stream_delta', content, sessionId: wsSessionId, provider: 'kiro' }));
            }
        } else if (type === 'ToolCall') {
            const toolName = update.name || update.toolName || 'unknown';
            const status = update.status || 'running';
            ws.send(createNormalizedMessage({ kind: 'tool_use', toolName, toolInput: update.parameters || update.input || {}, status, sessionId: wsSessionId, provider: 'kiro' }));
        } else if (type === 'ToolCallUpdate') {
            const content = update.text || update.content || '';
            if (content) {
                ws.send(createNormalizedMessage({ kind: 'stream_delta', content, sessionId: wsSessionId, provider: 'kiro' }));
            }
        } else if (type === 'TurnEnd') {
            ws.send(createNormalizedMessage({ kind: 'complete', exitCode: 0, isNewSession: session?.isNew || false, sessionId: wsSessionId, provider: 'kiro' }));
            notifyRunStopped({ userId: ws?.userId || null, provider: 'kiro', sessionId: wsSessionId, sessionName: session?.sessionSummary, stopReason: 'completed' });
            activeSessions.delete(wsSessionId);
        }
    }
}

function findSessionByAcpId(acpSessionId) {
    for (const [, session] of activeSessions) {
        if (session.acpSessionId === acpSessionId) return session;
    }
    return null;
}

async function ensureAcpProcess() {
    if (acpProcess && acpReady) return;

    const kiroPath = process.env.KIRO_PATH || 'kiro-cli';
    const args = ['acp'];
    if (process.env.KIRO_TRUST_ALL_TOOLS === 'true') {
        args.push('--trust-all-tools');
    }

    let cmd = kiroPath;
    let spawnArgs = args;
    if (os.platform() !== 'win32') {
        cmd = 'sh';
        spawnArgs = ['-c', 'exec "$0" "$@"', kiroPath, ...args];
    }

    console.log('Spawning ACP process:', kiroPath, args.join(' '));

    acpProcess = spawnFunction(cmd, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
    });

    lineBuffer = '';
    acpProcess.stdout.on('data', (data) => {
        lineBuffer += data.toString();
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop();
        for (const line of lines) {
            handleRpcLine(line);
        }
    });

    acpProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg && !msg.includes('DeprecationWarning')) {
            console.error('[kiro-acp stderr]', msg);
        }
    });

    acpProcess.on('close', (code) => {
        console.log('ACP process exited with code', code);
        acpProcess = null;
        acpReady = false;
        // Reject all pending requests
        for (const [id, { reject, timeout }] of pendingRequests) {
            clearTimeout(timeout);
            reject(new Error('ACP process exited'));
        }
        pendingRequests.clear();
        // Notify all active sessions
        for (const [wsSessionId, session] of activeSessions) {
            session.writer?.send(createNormalizedMessage({ kind: 'error', content: 'Kiro ACP process exited unexpectedly', sessionId: wsSessionId, provider: 'kiro' }));
        }
        activeSessions.clear();
    });

    acpProcess.on('error', (err) => {
        console.error('ACP process error:', err.message);
        acpProcess = null;
        acpReady = false;
    });

    // Initialize the ACP connection
    acpReady = true; // allow sendRpc to work
    try {
        const result = await sendRpc('initialize', {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
            clientInfo: { name: 'cloudcli', version: '1.0.0' }
        });
        console.log('ACP initialized:', result?.agentInfo?.name, result?.agentInfo?.version);
    } catch (err) {
        console.error('ACP initialize failed:', err.message);
        acpReady = false;
        if (acpProcess) { acpProcess.kill(); acpProcess = null; }
        throw err;
    }
}

async function spawnKiro(command, options = {}, ws) {
    const { sessionId, projectPath, cwd, sessionSummary } = options;

    try {
        await ensureAcpProcess();
    } catch (err) {
        ws.send(createNormalizedMessage({ kind: 'error', content: `Failed to start Kiro ACP: ${err.message}`, sessionId: sessionId || null, provider: 'kiro' }));
        notifyRunFailed({ userId: ws?.userId || null, provider: 'kiro', sessionId, sessionName: sessionSummary, error: err });
        throw err;
    }

    const workingDir = (cwd || projectPath || process.cwd()).replace(/[^\x20-\x7E]/g, '').trim();
    let acpSessionId;
    let wsSessionId = sessionId;
    let isNew = !sessionId;

    try {
        // Set model if specified
        if (options.model && options.model !== 'auto') {
            try { await sendRpc('session/set_model', { model: options.model }); } catch { /* ignore */ }
        }

        if (sessionId) {
            // Try to load existing session
            try {
                const loadResult = await sendRpc('session/load', { sessionId });
                acpSessionId = loadResult?.sessionId || sessionId;
            } catch {
                // Fall back to new session if load fails
                const newResult = await sendRpc('session/new', { cwd: workingDir, mcpServers: [] });
                acpSessionId = newResult?.sessionId;
                isNew = true;
            }
        } else {
            const newResult = await sendRpc('session/new', { cwd: workingDir, mcpServers: [] });
            acpSessionId = newResult?.sessionId;
            wsSessionId = acpSessionId || `kiro_${Date.now()}`;
        }

        // Register session
        activeSessions.set(wsSessionId, { acpSessionId, wsSessionId, writer: ws, isNew, sessionSummary, status: 'active' });

        // Notify frontend of session creation
        if (isNew) {
            if (typeof ws.setSessionId === 'function') ws.setSessionId(wsSessionId);
            ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: wsSessionId, sessionId: wsSessionId, provider: 'kiro' }));
        }

        // Send the prompt
        if (command && command.trim()) {
            await sendRpc('session/prompt', {
                sessionId: acpSessionId,
                content: [{ type: 'text', text: command }]
            });
            // TurnEnd notification will trigger completion
        }

    } catch (err) {
        activeSessions.delete(wsSessionId);
        ws.send(createNormalizedMessage({ kind: 'error', content: err.message, sessionId: wsSessionId, provider: 'kiro' }));
        notifyRunFailed({ userId: ws?.userId || null, provider: 'kiro', sessionId: wsSessionId, sessionName: sessionSummary, error: err });
        throw err;
    }
}

function abortKiroSession(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session) return false;

    try {
        sendRpc('session/cancel', { sessionId: session.acpSessionId }).catch(() => {});
        activeSessions.delete(sessionId);
        return true;
    } catch {
        return false;
    }
}

function isKiroSessionActive(sessionId) {
    return activeSessions.has(sessionId);
}

function getActiveKiroSessions() {
    return Array.from(activeSessions.keys());
}

export {
    spawnKiro,
    abortKiroSession,
    isKiroSessionActive,
    getActiveKiroSessions
};
