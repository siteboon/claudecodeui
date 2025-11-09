/**
 * Permission WebSocket Client
 *
 * Handles permission-related WebSocket messages and provides utilities
 * for managing permission requests and responses in the frontend.
 */

export const WS_MESSAGE_TYPES = {
  PERMISSION_REQUEST: 'permission-request',
  PERMISSION_RESPONSE: 'permission-response',
  PERMISSION_TIMEOUT: 'permission-timeout',
  PERMISSION_QUEUE_STATUS: 'permission-queue-status',
  PERMISSION_CANCELLED: 'permission-cancelled',
  PERMISSION_ERROR: 'permission-error'
};

export const PERMISSION_DECISIONS = {
  ALLOW: 'allow',
  DENY: 'deny',
  ALLOW_SESSION: 'allow-session',
  ALLOW_ALWAYS: 'allow-always'
};

class PermissionWebSocketClient {
  constructor() {
    this.pendingRequests = new Map();
    this.messageHandlers = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.ws = null;
    this.connectionState = 'disconnected';
    this.messageQueue = [];
    this.onStateChange = null;
    this.onRequestReceived = null;
    this.onRequestTimeout = null;
    this.onQueueStatusUpdate = null;
    this.onError = null;
  }

  /**
   * Set up event handlers
   */
  setHandlers(handlers) {
    if (handlers.onStateChange) this.onStateChange = handlers.onStateChange;
    if (handlers.onRequestReceived) this.onRequestReceived = handlers.onRequestReceived;
    if (handlers.onRequestTimeout) this.onRequestTimeout = handlers.onRequestTimeout;
    if (handlers.onQueueStatusUpdate) this.onQueueStatusUpdate = handlers.onQueueStatusUpdate;
    if (handlers.onError) this.onError = handlers.onError;
  }

  /**
   * Initialize the WebSocket connection
   */
  initialize(ws) {
    this.ws = ws;
    this.connectionState = 'connected';
    this.reconnectAttempts = 0;

    // Process any queued messages
    this.processMessageQueue();

    if (this.onStateChange) {
      this.onStateChange('connected');
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  handleMessage(message) {
    try {
      const data = typeof message === 'string' ? JSON.parse(message) : message;

      switch (data.type) {
        case WS_MESSAGE_TYPES.PERMISSION_REQUEST:
          this.handlePermissionRequest(data);
          break;

        case WS_MESSAGE_TYPES.PERMISSION_TIMEOUT:
          this.handlePermissionTimeout(data);
          break;

        case WS_MESSAGE_TYPES.PERMISSION_QUEUE_STATUS:
          this.handleQueueStatus(data);
          break;

        case WS_MESSAGE_TYPES.PERMISSION_CANCELLED:
          this.handlePermissionCancelled(data);
          break;

        case WS_MESSAGE_TYPES.PERMISSION_ERROR:
          this.handlePermissionError(data);
          break;

        default:
          // Not a permission message, ignore
          break;
      }
    } catch (error) {
      console.error('Error handling permission message:', error);
      if (this.onError) {
        this.onError(error);
      }
    }
  }

  /**
   * Handle incoming permission request
   */
  handlePermissionRequest(request) {
    console.log('📥 Received permission request:', request);

    // Store the request
    this.pendingRequests.set(request.id, {
      ...request,
      receivedAt: Date.now()
    });

    // Notify handler
    if (this.onRequestReceived) {
      this.onRequestReceived(request);
    }

    // Set up timeout tracking
    if (request.expiresAt) {
      const timeUntilExpiry = request.expiresAt - Date.now();
      if (timeUntilExpiry > 0) {
        setTimeout(() => {
          if (this.pendingRequests.has(request.id)) {
            this.handlePermissionTimeout({ requestId: request.id });
          }
        }, timeUntilExpiry);
      }
    }
  }

  /**
   * Handle permission timeout
   */
  handlePermissionTimeout(data) {
    console.log('⏱️ Permission request timed out:', data.requestId);

    const request = this.pendingRequests.get(data.requestId);
    if (request) {
      this.pendingRequests.delete(data.requestId);

      if (this.onRequestTimeout) {
        this.onRequestTimeout(request);
      }
    }
  }

  /**
   * Handle queue status update
   */
  handleQueueStatus(data) {
    console.log('📊 Queue status update:', data);

    if (this.onQueueStatusUpdate) {
      this.onQueueStatusUpdate({
        pending: data.pending || 0,
        processing: data.processing || 0
      });
    }
  }

  /**
   * Handle permission cancellation
   */
  handlePermissionCancelled(data) {
    console.log('❌ Permission cancelled:', data.requestId);

    const request = this.pendingRequests.get(data.requestId);
    if (request) {
      this.pendingRequests.delete(data.requestId);

      if (this.onRequestTimeout) {
        this.onRequestTimeout(request, data.reason);
      }
    }
  }

  /**
   * Handle permission error
   */
  handlePermissionError(data) {
    console.error('❗ Permission error:', data);

    if (this.onError) {
      this.onError(new Error(data.error || 'Permission error'));
    }
  }

  /**
   * Send a permission response
   */
  sendResponse(requestId, decision, updatedInput = null) {
    const response = {
      type: WS_MESSAGE_TYPES.PERMISSION_RESPONSE,
      requestId,
      decision,
      updatedInput,
      timestamp: Date.now()
    };

    console.log('📤 Sending permission response:', response);

    // Remove from pending requests
    this.pendingRequests.delete(requestId);

    // Send via WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(response));
        return true;
      } catch (error) {
        console.error('Failed to send permission response:', error);
        this.queueMessage(response);
        return false;
      }
    } else {
      console.warn('WebSocket not connected, queuing response');
      this.queueMessage(response);
      return false;
    }
  }

  /**
   * Queue a message for sending when connection is restored
   */
  queueMessage(message) {
    this.messageQueue.push(message);

    // Limit queue size
    if (this.messageQueue.length > 50) {
      this.messageQueue.shift();
    }
  }

  /**
   * Process queued messages
   */
  processMessageQueue() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('Failed to send queued message:', error);
        // Put it back and stop processing
        this.messageQueue.unshift(message);
        break;
      }
    }
  }

  /**
   * Handle connection state change
   */
  handleConnectionStateChange(state) {
    this.connectionState = state;

    if (state === 'connected') {
      this.processMessageQueue();
    }

    if (this.onStateChange) {
      this.onStateChange(state);
    }
  }

  /**
   * Get pending permission requests
   */
  getPendingRequests() {
    return Array.from(this.pendingRequests.values());
  }

  /**
   * Clear a specific request
   */
  clearRequest(requestId) {
    this.pendingRequests.delete(requestId);
  }

  /**
   * Clear all pending requests
   */
  clearAllRequests() {
    this.pendingRequests.clear();
  }

  /**
   * Get connection state
   */
  getConnectionState() {
    return this.connectionState;
  }

  /**
   * Clean up
   */
  cleanup() {
    this.pendingRequests.clear();
    this.messageQueue = [];
    this.ws = null;
    this.connectionState = 'disconnected';
  }
}

// Export singleton instance
const permissionWebSocketClient = new PermissionWebSocketClient();
export default permissionWebSocketClient;