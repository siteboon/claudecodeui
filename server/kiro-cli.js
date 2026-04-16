/**
 * Kiro CLI Integration via kiro-sdk
 *
 * Uses the kiro-sdk's query()/disconnect() API to communicate with `kiro-cli acp`.
 * The SDK manages the long-lived ACP process, JSON-RPC transport, and session routing internally.
 */

import { query, disconnect } from 'kiro-sdk';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { createNormalizedMessage } from './providers/types.js';

const activeSessions = new Map(); // wsSessionId -> { query, abortController, ... }

async function spawnKiro(command, options = {}, ws) {
    const { sessionId, projectPath, cwd, sessionSummary, model } = options;

    const workingDir = (cwd || projectPath || process.cwd()).replace(/[^\x20-\x7E]/g, '').trim();
    let wsSessionId = sessionId;
    let isNew = !sessionId;
    const abortController = new AbortController();

    try {
        const sdkOptions = {
            cwd: workingDir,
            model: model || undefined,
            trustAllTools: process.env.KIRO_TRUST_ALL_TOOLS === 'true' || undefined,
            abortController,
        };

        // Resume existing session if we have a sessionId
        if (sessionId) {
            sdkOptions.resume = sessionId;
        }

        let conversation = query({ prompt: command?.trim() || '', options: sdkOptions });

        const sessionEntry = {
            query: conversation,
            abortController,
            wsSessionId,
            acpSessionId: null,
            writer: ws,
            isNew,
            sessionSummary,
            status: 'active',
        };

        // Register session immediately so abort works
        activeSessions.set(wsSessionId || `kiro_pending_${Date.now()}`, sessionEntry);

        // Stream messages from the SDK async generator
        (async () => {
            try {
                let sessionAnnounced = !isNew; // existing sessions don't need announcement

                for await (const message of conversation) {
                    // If resuming a stale session produces an immediate empty error result,
                    // retry once as a fresh session so the user can continue seamlessly.
                    if (message.type === 'result' && message.is_error && !isNew && !message.text) {
                        console.log(`[KIRO] Stale session ${wsSessionId} - retrying as new session`);

                        const oldSessionId = wsSessionId;
                        activeSessions.delete(oldSessionId);

                        const retryOptions = { ...sdkOptions };
                        delete retryOptions.resume;

                        isNew = true;
                        sessionAnnounced = false;
                        conversation = query({ prompt: command?.trim() || '', options: retryOptions });
                        sessionEntry.query = conversation;
                        sessionEntry.isNew = true;
                        activeSessions.set(oldSessionId, sessionEntry);

                        for await (const retryMessage of conversation) {
                            if (!sessionAnnounced && conversation.sessionId) {
                                sessionEntry.acpSessionId = conversation.sessionId;
                                wsSessionId = conversation.sessionId;
                                sessionEntry.wsSessionId = wsSessionId;
                                activeSessions.delete(oldSessionId);
                                activeSessions.set(wsSessionId, sessionEntry);
                                if (typeof ws.setSessionId === 'function') ws.setSessionId(wsSessionId);
                                ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: wsSessionId, sessionId: wsSessionId, provider: 'kiro' }));
                                sessionAnnounced = true;
                            }

                            switch (retryMessage.type) {
                                case 'assistant':
                                    ws.send(createNormalizedMessage({ kind: 'stream_delta', content: retryMessage.content, sessionId: wsSessionId, provider: 'kiro' }));
                                    break;
                                case 'tool_use':
                                    ws.send(createNormalizedMessage({ kind: 'tool_use', toolName: retryMessage.name, toolInput: retryMessage.input, status: retryMessage.status, sessionId: wsSessionId, provider: 'kiro' }));
                                    break;
                                case 'tool_progress':
                                    ws.send(createNormalizedMessage({ kind: 'stream_delta', content: retryMessage.content, sessionId: wsSessionId, provider: 'kiro' }));
                                    break;
                                case 'result':
                                    ws.send(createNormalizedMessage({ kind: 'stream_end', sessionId: wsSessionId, provider: 'kiro' }));
                                    ws.send(createNormalizedMessage({ kind: 'complete', exitCode: retryMessage.is_error ? 1 : 0, isNewSession: true, sessionId: wsSessionId, provider: 'kiro' }));
                                    notifyRunStopped({ userId: ws?.userId || null, provider: 'kiro', sessionId: wsSessionId, sessionName: sessionSummary, stopReason: retryMessage.is_error ? 'error' : 'completed' });
                                    activeSessions.delete(wsSessionId);
                                    break;
                            }
                        }

                        if (activeSessions.has(wsSessionId)) {
                            ws.send(createNormalizedMessage({ kind: 'complete', exitCode: 0, isNewSession: true, sessionId: wsSessionId, provider: 'kiro' }));
                            notifyRunStopped({ userId: ws?.userId || null, provider: 'kiro', sessionId: wsSessionId, sessionName: sessionSummary, stopReason: 'completed' });
                            activeSessions.delete(wsSessionId);
                        }

                        return;
                    }

                    // For new sessions: announce BEFORE sending any content.
                    // This ensures the frontend navigates to the new session
                    // before stream_delta messages arrive.
                    if (!sessionAnnounced && conversation.sessionId) {
                        sessionEntry.acpSessionId = conversation.sessionId;
                        wsSessionId = conversation.sessionId;
                        sessionEntry.wsSessionId = wsSessionId;
                        // Re-register under the real ACP session ID
                        activeSessions.delete(sessionId);
                        activeSessions.set(wsSessionId, sessionEntry);
                        if (typeof ws.setSessionId === 'function') ws.setSessionId(wsSessionId);
                        ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: wsSessionId, sessionId: wsSessionId, provider: 'kiro' }));
                        sessionAnnounced = true;
                    }

                    switch (message.type) {
                        case 'assistant':
                            ws.send(createNormalizedMessage({ kind: 'stream_delta', content: message.content, sessionId: wsSessionId, provider: 'kiro' }));
                            break;
                        case 'tool_use':
                            ws.send(createNormalizedMessage({ kind: 'tool_use', toolName: message.name, toolInput: message.input, status: message.status, sessionId: wsSessionId, provider: 'kiro' }));
                            break;
                        case 'tool_progress':
                            ws.send(createNormalizedMessage({ kind: 'stream_delta', content: message.content, sessionId: wsSessionId, provider: 'kiro' }));
                            break;
                        case 'result':
                            ws.send(createNormalizedMessage({ kind: 'stream_end', sessionId: wsSessionId, provider: 'kiro' }));
                            ws.send(createNormalizedMessage({ kind: 'complete', exitCode: message.is_error ? 1 : 0, isNewSession: isNew, sessionId: wsSessionId, provider: 'kiro' }));
                            notifyRunStopped({ userId: ws?.userId || null, provider: 'kiro', sessionId: wsSessionId, sessionName: sessionSummary, stopReason: message.is_error ? 'error' : 'completed' });
                            activeSessions.delete(wsSessionId);
                            break;
                    }
                }

                // Generator finished without a result message — send complete
                if (activeSessions.has(wsSessionId)) {
                    ws.send(createNormalizedMessage({ kind: 'complete', exitCode: 0, isNewSession: isNew, sessionId: wsSessionId, provider: 'kiro' }));
                    notifyRunStopped({ userId: ws?.userId || null, provider: 'kiro', sessionId: wsSessionId, sessionName: sessionSummary, stopReason: 'completed' });
                    activeSessions.delete(wsSessionId);
                }
            } catch (err) {
                if (activeSessions.has(wsSessionId)) {
                    ws.send(createNormalizedMessage({ kind: 'error', content: err.message, sessionId: wsSessionId, provider: 'kiro' }));
                    notifyRunFailed({ userId: ws?.userId || null, provider: 'kiro', sessionId: wsSessionId, sessionName: sessionSummary, error: err });
                    activeSessions.delete(wsSessionId);
                }
            }
        })();

    } catch (err) {
        ws.send(createNormalizedMessage({ kind: 'error', content: `Failed to start Kiro: ${err.message}`, sessionId: wsSessionId || null, provider: 'kiro' }));
        notifyRunFailed({ userId: ws?.userId || null, provider: 'kiro', sessionId: wsSessionId, sessionName: sessionSummary, error: err });
        throw err;
    }
}

function abortKiroSession(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session) return false;

    try {
        session.query?.interrupt?.();
        session.abortController?.abort();
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

// Clean up on process exit
process.on('exit', () => disconnect());

export {
    spawnKiro,
    abortKiroSession,
    isKiroSessionActive,
    getActiveKiroSessions
};
