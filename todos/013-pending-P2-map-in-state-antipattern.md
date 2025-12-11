---
id: "013"
title: "Map-in-state anti-pattern"
priority: P2
category: patterns
status: pending
created: 2024-01-29
source: code-review
files:
  - src/contexts/PermissionContext.jsx
---

# Map-in-State Anti-Pattern

## Problem
`PermissionContext.jsx` (lines 19-20) stores Map objects in React state:
- `requestQueue: new Map()`
- `sessionPermissions: new Map()`

This is an anti-pattern because:
1. Map mutations don't trigger re-renders (reference equality)
2. Requires manual spreading/copying for updates
3. DevTools can't inspect Map contents easily
4. Potential for accidental mutation bugs

## Location
- `src/contexts/PermissionContext.jsx:19-20`

## Risk
- **Severity**: MEDIUM
- **Impact**: Stale UI, debugging difficulties
- **Fix Complexity**: Medium (state shape change)

## Recommended Fix
Use plain objects or arrays:

```javascript
// Option 1: Plain object with ID keys
const [requests, setRequests] = useState({});

// Add request
setRequests(prev => ({
  ...prev,
  [request.id]: request
}));

// Remove request
setRequests(prev => {
  const { [id]: removed, ...rest } = prev;
  return rest;
});

// Option 2: Array with immutable operations
const [requestQueue, setRequestQueue] = useState([]);

// Add
setRequestQueue(prev => [...prev, request]);

// Remove
setRequestQueue(prev => prev.filter(r => r.id !== id));

// Option 3: useReducer for complex state
const [state, dispatch] = useReducer(permissionReducer, initialState);
```
