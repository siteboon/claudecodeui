---
id: "016"
title: "Code duplication in message handling"
priority: P2
category: patterns
status: pending
created: 2024-01-29
source: code-review
files:
  - src/hooks/usePermissions.js
---

# Code Duplication in Message Handling

## Problem
The message handling in `usePermissions.js` has duplicated patterns:

1. **Request normalization** (lines 84-91 and 142-148):
   Both WS request handler and sync response handler create identical request objects

2. **Storage operations** (lines 96-98 and 151-154):
   Same `savePendingRequest` pattern in multiple places

3. **Dialog display logic** (lines 115-118 and 158-162):
   Same `setCurrentRequest` + `setIsDialogOpen` pattern

## Locations
- `src/hooks/usePermissions.js:84-91` - Request normalization #1
- `src/hooks/usePermissions.js:142-148` - Request normalization #2
- Multiple locations for storage and dialog

## Risk
- **Severity**: MEDIUM
- **Impact**: Maintenance burden, inconsistent updates
- **Fix Complexity**: Low

## Recommended Fix
Extract common patterns into helper functions:

```javascript
// Helper: Normalize request from various message formats
const normalizeRequest = (message) => ({
  id: message.requestId || message.id,
  tool: message.toolName || message.tool,
  operation: message.operation || 'execute',
  description: message.description || `Use ${message.toolName || message.tool}`,
  input: message.input,
  timestamp: message.timestamp || Date.now(),
});

// Helper: Process incoming request
const processIncomingRequest = (message, enqueueRequest, currentSessionId) => {
  const request = normalizeRequest(message);

  if (currentSessionId) {
    savePendingRequest(currentSessionId, request);
  }

  return enqueueRequest(request);
};

// Helper: Show permission dialog
const showPermissionDialog = (request, setCurrentRequest, setIsDialogOpen) => {
  setCurrentRequest(request);
  setIsDialogOpen(true);
};
```
