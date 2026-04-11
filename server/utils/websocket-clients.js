import WebSocket from 'ws';

// Shared set of connected WebSocket clients, used by both the main server
// (index.js) and the agent API routes to broadcast real-time updates.
export const connectedClients = new Set();

// Broadcast loading/progress updates to all connected clients.
export function broadcastProgress(progress) {
    const message = JSON.stringify({
        type: 'loading_progress',
        ...progress
    });
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Broadcast a lightweight session-name-updated event to all connected clients.
// Unlike the old broadcastProjectsUpdated(), this does NOT re-scan projects —
// the frontend patches its local state directly.
export function broadcastSessionNameUpdated(sessionId, provider, name) {
    const msg = JSON.stringify({
        type: 'session_name_updated',
        sessionId, provider, name,
        timestamp: new Date().toISOString()
    });
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
}
