---
id: "017"
title: "Unused analytics code"
priority: P2
category: simplification
status: pending
created: 2024-01-29
source: code-review
files:
  - src/hooks/usePermissions.js
---

# Unused Analytics Code

## Problem
The `logPermissionDecision` function (lines 7-32) and related analytics code appears to be:
1. Not connected to any real analytics service (gtag is conditional)
2. Storing data in localStorage that's never read by the app
3. `getPermissionStats()` exists but may not be used in UI

This is dead/partially-dead code that adds complexity.

## Locations
- `src/hooks/usePermissions.js:7-32` - `logPermissionDecision` function
- `src/hooks/usePermissions.js:294-322` - `getPermissionStats` function
- `src/hooks/usePermissions.js:324-328` - `clearPermissionHistory` function

## Risk
- **Severity**: LOW-MEDIUM
- **Impact**: Code bloat, maintenance overhead
- **Fix Complexity**: Low

## Recommended Fix
Either:

**Option 1: Remove if unused**
```javascript
// Delete lines 7-32, 294-328
// Remove from exports
```

**Option 2: Move to separate analytics module if needed**
```javascript
// src/utils/permissionAnalytics.js
export const logPermissionDecision = (requestId, decision) => {
  // ... analytics logic
};

export const getPermissionStats = () => {
  // ... stats logic
};

// Import only where needed
```

**Option 3: Integrate properly if analytics is wanted**
```javascript
// Connect to real analytics service
// Add UI for viewing stats
// Document the feature
```
