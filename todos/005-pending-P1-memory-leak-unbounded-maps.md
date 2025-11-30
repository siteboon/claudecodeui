---
id: "005"
title: "Memory leak from unbounded Map growth"
priority: P1
category: performance
status: pending
created: 2024-01-29
source: code-review
files:
  - server/services/permissionManager.js
  - server/services/permissionWebSocketHandler.js
---

# Memory Leak from Unbounded Map Growth

## Problem
Multiple Maps grow without bounds and are never cleaned:

1. `permissionManager.js:27` - `requestsBySession` Map
   - Sessions are added but never removed
   - Old sessions accumulate indefinitely

2. `permissionWebSocketHandler.js:18` - `messageQueue` Map
   - Queued messages for disconnected clients never cleared on client removal
   - Only cleared when messages are successfully sent

## Locations
- `server/services/permissionManager.js:27` - `this.requestsBySession = new Map()`
- `server/services/permissionWebSocketHandler.js:18` - `this.messageQueue = new Map()`

## Risk
- **Severity**: CRITICAL
- **Impact**: Server memory exhaustion over time
- **Timeline**: Gradual degradation, eventual OOM crash

## Recommended Fix
Implement cleanup strategies:

```javascript
// 1. Clean up on session end
removeSession(sessionId) {
  this.requestsBySession.delete(sessionId);
  this.sessionPermissions.delete(sessionId);
}

// 2. TTL-based cleanup
startCleanupInterval() {
  setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL;
    for (const [sessionId, data] of this.requestsBySession) {
      if (data.lastActivity < cutoff) {
        this.removeSession(sessionId);
      }
    }
  }, CLEANUP_INTERVAL);
}

// 3. Fix messageQueue cleanup in removeClient()
removeClient(clientId) {
  this.messageQueue.delete(clientId); // Add this line
  // ... existing cleanup
}
```
