/**
 * TASKMASTER WEBSOCKET UTILITIES
 * ==============================
 * 
 * Utilities for broadcasting TaskMaster state changes via WebSocket.
 * Integrates with the existing WebSocket system to provide real-time updates.
 */

/**
 * Broadcast TaskMaster project update to all connected clients
 * @param {WebSocket.Server} wss - WebSocket server instance
 * @param {string} projectName - Name of the updated project
 * @param {Object} taskMasterData - Updated TaskMaster data
 */
export function broadcastTaskMasterProjectUpdate(wss, projectName, taskMasterData) {
    if (!wss || !projectName) {
        console.warn('TaskMaster WebSocket broadcast: Missing wss or projectName');
        return;
    }

    const message = {
        type: 'taskmaster-project-updated',
        projectName,
        taskMasterData,
        timestamp: new Date().toISOString()
    };

    
    wss.clients.forEach((client) => {
        if (client.readyState === 1) { // WebSocket.OPEN
            try {
                client.send(JSON.stringify(message));
            } catch (error) {
                console.error('Error sending TaskMaster project update:', error);
            }
        }
    });
}

/**
 * Broadcast TaskMaster tasks update for a specific project
 * @param {WebSocket.Server} wss - WebSocket server instance  
 * @param {string} projectName - Name of the project with updated tasks
 * @param {Object} tasksData - Updated tasks data
 */
export function broadcastTaskMasterTasksUpdate(wss, projectName, tasksData) {
    if (!wss || !projectName) {
        console.warn('TaskMaster WebSocket broadcast: Missing wss or projectName');
        return;
    }

    const message = {
        type: 'taskmaster-tasks-updated',
        projectName,
        tasksData,
        timestamp: new Date().toISOString()
    };

    
    wss.clients.forEach((client) => {
        if (client.readyState === 1) { // WebSocket.OPEN
            try {
                client.send(JSON.stringify(message));
            } catch (error) {
                console.error('Error sending TaskMaster tasks update:', error);
            }
        }
    });
}

/**
 * Broadcast MCP server status change
 * @param {WebSocket.Server} wss - WebSocket server instance
 * @param {Object} mcpStatus - Updated MCP server status
 */
export function broadcastMCPStatusChange(wss, mcpStatus) {
    if (!wss) {
        console.warn('TaskMaster WebSocket broadcast: Missing wss');
        return;
    }

    const message = {
        type: 'taskmaster-mcp-status-changed',
        mcpStatus,
        timestamp: new Date().toISOString()
    };

    
    wss.clients.forEach((client) => {
        if (client.readyState === 1) { // WebSocket.OPEN
            try {
                client.send(JSON.stringify(message));
            } catch (error) {
                console.error('Error sending TaskMaster MCP status update:', error);
            }
        }
    });
}

/**
 * Broadcast general TaskMaster update notification
 * @param {WebSocket.Server} wss - WebSocket server instance
 * @param {string} updateType - Type of update (e.g., 'initialization', 'configuration')
 * @param {Object} data - Additional data about the update
 */
export function broadcastTaskMasterUpdate(wss, updateType, data = {}) {
    if (!wss || !updateType) {
        console.warn('TaskMaster WebSocket broadcast: Missing wss or updateType');
        return;
    }

    const message = {
        type: 'taskmaster-update',
        updateType,
        data,
        timestamp: new Date().toISOString()
    };

    
    wss.clients.forEach((client) => {
        if (client.readyState === 1) { // WebSocket.OPEN
            try {
                client.send(JSON.stringify(message));
            } catch (error) {
                console.error('Error sending TaskMaster update:', error);
            }
        }
    });
}