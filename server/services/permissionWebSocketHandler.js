const EventEmitter = require('events');
const {
  WS_MESSAGE_TYPES,
  createPermissionRequestMessage,
  createPermissionTimeoutMessage,
  createPermissionQueueStatusMessage,
  createPermissionCancelledMessage,
  createPermissionErrorMessage,
  validatePermissionResponse
} = require('./permissionTypes');

class PermissionWebSocketHandler extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map();
    this.pendingAcks = new Map();
    this.messageQueue = new Map();
    this.sequenceNumber = 0;
    this.heartbeatInterval = null;
  }

  /**
   * Initialize the WebSocket handler with the server
   */
  initialize(wss) {
    this.wss = wss;
    this.startHeartbeat();
  }

  /**
   * Add a client connection
   */
  addClient(ws, clientId) {
    const clientInfo = {
      ws,
      id: clientId,
      isAlive: true,
      lastSeen: Date.now(),
      pendingRequests: new Set()
    };

    this.clients.set(clientId, clientInfo);

    ws.on('pong', () => {
      clientInfo.isAlive = true;
      clientInfo.lastSeen = Date.now();
    });

    ws.on('close', () => {
      this.removeClient(clientId);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for client ${clientId}:`, error);
      this.removeClient(clientId);
    });

    this.sendQueuedMessages(clientId);
    this.sendQueueStatus();
  }

  /**
   * Remove a client connection
   */
  removeClient(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      client.pendingRequests.forEach(requestId => {
        this.emit('client-disconnected', { clientId, requestId });
      });
      this.clients.delete(clientId);
    }
  }

  /**
   * Broadcast a permission request to all connected clients
   */
  broadcastPermissionRequest(request) {
    const message = createPermissionRequestMessage(request);
    message.sequenceNumber = ++this.sequenceNumber;

    const messageStr = JSON.stringify(message);

    this.clients.forEach((client, clientId) => {
      if (client.ws.readyState === client.ws.OPEN) {
        try {
          client.ws.send(messageStr);
          client.pendingRequests.add(request.id);
        } catch (error) {
          console.error(`Failed to send permission request to client ${clientId}:`, error);
          this.queueMessage(clientId, message);
        }
      } else {
        this.queueMessage(clientId, message);
      }
    });

    if (this.clients.size === 0) {
      console.warn('No clients connected to receive permission request');
      this.emit('no-clients', request);
    }
  }

  /**
   * Handle a permission response from a client
   */
  handlePermissionResponse(clientId, message) {
    try {
      validatePermissionResponse(message);

      const client = this.clients.get(clientId);
      if (client) {
        client.pendingRequests.delete(message.requestId);
      }

      this.emit('permission-response', {
        clientId,
        requestId: message.requestId,
        decision: message.decision,
        updatedInput: message.updatedInput
      });

      this.sendQueueStatus();
    } catch (error) {
      console.error('Invalid permission response:', error);
      this.sendError(clientId, message.requestId, error.message);
    }
  }

  /**
   * Broadcast a timeout notification
   */
  broadcastPermissionTimeout(requestId, toolName) {
    const message = createPermissionTimeoutMessage(requestId, toolName);
    this.broadcastToAll(message);

    this.clients.forEach(client => {
      client.pendingRequests.delete(requestId);
    });
  }

  /**
   * Broadcast a cancellation notification
   */
  broadcastPermissionCancelled(requestId, reason) {
    const message = createPermissionCancelledMessage(requestId, reason);
    this.broadcastToAll(message);

    this.clients.forEach(client => {
      client.pendingRequests.delete(requestId);
    });
  }

  /**
   * Send queue status update to all clients
   */
  sendQueueStatus() {
    const pending = Array.from(this.clients.values()).reduce(
      (sum, client) => sum + client.pendingRequests.size,
      0
    );

    const message = createPermissionQueueStatusMessage(pending, 0);
    this.broadcastToAll(message);
  }

  /**
   * Send an error message to a specific client
   */
  sendError(clientId, requestId, error) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === client.ws.OPEN) {
      const message = createPermissionErrorMessage(requestId, error);
      try {
        client.ws.send(JSON.stringify(message));
      } catch (err) {
        console.error(`Failed to send error to client ${clientId}:`, err);
      }
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcastToAll(message) {
    const messageStr = JSON.stringify(message);

    this.clients.forEach((client, clientId) => {
      if (client.ws.readyState === client.ws.OPEN) {
        try {
          client.ws.send(messageStr);
        } catch (error) {
          console.error(`Failed to send message to client ${clientId}:`, error);
          this.queueMessage(clientId, message);
        }
      } else {
        this.queueMessage(clientId, message);
      }
    });
  }

  /**
   * Queue a message for a client that's temporarily unavailable
   */
  queueMessage(clientId, message) {
    if (!this.messageQueue.has(clientId)) {
      this.messageQueue.set(clientId, []);
    }

    const queue = this.messageQueue.get(clientId);
    queue.push(message);

    if (queue.length > 100) {
      queue.shift();
    }
  }

  /**
   * Send queued messages to a reconnected client
   */
  sendQueuedMessages(clientId) {
    const queue = this.messageQueue.get(clientId);
    if (!queue || queue.length === 0) return;

    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== client.ws.OPEN) return;

    const sentMessages = [];
    for (const message of queue) {
      try {
        client.ws.send(JSON.stringify(message));
        sentMessages.push(message);
      } catch (error) {
        console.error(`Failed to send queued message to client ${clientId}:`, error);
        break;
      }
    }

    const remainingMessages = queue.filter(m => !sentMessages.includes(m));
    if (remainingMessages.length > 0) {
      this.messageQueue.set(clientId, remainingMessages);
    } else {
      this.messageQueue.delete(clientId);
    }
  }

  /**
   * Start heartbeat mechanism
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((client, clientId) => {
        if (!client.isAlive) {
          console.log(`Client ${clientId} failed heartbeat check`);
          this.removeClient(clientId);
          return;
        }

        client.isAlive = false;
        try {
          client.ws.ping();
        } catch (error) {
          console.error(`Failed to ping client ${clientId}:`, error);
          this.removeClient(clientId);
        }
      });
    }, 30000);
  }

  /**
   * Stop heartbeat mechanism
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Shutdown the handler gracefully
   */
  shutdown() {
    this.stopHeartbeat();

    this.clients.forEach((client, clientId) => {
      try {
        client.ws.close(1000, 'Server shutting down');
      } catch (error) {
        console.error(`Error closing client ${clientId}:`, error);
      }
    });

    this.clients.clear();
    this.messageQueue.clear();
    this.pendingAcks.clear();
  }

  /**
   * Get current handler statistics
   */
  getStats() {
    return {
      connectedClients: this.clients.size,
      queuedMessages: Array.from(this.messageQueue.values()).reduce((sum, queue) => sum + queue.length, 0),
      pendingRequests: Array.from(this.clients.values()).reduce((sum, client) => sum + client.pendingRequests.size, 0),
      sequenceNumber: this.sequenceNumber
    };
  }
}

module.exports = PermissionWebSocketHandler;