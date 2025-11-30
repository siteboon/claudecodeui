---
id: "018"
title: "Unused storage utility exports"
priority: P2
category: simplification
status: pending
created: 2024-01-29
source: code-review
files:
  - src/utils/permissionStorage.js
---

# Unused Storage Utility Exports

## Problem
`permissionStorage.js` exports functions that are never imported elsewhere:
- `isRequestExpired` (lines 54-57)
- `getRequestTTL` (lines 59-61)

These were likely planned for TTL validation but never integrated.

## Locations
- `src/utils/permissionStorage.js:54-57` - `isRequestExpired`
- `src/utils/permissionStorage.js:59-61` - `getRequestTTL`

## Risk
- **Severity**: LOW
- **Impact**: Dead code, misleading API surface
- **Fix Complexity**: Trivial

## Recommended Fix
Either:

**Option 1: Remove if truly unused**
```javascript
// Delete the unused functions
// Run grep to verify no imports:
// grep -r "isRequestExpired\|getRequestTTL" src/
```

**Option 2: Integrate if TTL is needed**
```javascript
// In usePermissions.js sync handler
message.pendingRequests.forEach(serverRequest => {
  if (isRequestExpired(serverRequest)) {
    console.log('Skipping expired request:', serverRequest.requestId);
    return;
  }
  // ... process request
});
```

**Option 3: Mark as internal/future use**
```javascript
// Add JSDoc comment explaining status
/**
 * Check if a request has expired based on TTL
 * @internal Not yet integrated - planned for future TTL validation
 */
export const isRequestExpired = (request) => { ... };
```
