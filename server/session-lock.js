/**
 * Session Lock Manager
 *
 * Manages exclusive locks for chat sessions to prevent conflicts between
 * multiple clients trying to use the same session simultaneously.
 *
 * Lock Types:
 * - 'chat': Exclusive lock for chat queries (blocks shell input)
 * - 'shell': Advisory lock for shell activity (warns chat users)
 */

class SessionLock {
  constructor() {
    // sessionKey -> { clientId, mode, acquiredAt, metadata }
    this.locks = new Map();

    // Event listeners for lock state changes
    this.listeners = new Set();
  }

  /**
   * Attempt to acquire a lock for a session
   * @param {string} sessionKey - The session identifier
   * @param {string} clientId - The client requesting the lock
   * @param {string} mode - 'chat' or 'shell'
   * @param {object} metadata - Optional metadata (e.g., queryId)
   * @returns {{ success: boolean, holder?: LockInfo, reason?: string }}
   */
  acquireLock(sessionKey, clientId, mode, metadata = {}) {
    const existing = this.locks.get(sessionKey);

    if (existing) {
      // Check if same client already holds the lock
      if (existing.clientId === clientId) {
        // Update mode if needed
        if (existing.mode !== mode) {
          existing.mode = mode;
          existing.metadata = { ...existing.metadata, ...metadata };
          this.notifyListeners("updated", sessionKey, existing);
        }
        return { success: true };
      }

      // Another client holds the lock
      return {
        success: false,
        holder: { ...existing },
        reason: `Session is locked by ${existing.mode} operation`,
      };
    }

    // No existing lock, acquire it
    const lockInfo = {
      clientId,
      mode,
      acquiredAt: Date.now(),
      metadata,
    };

    this.locks.set(sessionKey, lockInfo);
    this.notifyListeners("acquired", sessionKey, lockInfo);

    return { success: true };
  }

  /**
   * Release a lock held by a specific client
   * @param {string} sessionKey - The session identifier
   * @param {string} clientId - The client releasing the lock
   * @returns {boolean} - True if lock was released
   */
  releaseLock(sessionKey, clientId) {
    const existing = this.locks.get(sessionKey);

    if (!existing) {
      return false;
    }

    if (existing.clientId !== clientId) {
      // Can't release someone else's lock
      return false;
    }

    this.locks.delete(sessionKey);
    this.notifyListeners("released", sessionKey, existing);

    return true;
  }

  /**
   * Get the current lock status for a session
   * @param {string} sessionKey - The session identifier
   * @returns {LockInfo | null}
   */
  getLockStatus(sessionKey) {
    const lock = this.locks.get(sessionKey);
    return lock ? { ...lock } : null;
  }

  /**
   * Check if a session is locked
   * @param {string} sessionKey - The session identifier
   * @returns {boolean}
   */
  isLocked(sessionKey) {
    return this.locks.has(sessionKey);
  }

  /**
   * Check if a session is locked by a specific mode
   * @param {string} sessionKey - The session identifier
   * @param {string} mode - 'chat' or 'shell'
   * @returns {boolean}
   */
  isLockedByMode(sessionKey, mode) {
    const lock = this.locks.get(sessionKey);
    return lock?.mode === mode;
  }

  /**
   * Force release a lock (for kick functionality)
   * @param {string} sessionKey - The session identifier
   * @returns {LockInfo | null} - The released lock info, or null if none
   */
  forceRelease(sessionKey) {
    const existing = this.locks.get(sessionKey);

    if (!existing) {
      return null;
    }

    this.locks.delete(sessionKey);
    this.notifyListeners("force-released", sessionKey, existing);

    return existing;
  }

  /**
   * Get all active locks
   * @returns {Map<string, LockInfo>}
   */
  getAllLocks() {
    return new Map(this.locks);
  }

  /**
   * Get locks for a specific client
   * @param {string} clientId - The client identifier
   * @returns {Array<{ sessionKey: string, lock: LockInfo }>}
   */
  getClientLocks(clientId) {
    const result = [];
    for (const [sessionKey, lock] of this.locks) {
      if (lock.clientId === clientId) {
        result.push({ sessionKey, lock: { ...lock } });
      }
    }
    return result;
  }

  /**
   * Release all locks held by a client (e.g., on disconnect)
   * @param {string} clientId - The client identifier
   * @returns {number} - Number of locks released
   */
  releaseClientLocks(clientId) {
    const toRelease = [];

    for (const [sessionKey, lock] of this.locks) {
      if (lock.clientId === clientId) {
        toRelease.push(sessionKey);
      }
    }

    for (const sessionKey of toRelease) {
      const lock = this.locks.get(sessionKey);
      this.locks.delete(sessionKey);
      this.notifyListeners("released", sessionKey, lock);
    }

    return toRelease.length;
  }

  /**
   * Add a listener for lock state changes
   * @param {function} listener - Callback function(event, sessionKey, lockInfo)
   */
  addListener(listener) {
    this.listeners.add(listener);
  }

  /**
   * Remove a listener
   * @param {function} listener - The listener to remove
   */
  removeListener(listener) {
    this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of a lock state change
   * @private
   */
  notifyListeners(event, sessionKey, lockInfo) {
    for (const listener of this.listeners) {
      try {
        listener(event, sessionKey, lockInfo);
      } catch (err) {
        console.error("[SessionLock] Listener error:", err);
      }
    }
  }

  /**
   * Clean up stale locks (locks held longer than maxAge)
   * @param {number} maxAge - Maximum age in milliseconds
   * @returns {number} - Number of locks cleaned up
   */
  cleanupStaleLocks(maxAge = 30 * 60 * 1000) {
    const now = Date.now();
    const toCleanup = [];

    for (const [sessionKey, lock] of this.locks) {
      if (now - lock.acquiredAt > maxAge) {
        toCleanup.push(sessionKey);
      }
    }

    for (const sessionKey of toCleanup) {
      const lock = this.locks.get(sessionKey);
      this.locks.delete(sessionKey);
      this.notifyListeners("expired", sessionKey, lock);
    }

    return toCleanup.length;
  }
}

// Singleton instance
const sessionLock = new SessionLock();

// Periodic cleanup of stale locks (every 5 minutes)
setInterval(
  () => {
    const cleaned = sessionLock.cleanupStaleLocks();
    if (cleaned > 0) {
      console.log(`[SessionLock] Cleaned up ${cleaned} stale locks`);
    }
  },
  5 * 60 * 1000,
);

module.exports = { SessionLock, sessionLock };
