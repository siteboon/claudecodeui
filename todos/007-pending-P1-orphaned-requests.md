---
id: "007"
title: "Orphaned requests after refresh"
priority: P1
category: data-integrity
status: pending
created: 2024-01-29
source: code-review
files:
  - src/hooks/usePermissions.js
  - server/services/permissionManager.js
---

# Orphaned Requests After Refresh

## Problem
When a page refreshes during a pending permission request:

1. Frontend clears React state
2. SessionStorage may contain stale requests
3. Backend may still have the request pending
4. Sync protocol attempts to reconcile but:
   - No validation that backend request is still valid
   - No TTL check on stored requests
   - Race between sync and new requests

This leaves orphaned requests that never get resolved or cleaned up.

## Locations
- `src/hooks/usePermissions.js:133-164` - Sync handler
- `server/services/permissionManager.js:142-163` - `getRequestsForSession()`

## Risk
- **Severity**: CRITICAL
- **Impact**: Lost permission requests, stuck UI, resource leaks
- **Trigger**: Page refresh during pending permission

## Recommended Fix
1. Add TTL validation during sync:
```javascript
// In sync handler
const now = Date.now();
const validRequests = serverRequests.filter(r =>
  now - r.timestamp < REQUEST_TTL
);
```

2. Clean up orphaned requests on backend:
```javascript
// Periodic cleanup
cleanOrphanedRequests() {
  const cutoff = Date.now() - REQUEST_TTL;
  for (const [id, request] of this.requests) {
    if (request.timestamp < cutoff) {
      this.cancelRequest(id, 'expired');
    }
  }
}
```

3. Add request validation in sync response:
```javascript
handlePermissionSyncRequest(clientId, message) {
  const requests = this.getRequestsForSession(sessionId)
    .filter(r => !this.isRequestExpired(r))
    .filter(r => this.isRequestStillValid(r));
  // ...
}
```
