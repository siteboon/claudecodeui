---
id: "011"
title: "Duplicate storage operations"
priority: P2
category: performance
status: pending
created: 2024-01-29
source: code-review
files:
  - src/hooks/usePermissions.js
  - src/contexts/PermissionContext.jsx
---

# Duplicate Storage Operations

## Problem
The same data is written to sessionStorage multiple times per permission request:

1. `usePermissions.js:96-98` - `savePendingRequest()` on WS message
2. `PermissionContext.jsx` - `enqueueRequest()` also saves
3. Both `handleDecision` and `sendPermissionResponse` may trigger saves

This causes:
- Unnecessary I/O overhead
- Potential race conditions
- Inconsistent state if writes interleave

## Locations
- `src/hooks/usePermissions.js:96-98` - First save
- `src/hooks/usePermissions.js:110-113` - Remove on auto-approve
- `src/contexts/PermissionContext.jsx` - Additional saves

## Risk
- **Severity**: MEDIUM
- **Impact**: Performance degradation, potential bugs
- **Fix Complexity**: Medium (requires coordination)

## Recommended Fix
Centralize storage operations in one layer:

```javascript
// Option 1: Storage only in Context
// Remove all storage calls from usePermissions.js
// Let PermissionContext handle all persistence

// Option 2: Storage only in hook
// Remove storage calls from Context
// Hook is responsible for persistence

// Option 3: Dedicated storage service
class PermissionStorageService {
  save(sessionId, request) {
    if (this.pendingSave) return; // Debounce
    this.pendingSave = true;
    requestAnimationFrame(() => {
      this.doSave(sessionId, request);
      this.pendingSave = false;
    });
  }
}
```
