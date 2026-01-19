/**
 * Status Tracker
 *
 * Tracks the status of Claude sessions and reports changes to the orchestrator.
 * Status values:
 * - idle: No active Claude sessions
 * - active: User connected (WebSocket open) but not currently generating
 * - busy: Claude is generating a response
 */

import { EventEmitter } from "events";
import { StatusValues } from "./protocol.js";

/**
 * StatusTracker class
 *
 * Tracks active connections and Claude processing state to determine
 * the overall status of the claudecodeui instance.
 */
export class StatusTracker extends EventEmitter {
  constructor() {
    super();

    // Track active WebSocket connections
    this.activeConnections = new Set();

    // Track busy sessions (actively generating)
    this.busySessions = new Set();

    // Current status
    this.currentStatus = StatusValues.IDLE;
  }

  /**
   * Registers a new WebSocket connection
   * @param {string} connectionId - Unique connection identifier
   */
  addConnection(connectionId) {
    this.activeConnections.add(connectionId);
    this.updateStatus();
  }

  /**
   * Removes a WebSocket connection
   * @param {string} connectionId - Unique connection identifier
   */
  removeConnection(connectionId) {
    this.activeConnections.delete(connectionId);
    this.updateStatus();
  }

  /**
   * Marks a session as busy (Claude is generating)
   * @param {string} sessionId - Session identifier
   */
  markBusy(sessionId) {
    this.busySessions.add(sessionId);
    this.updateStatus();
  }

  /**
   * Marks a session as no longer busy
   * @param {string} sessionId - Session identifier
   */
  markIdle(sessionId) {
    this.busySessions.delete(sessionId);
    this.updateStatus();
  }

  /**
   * Updates the current status based on active connections and busy sessions
   */
  updateStatus() {
    let newStatus;

    if (this.busySessions.size > 0) {
      // If any session is generating, we're busy
      newStatus = StatusValues.BUSY;
    } else if (this.activeConnections.size > 0) {
      // If we have connections but nothing generating, we're active
      newStatus = StatusValues.ACTIVE;
    } else {
      // No connections, we're idle
      newStatus = StatusValues.IDLE;
    }

    if (newStatus !== this.currentStatus) {
      const previousStatus = this.currentStatus;
      this.currentStatus = newStatus;
      this.emit("status_change", {
        status: newStatus,
        previousStatus,
        activeConnections: this.activeConnections.size,
        busySessions: this.busySessions.size,
      });
    }
  }

  /**
   * Gets the current status
   * @returns {string} Current status value
   */
  getStatus() {
    return this.currentStatus;
  }

  /**
   * Gets detailed state information
   * @returns {Object} State details
   */
  getState() {
    return {
      status: this.currentStatus,
      activeConnections: this.activeConnections.size,
      busySessions: this.busySessions.size,
      connectionIds: Array.from(this.activeConnections),
      busySessionIds: Array.from(this.busySessions),
    };
  }

  /**
   * Resets all tracking state
   */
  reset() {
    this.activeConnections.clear();
    this.busySessions.clear();
    this.currentStatus = StatusValues.IDLE;
  }
}

// Singleton instance for use across the application
let statusTrackerInstance = null;

/**
 * Gets the singleton StatusTracker instance
 * @returns {StatusTracker} The status tracker instance
 */
export function getStatusTracker() {
  if (!statusTrackerInstance) {
    statusTrackerInstance = new StatusTracker();
  }
  return statusTrackerInstance;
}

/**
 * Creates status tracking hooks for existing handlers
 *
 * Usage in server/index.js:
 * ```javascript
 * const { createStatusHooks } = require('./orchestrator/status-tracker');
 * const statusHooks = createStatusHooks(orchestratorClient);
 *
 * // Wrap queryClaudeSDK
 * const originalQueryClaudeSDK = queryClaudeSDK;
 * const wrappedQueryClaudeSDK = async (command, options, ws) => {
 *   const sessionId = options.sessionId || 'new-session';
 *   statusHooks.onQueryStart(sessionId);
 *   try {
 *     await originalQueryClaudeSDK(command, options, ws);
 *   } finally {
 *     statusHooks.onQueryEnd(sessionId);
 *   }
 * };
 * ```
 *
 * @param {OrchestratorClient} orchestratorClient - The orchestrator client
 * @returns {Object} Hook functions
 */
export function createStatusHooks(orchestratorClient) {
  const tracker = getStatusTracker();

  // Forward status changes to orchestrator
  tracker.on("status_change", ({ status }) => {
    if (orchestratorClient && orchestratorClient.isConnected) {
      orchestratorClient.sendStatusUpdate(status);
    }
  });

  return {
    /**
     * Call when a WebSocket connection is established
     * @param {string} connectionId - Unique connection ID (e.g., ws object reference)
     */
    onConnectionOpen: (connectionId) => {
      tracker.addConnection(connectionId);
    },

    /**
     * Call when a WebSocket connection is closed
     * @param {string} connectionId - Unique connection ID
     */
    onConnectionClose: (connectionId) => {
      tracker.removeConnection(connectionId);
    },

    /**
     * Call when a Claude query starts processing
     * @param {string} sessionId - Session identifier
     */
    onQueryStart: (sessionId) => {
      tracker.markBusy(sessionId);
    },

    /**
     * Call when a Claude query finishes (success or error)
     * @param {string} sessionId - Session identifier
     */
    onQueryEnd: (sessionId) => {
      tracker.markIdle(sessionId);
    },

    /**
     * Gets the current status
     * @returns {string} Current status
     */
    getStatus: () => tracker.getStatus(),

    /**
     * Gets detailed state
     * @returns {Object} State details
     */
    getState: () => tracker.getState(),
  };
}

export default StatusTracker;
