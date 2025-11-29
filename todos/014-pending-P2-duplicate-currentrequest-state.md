---
id: "014"
title: "Duplicate currentRequest state"
priority: P2
category: architecture
status: pending
created: 2024-01-29
source: code-review
files:
  - src/hooks/usePermissions.js
  - src/contexts/PermissionContext.jsx
---

# Duplicate currentRequest State

## Problem
`currentRequest` is tracked in two places:
1. `usePermissions.js:42` - `const [currentRequest, setCurrentRequest] = useState(null)`
2. `PermissionContext.jsx` - `activeRequest` from context

The hook then syncs these (lines 179-188), creating:
- Unnecessary state duplication
- Sync logic that can get out of sync
- Confusion about source of truth

## Locations
- `src/hooks/usePermissions.js:42` - Local state
- `src/hooks/usePermissions.js:179-188` - Sync effect
- `src/contexts/PermissionContext.jsx` - `activeRequest`

## Risk
- **Severity**: MEDIUM
- **Impact**: State inconsistency, maintenance burden
- **Fix Complexity**: Low-Medium

## Recommended Fix
Remove duplicate state, use context as single source:

```javascript
// In usePermissions.js - REMOVE local state
// const [currentRequest, setCurrentRequest] = useState(null);

// Use context directly
const { activeRequest, setActiveRequest } = usePermission();

// Remove sync effect entirely
// useEffect(() => { ... sync logic ... }, [activeRequest, currentRequest]);

// Use activeRequest throughout
const handleDialogDecision = useCallback((requestId, decision) => {
  // Use activeRequest instead of currentRequest
  if (activeRequest?.id === requestId) {
    // ...
  }
}, [activeRequest, ...]);
```
