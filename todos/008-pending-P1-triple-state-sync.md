---
id: "008"
title: "Triple state synchronization problem"
priority: P1
category: architecture
status: pending
created: 2024-01-29
source: code-review
files:
  - src/hooks/usePermissions.js
  - src/contexts/PermissionContext.jsx
  - server/services/permissionManager.js
---

# Triple State Synchronization Problem

## Problem
Permission state is maintained in THREE separate locations:
1. **React state** (PermissionContext) - `requestQueue`, `sessionPermissions`
2. **SessionStorage** - `pendingRequests`, `sessionPermissions`
3. **Backend Map** - `requestsBySession`, `sessionPermissions`

Each write operation touches multiple stores with no transaction guarantee. This creates:
- Race conditions during concurrent updates
- Inconsistent state if any write fails
- Complex debugging when states diverge

## Locations
- `src/contexts/PermissionContext.jsx:19-20` - React state
- `src/utils/permissionStorage.js` - SessionStorage operations
- `server/services/permissionManager.js:27-33` - Backend Maps

## Risk
- **Severity**: CRITICAL
- **Impact**: State inconsistency, lost permissions, UI bugs
- **Likelihood**: High under load or during network issues

## Recommended Fix
Adopt single source of truth architecture:

**Option 1: Backend as source of truth**
```javascript
// Frontend only caches, backend is authoritative
// All mutations go through WebSocket, state synced back

async requestPermission(request) {
  const response = await this.wsClient.sendAndWait({
    type: 'permission-request',
    ...request
  });
  // Update local cache from response
  this.updateLocalState(response);
}
```

**Option 2: Event sourcing pattern**
```javascript
// All state changes as events
// Single reducer on frontend, events replayed on refresh

const permissionReducer = (state, event) => {
  switch (event.type) {
    case 'REQUEST_ADDED': return addRequest(state, event);
    case 'REQUEST_RESOLVED': return resolveRequest(state, event);
    // ...
  }
};
```

**Option 3: Optimistic updates with reconciliation**
```javascript
// Local state updated optimistically
// Backend response reconciles any differences
// SessionStorage only for offline persistence
```
