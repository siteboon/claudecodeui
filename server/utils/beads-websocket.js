/**
 * BEADS WEBSOCKET UTILITIES
 * =========================
 * 
 * Utilities for broadcasting Beads state changes via WebSocket.
 * Integrates with the existing WebSocket system to provide real-time updates.
 */

/**
 * Broadcast Beads project update to all connected clients
 * @param {WebSocket.Server} wss - WebSocket server instance
 * @param {string} projectName - Name of the updated project
 * @param {Object} beadsData - Updated Beads data
 */
export function broadcastBeadsProjectUpdate(wss, projectName, beadsData) {
    if (!wss || !projectName) {
        console.warn('Beads WebSocket broadcast: Missing wss or projectName');
        return;
    }

    const message = {
        type: 'beads-project-updated',
        projectName,
        beadsData,
        timestamp: new Date().toISOString()
    };

    
    wss.clients.forEach((client) => {
        if (client.readyState === 1) { // WebSocket.OPEN
            try {
                client.send(JSON.stringify(message));
            } catch (error) {
                console.error('Error sending Beads project update:', error);
            }
        }
    });
}

/**
 * Broadcast Beads issues update for a specific project
 * @param {WebSocket.Server} wss - WebSocket server instance  
 * @param {string} projectName - Name of the project with updated issues
 * @param {Object} issuesData - Updated issues data
 */
export function broadcastBeadsIssuesUpdate(wss, projectName, issuesData) {
    if (!wss || !projectName) {
        console.warn('Beads WebSocket broadcast: Missing wss or projectName');
        return;
    }

    const message = {
        type: 'beads-issues-updated',
        projectName,
        issuesData,
        timestamp: new Date().toISOString()
    };

    
    wss.clients.forEach((client) => {
        if (client.readyState === 1) { // WebSocket.OPEN
            try {
                client.send(JSON.stringify(message));
            } catch (error) {
                console.error('Error sending Beads issues update:', error);
            }
        }
    });
}

/**
 * Broadcast general Beads update notification
 * @param {WebSocket.Server} wss - WebSocket server instance
 * @param {string} updateType - Type of update (e.g., 'initialization', 'sync')
 * @param {Object} data - Additional data about the update
 */
export function broadcastBeadsUpdate(wss, updateType, data = {}) {
    if (!wss || !updateType) {
        console.warn('Beads WebSocket broadcast: Missing wss or updateType');
        return;
    }

    const message = {
        type: 'beads-update',
        updateType,
        data,
        timestamp: new Date().toISOString()
    };

    
    wss.clients.forEach((client) => {
        if (client.readyState === 1) { // WebSocket.OPEN
            try {
                client.send(JSON.stringify(message));
            } catch (error) {
                console.error('Error sending Beads update:', error);
            }
        }
    });
}
