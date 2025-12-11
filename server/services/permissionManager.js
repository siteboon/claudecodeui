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

    // Map of sessionId to Set of request IDs (for session-aware queries)
    this.requestsBySession = new Map();

    // Session-level permission cache (for allow-session decisions)
    // Map of sessionId -> Map of cacheKey -> { decision, timestamp }
    this.sessionPermissions = new Map();

    // Cache configuration
    this.maxSessionCacheEntries = 1000;
    this.sessionCacheTTL = 60 * 60 * 1000; // 1 hour

    // Statistics for monitoring
    this.stats = {
      totalRequests: 0,
      approvedRequests: 0,
      deniedRequests: 0,
      timedOutRequests: 0,
      abortedRequests: 0
    };

    // Start periodic cleanup of expired requests and stale sessions
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredRequests();
      this.cleanupStaleSessions();
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
   * @param {string} [sessionId] - Optional session identifier
   * @param {AbortSignal} [abortSignal] - Optional abort signal
   * @returns {Promise<Object>} Promise that resolves with permission result
   */
  async addRequest(id, toolName, input, sessionId = null, abortSignal = null) {
    // Check queue size limit
    if (this.pendingRequests.size >= MAX_QUEUE_SIZE) {
      throw new Error(`Permission queue full (max ${MAX_QUEUE_SIZE} requests)`);
    }

    // Check if this tool/input combination is in session cache
    if (sessionId) {
      const cacheKey = this.getSessionCacheKey(toolName, input);
      const cachedDecision = this.getSessionPermission(sessionId, cacheKey);
      if (cachedDecision) {
        if (this.debugMode) {
          console.log(`🔐 Using cached session permission for ${toolName}: ${cachedDecision} (session: ${sessionId})`);
        }
        this.stats.approvedRequests++;
        return createSdkPermissionResult(cachedDecision);
      }
    }

    return new Promise((resolve, reject) => {
      const timestamp = Date.now();

      // Create the request object
      const request = {
        id,
        toolName,
        input,
        sessionId,
        timestamp,
        resolver: resolve,
        rejector: reject,
        abortSignal,
        timeoutId: null
      };

      // Set up timeout
      request.timeoutId = setTimeout(() => {
        console.warn(`⏱️ Permission request ${id} timed out`);
        this.handleTimeout(id);
      }, PERMISSION_TIMEOUT_MS);

      // Set up abort signal handler if provided
      if (abortSignal) {
        try {
          if (typeof abortSignal.addEventListener === 'function') {
            abortSignal.addEventListener('abort', () => {
              this.handleAbort(id);
            }, { once: true });
          } else if (typeof abortSignal.on === 'function') {
            abortSignal.once('abort', () => {
              this.handleAbort(id);
            });
          } else {
            console.warn('⚠️ [Permission] abortSignal does not support event listeners');
          }
        } catch (error) {
          console.warn('⚠️ [Permission] Failed to attach abort listener:', error.message);
        }
      }

      // Add to pending requests
      this.pendingRequests.set(id, request);
      this.stats.totalRequests++;

      // Track by session for session-aware queries
      if (sessionId) {
        if (!this.requestsBySession.has(sessionId)) {
          this.requestsBySession.set(sessionId, new Set());
        }
        this.requestsBySession.get(sessionId).add(id);
      }

      if (this.debugMode) {
        console.log(`🔐 Added permission request ${id} for tool: ${toolName} (session: ${sessionId || 'none'})`);
        console.log(`   Input preview: ${JSON.stringify(input).substring(0, 200)}...`);
      }

      // Emit event for WebSocket layer to handle (include sessionId)
      const formattedRequest = formatPermissionRequest(id, toolName, input);
      formattedRequest.sessionId = sessionId;
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
    console.log(`🔍 [PermissionManager] resolveRequest called:`, { requestId, decision, hasPendingRequest: this.pendingRequests.has(requestId) });

    const request = this.pendingRequests.get(requestId);

    if (!request) {
      console.warn(`⚠️ Permission request ${requestId} not found in pendingRequests`);
      console.warn(`   Current pending requests:`, Array.from(this.pendingRequests.keys()));
      return false;
    }

    console.log(`✅ [PermissionManager] Found request ${requestId}, resolving with ${decision}`);

    // Clear timeout
    if (request.timeoutId) {
      clearTimeout(request.timeoutId);
      console.log(`🔍 [PermissionManager] Cleared timeout for ${requestId}`);
    }

    // Remove from pending
    this.pendingRequests.delete(requestId);

    // Remove from session tracking
    if (request.sessionId && this.requestsBySession.has(request.sessionId)) {
      this.requestsBySession.get(request.sessionId).delete(requestId);
      if (this.requestsBySession.get(request.sessionId).size === 0) {
        this.requestsBySession.delete(request.sessionId);
      }
    }

    console.log(`🔍 [PermissionManager] Removed ${requestId} from pending, remaining: ${this.pendingRequests.size}`);

    // Handle session-level caching (properly isolated per session)
    if (decision === PermissionDecision.ALLOW_SESSION && request.sessionId) {
      const cacheKey = this.getSessionCacheKey(request.toolName, request.input);
      this.setSessionPermission(request.sessionId, cacheKey, decision);
      if (this.debugMode) {
        console.log(`🔐 Cached session permission for ${request.toolName} (session: ${request.sessionId})`);
      }
    }

    // Update statistics
    if (decision === PermissionDecision.DENY) {
      this.stats.deniedRequests++;
    } else {
      this.stats.approvedRequests++;
    }

    // Create SDK-compatible result
    // If user didn't modify input (updatedInput is null), use the original input
    const result = createSdkPermissionResult(decision, updatedInput ?? request.input,"Denied by user");
    console.log(`🔍 [PermissionManager] Created SDK result:`, result);

    if (this.debugMode) {
      console.log(`🔐 Resolved permission ${requestId}: ${decision}`);
    }

    // Resolve the promise
    console.log(`🔍 [PermissionManager] Calling resolver for ${requestId}`);
    try {
      request.resolver(result);
      console.log(`✅ [PermissionManager] Resolver called successfully for ${requestId}`);
    } catch (error) {
      console.error(`❌ [PermissionManager] Error calling resolver:`, error);
    }

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
    const result = createSdkPermissionResult(PermissionDecision.DENY,null, "Request timed out", false);
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
   * Cleans up stale sessions with no active requests
   * @private
   */
  cleanupStaleSessions() {
    const staleSessions = [];

    for (const [sessionId, requestIds] of this.requestsBySession) {
      if (requestIds.size === 0) {
        staleSessions.push(sessionId);
      } else {
        const hasActiveRequests = Array.from(requestIds).some(
          requestId => this.pendingRequests.has(requestId)
        );
        if (!hasActiveRequests) {
          staleSessions.push(sessionId);
        }
      }
    }

    if (staleSessions.length > 0 && this.debugMode) {
      console.log(`🧹 Cleaning up ${staleSessions.length} stale sessions`);
    }

    staleSessions.forEach(sessionId => {
      this.requestsBySession.delete(sessionId);
    });
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

    return keyParts.join('\x00');
  }

  /**
   * Gets a session-specific cached permission with TTL check
   * @param {string} sessionId - Session identifier
   * @param {string} cacheKey - Cache key for the permission
   * @returns {string|null} Cached permission decision or null if not found/expired
   * @private
   */
  getSessionPermission(sessionId, cacheKey) {
    const sessionCache = this.sessionPermissions.get(sessionId);
    if (!sessionCache) return null;

    const entry = sessionCache.get(cacheKey);
    if (!entry) return null;

    // Check TTL expiration
    if (Date.now() - entry.timestamp > this.sessionCacheTTL) {
      sessionCache.delete(cacheKey);
      return null;
    }

    return entry.decision;
  }

  /**
   * Sets a session-specific cached permission with TTL and size limit
   * @param {string} sessionId - Session identifier
   * @param {string} cacheKey - Cache key for the permission
   * @param {string} permission - Permission decision to cache
   * @private
   */
  setSessionPermission(sessionId, cacheKey, permission) {
    let sessionCache = this.sessionPermissions.get(sessionId);
    if (!sessionCache) {
      sessionCache = new Map();
      this.sessionPermissions.set(sessionId, sessionCache);
    }

    // Evict oldest entries if cache is full (simple LRU approximation)
    if (sessionCache.size >= this.maxSessionCacheEntries) {
      const oldestKey = sessionCache.keys().next().value;
      sessionCache.delete(oldestKey);
    }

    sessionCache.set(cacheKey, { decision: permission, timestamp: Date.now() });
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
   * Removes all data for a specific session
   * @param {string} sessionId - Session identifier to clean up
   */
  removeSession(sessionId) {
    if (!sessionId) return;

    const requestIds = this.requestsBySession.get(sessionId);
    if (requestIds) {
      requestIds.forEach(requestId => {
        const request = this.pendingRequests.get(requestId);
        if (request && request.timeoutId) {
          clearTimeout(request.timeoutId);
        }
        this.pendingRequests.delete(requestId);
      });
      this.requestsBySession.delete(sessionId);
    }

    this.sessionPermissions.delete(sessionId);

    if (this.debugMode) {
      console.log(`🔐 Removed session ${sessionId} from permission manager`);
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
      const formatted = formatPermissionRequest(id, request.toolName, request.input);
      formatted.sessionId = request.sessionId;
      requests.push(formatted);
    }
    return requests;
  }

  /**
   * Gets pending permission requests for a specific session
   * @param {string} sessionId - Session identifier
   * @returns {Array} Array of formatted pending requests for the session
   */
  getRequestsForSession(sessionId) {
    if (!sessionId) return [];

    const requestIds = this.requestsBySession.get(sessionId);
    if (!requestIds || requestIds.size === 0) return [];

    const requests = [];
    for (const id of requestIds) {
      const request = this.pendingRequests.get(id);
      if (request) {
        const formatted = formatPermissionRequest(id, request.toolName, request.input);
        formatted.sessionId = request.sessionId;
        formatted.timestamp = request.timestamp;
        requests.push(formatted);
      }
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
    this.requestsBySession.clear();
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
