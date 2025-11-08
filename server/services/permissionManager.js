/**
 * Permission Manager
 *
 * Core permission queue and handling logic for the interactive permission system.
 * Manages pending permission requests, handles timeouts, and coordinates responses.
 */

import { EventEmitter } from 'events';
import {
  PermissionDecision,
  PERMISSION_TIMEOUT_MS,
  DEFAULT_QUEUE_CLEANUP_INTERVAL_MS,
  MAX_QUEUE_SIZE,
  formatPermissionRequest,
  createSdkPermissionResult
} from './permissionTypes.js';

/**
 * PermissionManager class
 * Manages the queue of pending permission requests and their responses
 */
export class PermissionManager extends EventEmitter {
  constructor() {
    super();

    // Map of request ID to pending permission request
    this.pendingRequests = new Map();

    // Session-level permission cache (for allow-session decisions)
    this.sessionPermissions = new Map();

    // Statistics for monitoring
    this.stats = {
      totalRequests: 0,
      approvedRequests: 0,
      deniedRequests: 0,
      timedOutRequests: 0,
      abortedRequests: 0
    };

    // Start periodic cleanup of expired requests
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredRequests();
    }, DEFAULT_QUEUE_CLEANUP_INTERVAL_MS);

    // Debug mode flag
    this.debugMode = process.env.DEBUG && process.env.DEBUG.includes('permissions');

    if (this.debugMode) {
      console.log('🔐 PermissionManager initialized in debug mode');
    }
  }

  /**
   * Adds a permission request to the queue
   * @param {string} id - Unique request ID
   * @param {string} toolName - Name of the tool
   * @param {Object} input - Tool input parameters
   * @param {AbortSignal} [abortSignal] - Optional abort signal
   * @returns {Promise<Object>} Promise that resolves with permission result
   */
  async addRequest(id, toolName, input, abortSignal = null) {
    // Check queue size limit
    if (this.pendingRequests.size >= MAX_QUEUE_SIZE) {
      throw new Error(`Permission queue full (max ${MAX_QUEUE_SIZE} requests)`);
    }

    // Check if this tool/input combination is in session cache
    const cacheKey = this.getSessionCacheKey(toolName, input);
    if (this.sessionPermissions.has(cacheKey)) {
      const cachedDecision = this.sessionPermissions.get(cacheKey);
      if (this.debugMode) {
        console.log(`🔐 Using cached session permission for ${toolName}: ${cachedDecision}`);
      }
      this.stats.approvedRequests++;
      return createSdkPermissionResult(cachedDecision);
    }

    return new Promise((resolve, reject) => {
      const timestamp = Date.now();

      // Create the request object
      const request = {
        id,
        toolName,
        input,
        timestamp,
        resolver: resolve,
        rejector: reject,
        abortSignal,
        timeoutId: null
      };

      // Set up timeout
      request.timeoutId = setTimeout(() => {
        this.handleTimeout(id);
      }, PERMISSION_TIMEOUT_MS);

      // Set up abort signal handler if provided
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          this.handleAbort(id);
        }, { once: true });
      }

      // Add to pending requests
      this.pendingRequests.set(id, request);
      this.stats.totalRequests++;

      if (this.debugMode) {
        console.log(`🔐 Added permission request ${id} for tool: ${toolName}`);
        console.log(`   Input preview: ${JSON.stringify(input).substring(0, 200)}...`);
      }

      // Emit event for WebSocket layer to handle
      const formattedRequest = formatPermissionRequest(id, toolName, input);
      this.emit('permission-request', formattedRequest);
    });
  }

  /**
   * Resolves a permission request with user decision
   * @param {string} requestId - Request ID to resolve
   * @param {string} decision - User decision (from PermissionDecision enum)
   * @param {Object} [updatedInput] - Optional modified input
   * @returns {boolean} True if request was resolved, false if not found
   */
  resolveRequest(requestId, decision, updatedInput = null) {
    const request = this.pendingRequests.get(requestId);

    if (!request) {
      console.warn(`⚠️ Permission request ${requestId} not found`);
      return false;
    }

    // Clear timeout
    if (request.timeoutId) {
      clearTimeout(request.timeoutId);
    }

    // Remove from pending
    this.pendingRequests.delete(requestId);

    // Handle session-level caching
    if (decision === PermissionDecision.ALLOW_SESSION) {
      const cacheKey = this.getSessionCacheKey(request.toolName, request.input);
      this.sessionPermissions.set(cacheKey, decision);
      if (this.debugMode) {
        console.log(`🔐 Cached session permission for ${request.toolName}`);
      }
    }

    // Update statistics
    if (decision === PermissionDecision.DENY) {
      this.stats.deniedRequests++;
    } else {
      this.stats.approvedRequests++;
    }

    // Create SDK-compatible result
    const result = createSdkPermissionResult(decision, updatedInput);

    if (this.debugMode) {
      console.log(`🔐 Resolved permission ${requestId}: ${decision}`);
    }

    // Resolve the promise
    request.resolver(result);

    return true;
  }

  /**
   * Handles timeout for a permission request
   * @param {string} requestId - Request ID that timed out
   * @private
   */
  handleTimeout(requestId) {
    const request = this.pendingRequests.get(requestId);

    if (!request) {
      return; // Already resolved
    }

    // Remove from pending
    this.pendingRequests.delete(requestId);
    this.stats.timedOutRequests++;

    console.warn(`⏱️ Permission request ${requestId} timed out after ${PERMISSION_TIMEOUT_MS}ms`);

    // Auto-deny on timeout
    const result = createSdkPermissionResult(PermissionDecision.DENY);
    request.resolver(result);

    // Emit timeout event
    this.emit('permission-timeout', requestId);
  }

  /**
   * Handles abort signal for a permission request
   * @param {string} requestId - Request ID that was aborted
   * @private
   */
  handleAbort(requestId) {
    const request = this.pendingRequests.get(requestId);

    if (!request) {
      return; // Already resolved
    }

    // Clear timeout
    if (request.timeoutId) {
      clearTimeout(request.timeoutId);
    }

    // Remove from pending
    this.pendingRequests.delete(requestId);
    this.stats.abortedRequests++;

    if (this.debugMode) {
      console.log(`🛑 Permission request ${requestId} aborted`);
    }

    // Reject with abort error
    request.rejector(new Error('Permission request aborted'));

    // Emit abort event
    this.emit('permission-abort', requestId);
  }

  /**
   * Cleans up expired permission requests
   * @private
   */
  cleanupExpiredRequests() {
    const now = Date.now();
    const expired = [];

    for (const [id, request] of this.pendingRequests) {
      if (now - request.timestamp > PERMISSION_TIMEOUT_MS * 2) {
        // Double timeout for cleanup (shouldn't happen normally)
        expired.push(id);
      }
    }

    if (expired.length > 0) {
      console.warn(`🧹 Cleaning up ${expired.length} expired permission requests`);
      expired.forEach(id => {
        this.handleTimeout(id);
      });
    }
  }

  /**
   * Gets a cache key for session-level permissions
   * @param {string} toolName - Tool name
   * @param {Object} input - Tool input
   * @returns {string} Cache key
   * @private
   */
  getSessionCacheKey(toolName, input) {
    // Create a simple cache key based on tool and critical input params
    // This is a basic implementation; Phase 4 will add pattern matching
    const keyParts = [toolName];

    switch (toolName) {
      case 'Read':
      case 'Write':
      case 'Edit':
        keyParts.push(input.file_path);
        break;
      case 'Bash':
        // For now, don't cache Bash commands (too risky)
        return `${toolName}_${Date.now()}_nocache`;
      case 'WebFetch':
        keyParts.push(input.url);
        break;
      default:
        keyParts.push(JSON.stringify(input));
    }

    return keyParts.join(':');
  }

  /**
   * Clears session-level permission cache
   */
  clearSessionCache() {
    this.sessionPermissions.clear();
    if (this.debugMode) {
      console.log('🔐 Cleared session permission cache');
    }
  }

  /**
   * Gets the count of pending permission requests
   * @returns {number} Number of pending requests
   */
  getPendingCount() {
    return this.pendingRequests.size;
  }

  /**
   * Gets all pending permission requests
   * @returns {Array} Array of formatted pending requests
   */
  getPendingRequests() {
    const requests = [];
    for (const [id, request] of this.pendingRequests) {
      requests.push(formatPermissionRequest(id, request.toolName, request.input));
    }
    return requests;
  }

  /**
   * Gets permission manager statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      pendingCount: this.pendingRequests.size,
      sessionCacheSize: this.sessionPermissions.size
    };
  }

  /**
   * Shuts down the permission manager
   */
  shutdown() {
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Reject all pending requests
    for (const [id, request] of this.pendingRequests) {
      if (request.timeoutId) {
        clearTimeout(request.timeoutId);
      }
      request.rejector(new Error('Permission manager shutting down'));
    }

    // Clear all data
    this.pendingRequests.clear();
    this.sessionPermissions.clear();

    console.log('🔐 PermissionManager shut down');
  }
}

// Export singleton instance
let permissionManagerInstance = null;

/**
 * Gets the singleton PermissionManager instance
 * @returns {PermissionManager} The permission manager instance
 */
export function getPermissionManager() {
  if (!permissionManagerInstance) {
    permissionManagerInstance = new PermissionManager();
  }
  return permissionManagerInstance;
}

/**
 * Resets the singleton instance (mainly for testing)
 */
export function resetPermissionManager() {
  if (permissionManagerInstance) {
    permissionManagerInstance.shutdown();
    permissionManagerInstance = null;
  }
}