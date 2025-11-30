---
id: "015"
title: "Inconsistent property naming (tool vs toolName)"
priority: P2
category: patterns
status: pending
created: 2024-01-29
source: code-review
files:
  - src/hooks/usePermissions.js
  - server/services/permissionWebSocketHandler.js
  - server/services/permissionManager.js
---

# Inconsistent Property Naming (tool vs toolName)

## Problem
The codebase inconsistently uses `tool` and `toolName` for the same concept:

**Frontend uses `tool`:**
- `usePermissions.js:85` - `tool: message.toolName || message.tool`

**Backend uses `toolName`:**
- `permissionManager.js` - `request.toolName`
- `permissionWebSocketHandler.js:144` - `toolName: r.toolName`

**Both in same message:**
- `permissionWebSocketHandler.js:79` - Creates message with `toolName`
- `usePermissions.js:85` - Extracts as `tool`

This causes mapping overhead and potential bugs.

## Locations
- Multiple files (see above)

## Risk
- **Severity**: MEDIUM
- **Impact**: Confusion, mapping bugs
- **Fix Complexity**: Low (search and replace)

## Recommended Fix
Standardize on one name throughout:

```javascript
// Choose ONE and stick with it
// Recommendation: Use `toolName` (more descriptive)

// Frontend: Update request creation
const request = {
  id: message.requestId,
  toolName: message.toolName, // Changed from 'tool'
  // ...
};

// Update all references
// - PermissionContext.jsx
// - PermissionDialog.jsx
// - permissionStorage.js
// - etc.
```
